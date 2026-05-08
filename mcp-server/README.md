# Memos MCP Server

Connect your [Memos](https://usememos.com) instance to Claude AI via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io).

This MCP server runs as a long-running HTTP service (Streamable HTTP transport) on the same host as Memos. It is meant to sit **behind the same reverse proxy** that already exposes Memos, so clients reach it at `http://<memos-hostname>/mcp` — same hostname, same port, same TLS as the Memos UI.

The `/mcp` endpoint is gated by **OAuth via GitHub**: Claude.ai's
custom-connector advanced settings hold the GitHub OAuth Client ID +
Client Secret and run the OAuth 2.1 + PKCE flow themselves; this server
only advertises the IdP via the two well-known metadata endpoints
([RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728) +
[RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414)) and validates
the resulting bearer by calling `https://api.github.com/user` (5-min
cache, SHA-256-hashed token key).

One process serves any number of Claude clients on the LAN — Claude Desktop, Claude Code, scripts — without per-session subprocess spawning.

## Features

- **read** your memos
- **search** memos by content, tag, visibility
- **create** new memos with Markdown
- **update** existing memos (content, visibility, pinned, archive)
- **delete** memos permanently
- **works with every Claude surface**: Claude Code CLI, Claude Desktop, **claude.ai web**, and the Claude Android/iOS app — all four go through the same OAuth flow against your GitHub OAuth App

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

Claude.ai's custom-connector advanced settings accept an OAuth
**Client ID + Client Secret** ([only those two
fields](https://github.com/anthropics/claude-ai-mcp/issues/112)) so it can
run the full OAuth 2.1 + PKCE flow itself, and our server only validates
the resulting bearer.

1. GitHub → *Settings* → *Developer settings* → *OAuth Apps* → *New OAuth App*:
   - *Authorization callback URL*: `https://claude.ai/api/mcp/auth_callback`
   - Copy the *Client ID* and generate a *Client Secret*.
2. Set on this server (in `~/.memos-mcp.env`, see section 4):
   ```
   OAUTH_PROVIDER=github
   OAUTH_PUBLIC_BASE_URL=https://mcp-memo.giuliohome.com
   OAUTH_ALLOWED_USERS=giuliohome
   ```
   `OAUTH_ALLOWED_USERS` is **required** — comma-separated GitHub logins;
   an empty value refuses to start, so a misconfiguration cannot silently
   let any GitHub user in.
3. The GitHub OAuth App's Client ID + Secret are pasted into Claude.ai's
   connector advanced settings (section 7) — **not** stored on this server.

## 3. Install & build

```bash
cd mcp-server
npm install
npm run build
```

`dist/index.js` is the entrypoint.

## 4. Run as a daemon (systemd user unit)

This keeps the server running and restarts it on failure. The provided unit and env-file template let you avoid putting tokens on the command line.

```bash
# One-time: enable user services to run after logout
sudo loginctl enable-linger "$USER"

# Tokens go in a 0600 env file (NOT in the unit, NOT in shell history).
cat > ~/.memos-mcp.env <<'EOF'
MEMOS_URL=http://localhost:8081
MEMOS_TOKEN=memos_pat_xxxxxxxxxxxx
PORT=8082

OAUTH_PROVIDER=github
OAUTH_PUBLIC_BASE_URL=https://mcp-memo.giuliohome.com
OAUTH_ALLOWED_USERS=giuliohome
EOF
chmod 600 ~/.memos-mcp.env

# Install the unit
mkdir -p ~/.config/systemd/user
cp systemd/memos-mcp.service ~/.config/systemd/user/

# (Optional) edit the unit if your repo path differs from the default
# default in the file: /home/giulio/react/memos/mcp-server

systemctl --user daemon-reload
systemctl --user enable --now memos-mcp.service
systemctl --user status memos-mcp.service
```

Tail the logs with:

```bash
journalctl --user -u memos-mcp -f
```

You should see:

```
Memos MCP server listening on :8082 (POST /mcp, oauth=github(giuliohome), stateless)
```

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

If you also want the OAuth discovery endpoints to work over the LAN
proxy (not strictly needed — Claude.ai uses the public Cloudflare tunnel
hostname), add `location /.well-known/` pointing at the same backend.

Apply:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 6. Smoke-test the endpoint

The OAuth discovery endpoints don't need authentication — they should
return JSON straight away:

```bash
curl -sS https://mcp-memo.giuliohome.com/.well-known/oauth-protected-resource | jq
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
# expected: JSON-RPC body listing the 5 tools (and a /mcp auth ok user=… line in journalctl)
```

## 7. Register with Claude

### claude.ai web / Android / iOS

Settings → Connectors → Add custom connector:

- URL: `https://mcp-memo.giuliohome.com/mcp`
- Open *Advanced settings* and paste the GitHub OAuth App's Client ID +
  Client Secret (from section 2).

The first request returns `401` with `WWW-Authenticate: … resource_metadata=…`;
Claude.ai discovers the GitHub authorize/token URLs from our well-known
metadata, walks you through `github.com/login/oauth/authorize`, and
forwards the resulting bearer on every subsequent `/mcp` call. The server
validates each request by calling `https://api.github.com/user`.

### Claude Desktop / Claude Code

Same connector URL, same OAuth flow. Claude Desktop and Claude Code both
implement OAuth-aware MCP clients and will discover the metadata
endpoints automatically when they hit the 401.

Once added, the Memos tools (`list_memos`, `get_memo`, `create_memo`, `update_memo`, `delete_memo`) appear in the connector's tool list and can be called from any conversation.

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
