import express from "express";
import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod/v3";
import { MemosClient } from "./memos-client.js";

const MEMOS_URL = process.env.MEMOS_URL || "http://localhost:8081";
const MEMOS_TOKEN = process.env.MEMOS_TOKEN;
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;
const PORT = parseInt(process.env.PORT ?? "3000", 10);

if (!MEMOS_TOKEN) {
  console.error("MEMOS_TOKEN environment variable is required.");
  console.error("Get one from Memos Settings > Personal Access Tokens.");
  process.exit(1);
}
if (!MCP_BEARER_TOKEN) {
  console.error("MCP_BEARER_TOKEN environment variable is required.");
  console.error("Generate one with: openssl rand -hex 32");
  process.exit(1);
}

const client = new MemosClient(MEMOS_URL, MEMOS_TOKEN);

const VisibilityEnum = z.enum(["PRIVATE", "PROTECTED", "PUBLIC"]);
const StateEnum = z.enum(["NORMAL", "ARCHIVED"]);

const server = new McpServer({
  name: "memos",
  version: "1.0.0",
});

interface MemoData {
  name: string;
  content: string;
  visibility: string;
  pinned: boolean;
  tags: string[];
  createTime: string;
}

function formatMemo(memo: MemoData): string {
  const id = memo.name.slice(6); // remove "memos/" prefix
  const pin = memo.pinned ? "[PINNED] " : "";
  const tagStr = memo.tags.length ? ` #${memo.tags.join(" #")}` : "";
  const vis = memo.visibility === "PRIVATE" ? "" : ` (${memo.visibility})`;
  const time = memo.createTime ? ` @ ${memo.createTime.slice(0, 16).replace("T", " ")}` : "";

  return `${pin}**${id}**${vis}${time}\n${memo.content}${tagStr}`;
}

server.tool(
  "list_memos",
  "List and search memos. Returns memos matching the given filters. Use this to find recent memos, search by text, filter by tag, or browse your knowledge base.",
  {
    query: z.string().optional().describe("Search text to find in memo content (uses CEL filter: content.contains(\"text\"))"),
    tag: z.string().optional().describe("Filter by tag. Matches any memos containing this tag."),
    visibility: VisibilityEnum.optional().describe("Filter by visibility level"),
    state: StateEnum.optional().default("NORMAL").describe("Memo state: NORMAL (active) or ARCHIVED"),
    pinned: z.boolean().optional().describe("Filter by pinned status"),
    pageSize: z.number().int().min(1).max(100).optional().default(10).describe("Page size (1-100, default 10)"),
    orderBy: z.string().optional().default("display_time desc").describe("Sort order (e.g. 'display_time desc', 'create_time asc')"),
  },
  async (params) => {
    const filterParts: string[] = [];

    if (params.query) {
      filterParts.push(`content.contains("${params.query.replace(/"/g, '\\"')}")`);
    }
    if (params.tag) {
      filterParts.push(`"${params.tag.replace(/"/g, '\\"')}" in tags`);
    }
    if (params.visibility) {
      filterParts.push(`visibility == "${params.visibility}"`);
    }
    if (params.pinned !== undefined) {
      filterParts.push(params.pinned ? "pinned" : "!pinned");
    }

    const filter = filterParts.length > 0 ? filterParts.join(" && ") : undefined;

    const result = await client.listMemos({
      pageSize: params.pageSize,
      state: params.state,
      orderBy: params.orderBy,
      filter,
    });

    if (!result.memos || result.memos.length === 0) {
      return {
        content: [{ type: "text", text: "No memos found." }],
      };
    }

    const lines = result.memos.map((m) => formatMemo(m));
    let responseText = lines.join("\n\n---\n\n");

    if (result.nextPageToken) {
      responseText += `\n\n---\n\nMore memos available. Use pageToken "${result.nextPageToken}" for the next page.`;
    }

    return {
      content: [{ type: "text", text: responseText }],
    };
  },
);

server.tool(
  "get_memo",
  "Get a specific memo by its ID. Use this to read the full content of a memo.",
  {
    id: z.string().describe("The memo ID (the part after 'memos/', e.g. 'mZ0Qf48KtPHSRxrNnDmZaj')"),
  },
  async ({ id }) => {
    const memo = await client.getMemo(id);

    return {
      content: [{ type: "text", text: formatMemo(memo) }],
    };
  },
);

server.tool(
  "create_memo",
  "Create a new memo. Contents are written in Markdown format. Tags are automatically extracted from #tag syntax in the content.",
  {
    content: z.string().describe("The memo content in Markdown format. Use #tagname to add tags (e.g. '#todo #work')"),
    visibility: VisibilityEnum.optional().default("PRIVATE").describe("Visibility level. PRIVATE=only you, PROTECTED=logged-in users, PUBLIC=everyone"),
    pinned: z.boolean().optional().default(false).describe("Whether to pin the memo"),
  },
  async ({ content, visibility, pinned }) => {
    const memo = await client.createMemo({
      content,
      visibility,
      pinned,
    });

    return {
      content: [{ type: "text", text: `Memo created successfully:\n\n${formatMemo(memo)}` }],
    };
  },
);

server.tool(
  "update_memo",
  "Update an existing memo. Only specify the fields you want to change.",
  {
    id: z.string().describe("The memo ID to update"),
    content: z.string().optional().describe("New Markdown content"),
    visibility: VisibilityEnum.optional().describe("New visibility level"),
    pinned: z.boolean().optional().describe("New pinned status"),
    state: StateEnum.optional().describe("New state: NORMAL or ARCHIVED"),
  },
  async ({ id, content, visibility, pinned, state }) => {
    const memo = await client.updateMemo(id, {
      content,
      visibility,
      pinned,
      state,
    });

    return {
      content: [{ type: "text", text: `Memo updated successfully:\n\n${formatMemo(memo)}` }],
    };
  },
);

server.tool(
  "delete_memo",
  "Delete a memo permanently. For archiving instead, use update_memo with state: 'ARCHIVED'.",
  {
    id: z.string().describe("The memo ID to delete"),
  },
  async ({ id }) => {
    await client.deleteMemo(id);

    return {
      content: [{ type: "text", text: `Memo "${id}" deleted successfully.` }],
    };
  },
);

function bearerOk(presented: string): boolean {
  const expected = `Bearer ${MCP_BEARER_TOKEN}`;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function main(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.use("/mcp", (req, res, next) => {
    if (!bearerOk(req.header("authorization") ?? "")) {
      res.status(401).end();
      return;
    }
    next();
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });
  await server.connect(transport);

  app.post("/mcp", (req, res) => {
    transport.handleRequest(req, res, req.body).catch((err) => {
      console.error("MCP handler error:", err);
      if (!res.headersSent) res.status(500).end();
    });
  });
  app.get("/mcp", (req, res) => {
    transport.handleRequest(req, res).catch((err) => {
      console.error("MCP handler error:", err);
      if (!res.headersSent) res.status(500).end();
    });
  });

  app.listen(PORT, () => {
    console.error(`Memos MCP server listening on :${PORT} (POST /mcp, bearer-gated)`);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
