# Memos MCP Server

Connect your [Memos](https://usememos.com) instance to Claude AI via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io).

This MCP server runs as a long-running HTTP service (Streamable HTTP transport, bearer-gated) on the same host as Memos. It is meant to sit **behind the same reverse proxy** that already exposes Memos, so clients reach it at `http://<memos-hostname>/mcp` — same hostname, same port, same TLS as the Memos UI.

One process serves any number of Claude clients on the LAN — Claude Desktop, Claude Code, scripts — without per-session subprocess spawning.

## Features

- **read** your memos
- **search** memos by content, tag, visibility
- **create** new memos with Markdown
- **update** existing memos (content, visibility, pinned, archive)
- **delete** memos permanently
- **works with every Claude surface**: Claude Code CLI, Claude Desktop, **claude.ai web**, and the Claude Android/iOS app — the last two via the same public tunnel, with the bearer token embedded in the URL path (no header field needed)

## Prerequisites

- Node.js 18+
- A running Memos instance reachable from this server (e.g. `http://localhost:8081` if same host)
- A Memos Personal Access Token (PAT)
- A bearer token of your choosing for the MCP endpoint itself

## 1. Get a Memos PAT

1. Open Memos
2. Settings → Personal Access Tokens → create a new token (e.g. "Claude MCP")
3. Copy it — looks like `memos_pat_xxxxxxxxxxxx`

## 2. Generate an MCP bearer token

This is what Claude (and only Claude) will present to call this MCP server.

```bash
openssl rand -hex 32
```

Save it somewhere safe (password manager).

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

# Tokens go in a 0600 env file (NOT in the unit, NOT in shell history)
cat > ~/.memos-mcp.env <<'EOF'
MEMOS_URL=http://localhost:8081
MEMOS_TOKEN=memos_pat_xxxxxxxxxxxx
MCP_BEARER_TOKEN=put_the_openssl_rand_output_here
PORT=8082
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
Memos MCP server listening on :8082 (POST /mcp, bearer-gated)
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

Apply:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 6. Smoke-test the endpoint

Direct against Fedora (bypasses the proxy — useful to isolate problems):

```bash
curl -sS http://192.168.1.202:8082/mcp \
  -H "Authorization: Bearer $MCP_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Through the reverse proxy (the URL Claude will use):

```bash
curl -sS http://memo.home/mcp \
  -H "Authorization: Bearer $MCP_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Both should return a JSON-RPC response listing 5 tools. Without auth (or wrong token) → `401`.

## 7. Register with Claude

### Claude Code

```bash
claude mcp add memos --transport http \
  -H "Authorization: Bearer <MCP_BEARER_TOKEN>" \
  --scope user \
  http://memo.home/mcp
```

### Claude Desktop (Custom Connectors UI)

Settings → Connectors → Add custom connector:

- URL: `http://memo.home/mcp`
- (No OAuth — use the bearer header form)

> **Note:** these LAN URLs only work from inside your network. For claude.ai web, the Android app, or any client outside the LAN, see section 8 below.

## 8. Public exposure via Cloudflare Tunnel

Section 5–7 covers same-LAN clients (Claude Code on a workstation at home, Claude Desktop on the same Wi-Fi). To use this MCP server from claude.ai web, the Claude Android/iOS app, or any client outside your home network, expose it through your existing Cloudflare Tunnel.

The exposure is gated **only** by `MCP_BEARER_TOKEN` — no Cloudflare Access policy in front. Bearer-only is sufficient for all current Claude clients (CLI, Desktop, web, mobile).

### 8.1 — Add a public hostname to your tunnel

In the Cloudflare Zero Trust dashboard:

- Networks → Tunnels → your tunnel → Public Hostnames → **Add a public hostname**.
- Subdomain: `mcp-memo` · Domain: `giuliohome.com` · Path: empty.
- Service: HTTP · URL: `192.168.1.202:8082` (the LAN address of the host running this MCP server).
- Save. Cloudflare auto-creates the CNAME `mcp-memo` → `<tunnel-id>.cfargotunnel.com`.

Do **not** create a Cloudflare Access application for this hostname. The MCP server's bearer check is the gate.

### 8.2 — Allow the MCP port from the cloudflared host

If the cloudflared connector and the MCP server live on different machines (e.g. cloudflared on Debian `192.168.1.122`, MCP on Fedora `192.168.1.202`), make sure the MCP port is reachable across the LAN:

```bash
sudo firewall-cmd --list-all
# if 8082/tcp is missing:
sudo firewall-cmd --permanent --add-port=8082/tcp
sudo firewall-cmd --reload
```

### 8.3 — Smoke test from outside

From any network (4G, office, etc.):

```bash
curl -sS https://mcp-memo.giuliohome.com/mcp \
  -H "Authorization: Bearer $MCP_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Should return JSON-RPC with the 5 tools. Without/wrong token → `401`.

On the MCP host, `journalctl --user -u memos-mcp -f` logs `POST /mcp ip=…` (and `401 /mcp ip=…` for rejected requests) — the IP comes from `X-Forwarded-For` set by cloudflared.

### 8.4 — Register on cloud Claude clients

**Claude Code CLI (anywhere):**

```bash
claude mcp add memos --transport http \
  -H "Authorization: Bearer <MCP_BEARER_TOKEN>" \
  --scope user \
  https://mcp-memo.giuliohome.com/mcp
```

**Claude Desktop:** Settings → Connectors → Add custom connector. URL `https://mcp-memo.giuliohome.com/mcp`, with `Authorization: Bearer <MCP_BEARER_TOKEN>` as a custom header.

**claude.ai web / Android / iOS:** Settings → Connectors → Add custom connector. The web/mobile UI exposes only an URL field (no place for a header), so the server also accepts the bearer **embedded in the URL path**:

```
https://mcp-memo.giuliohome.com/mcp/<MCP_BEARER_TOKEN>
```

Same token, no other change required. A `?bearer=<token>` query string fallback also works.

Once added, the Memos tools (`list_memos`, `get_memo`, `create_memo`, `update_memo`, `delete_memo`) appear in the connector's tool list and can be called from any conversation.

### 8.5 — Rollback

To take the public endpoint offline: dashboard → Public Hostnames → remove `mcp-memo.giuliohome.com`. DNS disappears immediately; LAN access via section 5–7 keeps working.

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
| `MCP_BEARER_TOKEN` | (required) | Bearer token gating the `/mcp` endpoint |
| `PORT` | `8082` | TCP port to listen on (default avoids conflict with Gitea on 3000) |
| `MEMOS_DISPLAY_TZ` | system TZ | IANA timezone (e.g. `Europe/Rome`, `UTC`) used to format `displayTime` / `createTime` in `list_memos` and `get_memo` output. Set explicitly to make output reproducible across hosts. |
