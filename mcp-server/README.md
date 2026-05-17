# Memos MCP Server

Connect your [Memos](https://usememos.com) instance to Claude AI and ChatGPT via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io).

This MCP server runs as a long-running HTTP service (Streamable HTTP transport) on the same host as Memos. It is meant to sit **behind the same reverse proxy** that already exposes Memos, so clients reach it at `http://<memos-hostname>/mcp` — same hostname, same port, same TLS as the Memos UI.

The `/mcp` endpoint is gated by **OAuth via GitHub**. This server acts as
a small OAuth broker: MCP clients discover this server's authorization,
token, and dynamic client registration endpoints, while the server
performs the upstream GitHub OAuth exchange and validates each resulting
bearer by calling `https://api.github.com/user` (5-min cache,
SHA-256-hashed token key).

One process serves any number of MCP clients on the LAN — Claude Desktop, Claude Code, ChatGPT, scripts — without per-session subprocess spawning.

## Features

- **read** your memos
- **search** memos by content, tag, visibility
- **create** new memos with Markdown
- **update** existing memos (content, visibility, pinned, archive)
- **delete** memos permanently
- **works with Claude and ChatGPT**: Claude Code CLI, Claude Desktop, **claude.ai web**, Claude Android/iOS, and ChatGPT Developer Mode Actions can all go through GitHub OAuth

## Prerequisites

- Node.js 18+
- A running Memos instance reachable from this server (e.g. `http://localhost:8081` if same host)
- A Memos Personal Access Token (PAT)
- A GitHub OAuth App (`OAUTH_PROVIDER=github` + the env vars in section 2)

## 1. Get a Memos PAT

1. Open Memos
2. Settings → Personal Access Tokens → create a new token (e.g. "Claude MCP")
3. Copy it — looks like `memos_pat_xxxxxxxxxxxx`

## 2. Register a GitHub OAuth App

Register one GitHub OAuth App for the broker. Claude and ChatGPT use
Dynamic Client Registration (DCR) against this MCP server; they do not
need to know the real GitHub Client Secret.

1. GitHub → *Settings* → *Developer settings* → *OAuth Apps* → *New OAuth App*:
   - *Homepage URL*: `https://mcp-memo.giuliohome.com`
   - *Authorization callback URL*: `https://mcp-memo.giuliohome.com/oauth/github/callback`
   - Copy the *Client ID* and generate a *Client Secret*.
2. Set on this server (see section 4):
   ```
   MEMOS_TOKEN=memos_pat_xxxxxxxxxxxx
   OAUTH_PROVIDER=github
   OAUTH_PUBLIC_BASE_URL=https://mcp-memo.giuliohome.com
   OAUTH_ALLOWED_USERS=giuliohome
   GITHUB_OAUTH_CLIENT_ID=Ov23...
   GITHUB_OAUTH_CLIENT_SECRET=...
   ```
   `OAUTH_ALLOWED_USERS` is **required** — comma-separated GitHub logins;
   an empty value refuses to start, so a misconfiguration cannot silently
   let any GitHub user in.
3. For production, load `MEMOS_TOKEN`, `GITHUB_OAUTH_CLIENT_SECRET`, and
   `OAUTH_REFRESH_TOKEN_SECRET` via systemd encrypted credentials rather
   than plaintext env vars. Rotate the GitHub Client Secret after setup if
   it was pasted into test UIs during troubleshooting.

## 3. Install & build

```bash
cd mcp-server
npm install
npm run build
```

`dist/index.js` is the entrypoint.

## 4. Run as a daemon (systemd + encrypted credentials)

This keeps the server running and restarts it on failure. The preferred
deployment is a system-level unit that runs Node as user `giulio`, with
secrets supplied through `LoadCredentialEncrypted`. Non-secret settings
live in `/etc/memos-mcp/env`.

```bash
# Build first.
cd ~/react/memos/mcp-server
npm run build

# Non-secret environment.
sudo install -d -m 0755 /etc/memos-mcp
sudo tee /etc/memos-mcp/env >/dev/null <<'EOF'
MEMOS_URL=http://localhost:8081
PORT=8082

OAUTH_PROVIDER=github
OAUTH_PUBLIC_BASE_URL=https://mcp-memo.giuliohome.com
OAUTH_ALLOWED_USERS=giuliohome
GITHUB_OAUTH_CLIENT_ID=Ov23...
EOF
sudo chmod 0644 /etc/memos-mcp/env

# Encrypted credentials. Run these from a shell where the three variables
# are set, or replace "$..." with the values while avoiding shell history.
sudo install -d -m 0700 /etc/memos-mcp/credentials
printf "%s" "$MEMOS_TOKEN" | sudo systemd-creds encrypt --name=MEMOS_TOKEN - /etc/memos-mcp/credentials/MEMOS_TOKEN.cred
printf "%s" "$GITHUB_OAUTH_CLIENT_SECRET" | sudo systemd-creds encrypt --name=GITHUB_OAUTH_CLIENT_SECRET - /etc/memos-mcp/credentials/GITHUB_OAUTH_CLIENT_SECRET.cred
printf "%s" "${OAUTH_REFRESH_TOKEN_SECRET:-$MEMOS_TOKEN}" | sudo systemd-creds encrypt --name=OAUTH_REFRESH_TOKEN_SECRET - /etc/memos-mcp/credentials/OAUTH_REFRESH_TOKEN_SECRET.cred
sudo chmod 600 /etc/memos-mcp/credentials/*.cred

# Install and start the system unit. Disable the legacy user unit if it was used.
systemctl --user disable --now memos-mcp.service || true
sudo cp systemd/memos-mcp.system.service /etc/systemd/system/memos-mcp.service
sudo systemctl daemon-reload
sudo systemctl enable --now memos-mcp.service
sudo systemctl status memos-mcp.service
```

Tail the logs with:

```bash
sudo journalctl -u memos-mcp -f
```

You should see:

```
Memos MCP server listening on :8082 (POST /mcp, oauth=github(giuliohome), dcrGithubClient=configured, dcrGithubSecret=configured, stateless)
```

The code also supports plaintext env vars as a fallback, but production
deployments should keep `MEMOS_TOKEN`, `GITHUB_OAUTH_CLIENT_SECRET`, and
`OAUTH_REFRESH_TOKEN_SECRET` out of `/etc/memos-mcp/env` and
`~/.memos-mcp.env`.

## 5. Add the `/mcp` location to your reverse proxy

The Memos site config on your nginx (or Caddy/Traefik) host already proxies `/` to `<fedora-ip>:8081`. Add a sibling `location /mcp` that points to the MCP server on `<fedora-ip>:8082`. Example for nginx (`/etc/nginx/sites-available/memo` on the proxy host):

```nginx
server {
    listen 80;
    server_name memo.home;   # or memo.local, whichever you use

    location /mcp {
        proxy_pass http://192.168.1.202:8082;   # Fedora IP : MCP port
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        # Streamable HTTP MCP can keep the connection open for SSE responses;
        # bump these so streams aren't cut by idle timeouts.
        proxy_read_timeout 600s;
        proxy_buffering off;
    }

    location / {
        proxy_pass http://192.168.1.202:8081;   # existing memos backend
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

If you also want the OAuth discovery and broker endpoints to work over a
LAN proxy, add `location /.well-known/` and `location /oauth/` pointing at
the same backend. The production Cloudflare hostname in this setup points
directly at `192.168.1.202:8082`.

Apply:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 6. Smoke-test the endpoint

The OAuth discovery endpoints don't need authentication — they should
return JSON straight away:

```bash
curl -sS https://mcp-memo.giuliohome.com/.well-known/oauth-protected-resource | jq
curl -sS https://mcp-memo.giuliohome.com/.well-known/oauth-protected-resource/mcp | jq
curl -sS https://mcp-memo.giuliohome.com/.well-known/oauth-authorization-server | jq
```

An unauthenticated `POST /mcp` must return `401` with the
`WWW-Authenticate` header that triggers Claude.ai's OAuth flow:

```bash
curl -i -X POST https://mcp-memo.giuliohome.com/mcp \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# expected: HTTP/2 401
#   www-authenticate: Bearer realm="MCP", resource_metadata="…/.well-known/oauth-protected-resource"
```

To smoke-test the authenticated path without going through Claude.ai,
you can mint a `read:user` token at GitHub → Settings → Developer settings
→ Personal access tokens (fine-grained) and reuse it as a bearer:

```bash
curl -sS https://mcp-memo.giuliohome.com/mcp \
  -H "Authorization: Bearer $GH_PAT_READUSER" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# expected: JSON-RPC body listing the 5 tools with annotations
# and /mcp auth ok + method/status lines in journalctl
```

## 7. Register with Claude and ChatGPT

### claude.ai web / Android / iOS

Settings → Connectors → Add custom connector:

- URL: `https://mcp-memo.giuliohome.com/mcp`
- Authentication: OAuth.
- Prefer Dynamic Client Registration if Claude offers it. The broker accepts
  Claude's callback `https://claude.ai/api/mcp/auth_callback`.

The first request returns `401` with `WWW-Authenticate: … resource_metadata=…`;
Claude.ai discovers the broker metadata, dynamically registers a client,
walks you through `github.com/login/oauth/authorize`, exchanges through
`/oauth/token`, and forwards the resulting bearer on every subsequent
`/mcp` call. The server validates each request by calling
`https://api.github.com/user`.

### Claude Desktop / Claude Code

Same connector URL, same OAuth flow. Claude Desktop and Claude Code both
implement OAuth-aware MCP clients and will discover the metadata
endpoints automatically when they hit the 401.

Once added, the Memos tools (`list_memos`, `get_memo`, `create_memo`, `update_memo`, `delete_memo`) appear in the connector's tool list and can be called from any conversation.

### ChatGPT Developer Mode Actions

Settings → Apps → Advanced settings → Create app:

- MCP URL: `https://mcp-memo.giuliohome.com/mcp`
- Authentication: OAuth.
- Advanced OAuth settings → Registration method: **Dynamic Client Registration**.
- Default scopes: `read:user`; Base scopes: empty.
- OIDC: disabled.

During setup, keep logs open with `journalctl --user -u memos-mcp -f`. A
successful setup shows `/oauth/register status=201`, `/oauth/token
status=200`, and MCP discovery methods such as `initialize`,
`notifications/initialized`, and `tools/list`. If Cloudflare Bot Fight
Mode is enabled, create a bypass/skip rule for this hostname on
`/oauth/*`, `/.well-known/*`, and `/mcp`; otherwise ChatGPT's backend can
receive `403` before the request reaches this server.

## 8. Public exposure via Cloudflare Tunnel

To use this MCP server from claude.ai web, the Claude Android/iOS app, or
any client outside your home network, expose it through your existing
Cloudflare Tunnel.

The exposure is gated by the **OAuth flow** — no Cloudflare Access policy
in front. The MCP server itself enforces the `OAUTH_ALLOWED_USERS`
allowlist on every request.

### 8.1 — Add a public hostname to your tunnel

In the Cloudflare Zero Trust dashboard:

- Networks → Tunnels → your tunnel → Public Hostnames → **Add a public hostname**.
- Subdomain: `mcp-memo` · Domain: `giuliohome.com` · Path: empty.
- Service: HTTP · URL: `192.168.1.202:8082` (the LAN address of the host running this MCP server).
- Save. Cloudflare auto-creates the CNAME `mcp-memo` → `<tunnel-id>.cfargotunnel.com`.

Do **not** create a Cloudflare Access application for this hostname — the OAuth check is the gate.

### 8.2 — Allow the MCP port from the cloudflared host

If the cloudflared connector and the MCP server live on different machines (e.g. cloudflared on Debian `192.168.1.122`, MCP on Fedora `192.168.1.202`), make sure the MCP port is reachable across the LAN:

```bash
sudo firewall-cmd --list-all
# if 8082/tcp is missing:
sudo firewall-cmd --permanent --add-port=8082/tcp
sudo firewall-cmd --reload
```

### 8.3 — Take it offline

To take the public endpoint offline: dashboard → Public Hostnames → remove `mcp-memo.giuliohome.com`. DNS disappears immediately.

## Update procedure

After pulling new code:

```bash
cd /path/to/memos/mcp-server
git pull
npm install     # only needed when package.json changed
npm run build
systemctl --user restart memos-mcp
journalctl --user -u memos-mcp -n 20
```

## Available Tools

| Tool | Description |
|------|-------------|
| `list_memos` | List and search memos with filters (text, tag, visibility, pinned) |
| `get_memo` | Get full content of a specific memo by ID |
| `create_memo` | Create a new memo (Markdown content, auto-extracts `#tags`; optional `displayTime` to backdate or future-date) |
| `update_memo` | Update memo fields (content, visibility, pinned, archive, `displayTime`) |
| `delete_memo` | Permanently delete a memo |

## Usage Examples

Once connected:

- "Show me my recent memos"
- "Search for memos about docker"
- "Create a memo with my meeting notes"
- "Find pinned memos"
- "Archive the memo about old tasks"

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMOS_URL` | `http://localhost:8081` | Base URL of your Memos instance |
| `MEMOS_TOKEN` | (required) | Memos Personal Access Token |
| `OAUTH_PROVIDER` | (required) | `github` (Auth0 reserved for future) |
| `OAUTH_PUBLIC_BASE_URL` | (required) | Public base URL of this server, e.g. `https://mcp-memo.giuliohome.com` |
| `OAUTH_ALLOWED_USERS` | (required) | Comma-separated GitHub logins; **must list at least one user** — empty refuses to start |
| `PORT` | `8082` | TCP port to listen on (default avoids conflict with Gitea on 3000) |
| `MEMOS_DISPLAY_TZ` | system TZ | IANA timezone (e.g. `Europe/Rome`, `UTC`) used to format `displayTime` / `createTime` in `list_memos` and `get_memo` output. Set explicitly to make output reproducible across hosts. |
