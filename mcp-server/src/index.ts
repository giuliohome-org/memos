import express from "express";
import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod/v3";
import { MemosClient } from "./memos-client.js";
import {
  AuthError,
  authorizationServerMetadata,
  configFromEnv as oauthConfigFromEnv,
  OAuthState,
  protectedResourceMetadata,
  validateBearer,
  wwwAuthenticateHeader,
  type OAuthConfig,
} from "./oauth.js";

const MEMOS_URL = process.env.MEMOS_URL || "http://localhost:8081";
const MEMOS_TOKEN = process.env.MEMOS_TOKEN;
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;
const PORT = parseInt(process.env.PORT ?? "8082", 10);
const DISPLAY_TZ =
  process.env.MEMOS_DISPLAY_TZ ||
  Intl.DateTimeFormat().resolvedOptions().timeZone;

if (!MEMOS_TOKEN) {
  console.error("MEMOS_TOKEN environment variable is required.");
  console.error("Get one from Memos Settings > Personal Access Tokens.");
  process.exit(1);
}

let oauthConfig: OAuthConfig | null;
try {
  oauthConfig = oauthConfigFromEnv();
} catch (e) {
  console.error(`OAuth config error: ${(e as Error).message}`);
  process.exit(1);
}
const oauthState = new OAuthState();

if (!MCP_BEARER_TOKEN && !oauthConfig) {
  console.error("At least one auth method must be configured: MCP_BEARER_TOKEN, or");
  console.error("OAUTH_PROVIDER (with OAUTH_PUBLIC_BASE_URL + OAUTH_ALLOWED_USERS).");
  process.exit(1);
}

const client = new MemosClient(MEMOS_URL, MEMOS_TOKEN);

const VisibilityEnum = z.enum(["PRIVATE", "PROTECTED", "PUBLIC"]);
const StateEnum = z.enum(["NORMAL", "ARCHIVED"]);

