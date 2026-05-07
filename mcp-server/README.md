# Memos MCP Server

Connect your [Memos](https://usememos.com) instance to Claude AI via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io).

## Features

- **read** your memos
- **search** memos by content, tag, visibility
- **create** new memos with Markdown
- **update** existing memos (content, visibility, pinned, archive)
- **delete** memos permanently

## Prerequisites

- Node.js 18+
- A running Memos instance
- A Personal Access Token (PAT) from your Memos instance

## Setup

### 1. Get a Personal Access Token

1. Open your Memos instance
2. Go to Settings → Personal Access Tokens
3. Create a new token (e.g., name it "Claude MCP")
4. Copy the token (it looks like `memos_pat_xxxxxxxxxxxx`)

### 2. Install & Configure

```bash
cd mcp-server
npm install
npm run build
```

### 3. Configure Claude Desktop

Add to your Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
**Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "memos": {
      "command": "node",
      "args": ["/home/giulio/react/memos/mcp-server/dist/index.js"],
      "env": {
        "MEMOS_URL": "http://localhost:8081",
        "MEMOS_TOKEN": "memos_pat_your_token_here"
      }
    }
  }
}
```

Or use `npx tsx` for development (no build needed):

```json
{
  "mcpServers": {
    "memos": {
      "command": "npx",
      "args": ["tsx", "/home/giulio/react/memos/mcp-server/src/index.ts"],
      "env": {
        "MEMOS_URL": "http://localhost:8081",
        "MEMOS_TOKEN": "memos_pat_your_token_here"
      }
    }
  }
}
```

### 4. Restart Claude Desktop

After restarting, you'll see a hammer icon in the chat input indicating the MCP tools are available.

## Available Tools

| Tool | Description |
|------|-------------|
| `list_memos` | List and search memos with filters (text, tag, visibility, pinned) |
| `get_memo` | Get full content of a specific memo by ID |
| `create_memo` | Create a new memo (Markdown content, auto-extracts #tags) |
| `update_memo` | Update memo fields (content, visibility, pinned, archive) |
| `delete_memo` | Permanently delete a memo |

## Usage Examples

Once connected, you can ask Claude things like:

- "Show me my recent memos"
- "Search for memos about docker"
- "Create a memo with my meeting notes"
- "Find pinned memos"
- "Archive the memo about old tasks"

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMOS_URL` | `http://localhost:8081` | Base URL of your Memos instance |
| `MEMOS_TOKEN` | (required) | Personal Access Token starting with `memos_pat_` |
