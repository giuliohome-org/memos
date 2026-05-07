# Memos MCP Server

Connect your [Memos](https://usememos.com) instance to Claude AI via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io).

This MCP server runs as a long-running HTTP service (Streamable HTTP transport, bearer-gated). One process serves any number of Claude clients on the LAN — Claude Desktop, Claude Code, scripts — without per-session subprocess spawning.

## Features

- **read** your memos
- **search** memos by content, tag, visibility
- **create** new memos with Markdown
- **update** existing memos (content, visibility, pinned, archive)
- **delete** memos permanently

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
PORT=3000
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
Memos MCP server listening on :3000 (POST /mcp, bearer-gated)
```

## 5. Smoke-test the endpoint

From the same LAN:

```bash
curl -sS http://<server-host>:3000/mcp \
  -H "Authorization: Bearer $MCP_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Should return a JSON-RPC response listing 5 tools.

Without auth (or wrong token) → `401`.

## 6. Register with Claude

### Claude Code

```bash
claude mcp add memos --transport http \
  -H "Authorization: Bearer <MCP_BEARER_TOKEN>" \
  --scope user \
  http://<server-host>:3000/mcp
```

### Claude Desktop (Custom Connectors UI)

Settings → Connectors → Add custom connector:

- URL: `http://<server-host>:3000/mcp`
- (No OAuth — use the bearer header form)

> **Note:** Claude.ai web's custom connectors are routed via the Anthropic cloud and **cannot reach LAN-only addresses**. To use this server from claude.ai web you'd need a public-facing reverse proxy (e.g. Cloudflare Tunnel) — not covered here.

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
| `create_memo` | Create a new memo (Markdown content, auto-extracts #tags) |
| `update_memo` | Update memo fields (content, visibility, pinned, archive) |
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
| `PORT` | `3000` | TCP port to listen on |