interface MemoData {
  name: string;
  content: string;
  visibility: string;
  pinned: boolean;
  tags: string[];
  createTime: string;
  displayTime?: string;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  // sv-SE gives ISO-like "YYYY-MM-DD HH:mm" output, projected into DISPLAY_TZ.
  return d.toLocaleString("sv-SE", {
    timeZone: DISPLAY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMemo(memo: MemoData): string {
  const id = memo.name.slice(6); // remove "memos/" prefix
  const pin = memo.pinned ? "[PINNED] " : "";
  const tagStr = memo.tags.length ? ` #${memo.tags.join(" #")}` : "";
  const vis = memo.visibility === "PRIVATE" ? "" : ` (${memo.visibility})`;
  const ts = memo.displayTime || memo.createTime;
  const time = ts ? ` @ ${formatTimestamp(ts)}` : "";

  return `${pin}**${id}**${vis}${time}\n${memo.content}${tagStr}`;
}

function registerTools(server: McpServer): void {
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
    "Create a new memo. Contents are written in Markdown format. Tags are automatically extracted from #tag syntax in the content. Optionally backdate or future-date the memo with displayTime (the Memos UI calls this 'change date').",
    {
      content: z.string().describe("The memo content in Markdown format. Use #tagname to add tags (e.g. '#todo #work')"),
      visibility: VisibilityEnum.optional().default("PRIVATE").describe("Visibility level. PRIVATE=only you, PROTECTED=logged-in users, PUBLIC=everyone"),
      pinned: z.boolean().optional().default(false).describe("Whether to pin the memo"),
      displayTime: z.string().datetime({ offset: true }).optional().describe("ISO 8601 datetime with timezone offset, e.g. '2026-05-14T09:30:00+02:00' for 14 May 2026 09:30 CEST. Defaults to current time if omitted. Internally the wrapper issues a PATCH after creation because the Memos backend ignores displayTime on POST."),
    },
    async ({ content, visibility, pinned, displayTime }) => {
      const memo = await client.createMemo({
        content,
        visibility,
        pinned,
        displayTime,
      });

      return {
        content: [{ type: "text", text: `Memo created successfully:\n\n${formatMemo(memo)}` }],
      };
    },
  );

  server.tool(
    "update_memo",
    "Update an existing memo. Only specify the fields you want to change. Setting displayTime moves the memo to a different date in the timeline (same as 'change date' in the Memos UI).",
    {
      id: z.string().describe("The memo ID to update"),
      content: z.string().optional().describe("New Markdown content"),
      visibility: VisibilityEnum.optional().describe("New visibility level"),
      pinned: z.boolean().optional().describe("New pinned status"),
      state: StateEnum.optional().describe("New state: NORMAL or ARCHIVED"),
      displayTime: z.string().datetime({ offset: true }).optional().describe("New display date/time. RFC3339 with timezone offset, e.g. '2026-05-14T09:30:00+02:00'."),
    },
    async ({ id, content, visibility, pinned, state, displayTime }) => {
      const memo = await client.updateMemo(id, {
        content,
        visibility,
        pinned,
        state,
        displayTime,
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
}

function buildServer(): McpServer {
  const server = new McpServer({ name: "memos", version: "1.0.0" });
  registerTools(server);
  return server;
}

function staticBearerOk(candidate: string | undefined): boolean {
  if (!candidate || !MCP_BEARER_TOKEN) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(MCP_BEARER_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function extractHeaderBearer(headerVal: string): string | undefined {
  // RFC 6750: scheme case-insensitive, >=1 whitespace, tolerate trailing whitespace.
  const m = headerVal.match(/^Bearer\s+(.+?)\s*$/i);
  return m ? m[1] : undefined;
}

type AuthOutcome =
  | { ok: true; via: "header-static" | "header-oauth" | "url" }
  | { ok: false; status: number; wwwAuthenticate?: string };

async function authenticate(
  headerVal: string,
  urlToken: string | undefined,
): Promise<AuthOutcome> {
  const headerToken = extractHeaderBearer(headerVal);

  // Static bearer wins (cheap comparison) — works for both header and URL forms.
  if (staticBearerOk(headerToken) || staticBearerOk(urlToken)) {
    return { ok: true, via: headerToken ? "header-static" : "url" };
  }

  // OAuth path applies only to header tokens (URL/query bearer forms remain
  // static-only — OAuth tokens are not safe to put in a URL).
  if (oauthConfig && headerToken) {
    try {
      const user = await validateBearer(headerToken, oauthConfig, oauthState);
      console.error(`/mcp auth ok via=oauth user=${user.login}`);
      return { ok: true, via: "header-oauth" };
    } catch (e) {
      if (e instanceof AuthError) {
        console.error(`/mcp auth ${e.kind}: ${e.message}`);
        if (e.kind === "forbidden") {
          return { ok: false, status: 403 };
        }
      } else {
        console.error(`/mcp auth unexpected error: ${(e as Error).message}`);
      }
      // fall through to 401 with WWW-Authenticate
    }
  }

  if (oauthConfig) {
    return {
      ok: false,
      status: 401,
      wwwAuthenticate: wwwAuthenticateHeader(oauthConfig),
    };
  }
  return { ok: false, status: 401 };
}

async function main(): Promise<void> {
  const app = express();
  // Honor X-Forwarded-For from cloudflared / nginx so req.ip is the real client.
  app.set("trust proxy", true);
  app.use(express.json({ limit: "1mb" }));

  // OAuth discovery — must be reachable unauthenticated, so register before /mcp guard.
  if (oauthConfig) {
    const cfg = oauthConfig;
    app.get("/.well-known/oauth-protected-resource", (_req, res) => {
      res.json(protectedResourceMetadata(cfg));
    });
    app.get("/.well-known/oauth-authorization-server", (_req, res) => {
      res.json(authorizationServerMetadata(cfg));
    });
  }

  app.use("/mcp", async (req, res, next) => {
    const queryToken = typeof req.query.bearer === "string" ? req.query.bearer : undefined;
    // Path-based token: /mcp/<token> (req.path is relative to mount, so "/<token>")
    const pathMatch = req.path.match(/^\/([^/]+)\/?$/);
    const pathToken = pathMatch ? pathMatch[1] : undefined;
    const outcome = await authenticate(
      req.header("authorization") ?? "",
      queryToken ?? pathToken,
    );
    if (!outcome.ok) {
      // Log only aggregate signal — never the URL or header value, which
      // would persist failed bearer attempts in journalctl.
      const via =
        req.header("authorization") ? "header" :
        queryToken ? "query" :
        pathToken ? "path" : "none";
      console.error(`${outcome.status} /mcp ip=${req.ip} via=${via}`);
      if (outcome.wwwAuthenticate) {
        res.setHeader("WWW-Authenticate", outcome.wwwAuthenticate);
      }
      res.status(outcome.status).end();
      return;
    }
    next();
  });

  // Streamable HTTP in stateless mode: a fresh McpServer + transport per
  // request keeps clients fully isolated and avoids request-id collisions.
  app.post(["/mcp", "/mcp/:token"], async (req, res) => {
    try {
      console.error(`POST /mcp ip=${req.ip}`);
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.on("close", () => {
        transport.close().catch(() => undefined);
        server.close().catch(() => undefined);
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("MCP POST handler error:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // SSE GET is not meaningful in stateless mode (no persistent session
  // for the server to push notifications to). Reject cleanly.
  app.get(["/mcp", "/mcp/:token"], (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed: stateless server doesn't accept GET /mcp" },
      id: null,
    });
  });

  app.listen(PORT, () => {
    const modes: string[] = [];
    if (MCP_BEARER_TOKEN) modes.push("static-bearer");
    if (oauthConfig) modes.push(`oauth=${oauthConfig.provider}(${oauthConfig.allowedUsers.join(",")})`);
    console.error(`Memos MCP server listening on :${PORT} (POST /mcp, ${modes.join(" + ")}, stateless)`);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
