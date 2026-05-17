import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod/v3";
import { MemosClient } from "./memos-client.js";
import {
  AuthError,
  authorizationServerMetadata,
  configFromEnv as oauthConfigFromEnv,
  dynamicClientRegistration,
  githubAuthorizeURL,
  githubCallbackRedirectURL,
  githubTokenExchange,
  OAuthState,
  protectedResourceMetadata,
  validateBearer,
  wwwAuthenticateHeader,
  type OAuthConfig,
} from "./oauth.js";
import { secretFromEnv } from "./secrets.js";

const MEMOS_URL = process.env.MEMOS_URL || "http://localhost:8081";
const MEMOS_TOKEN = secretFromEnv("MEMOS_TOKEN");
const PORT = parseInt(process.env.PORT ?? "8082", 10);
const DISPLAY_TZ =
  process.env.MEMOS_DISPLAY_TZ ||
  Intl.DateTimeFormat().resolvedOptions().timeZone;

if (!MEMOS_TOKEN) {
  console.error("MEMOS_TOKEN environment variable is required.");
  console.error("Get one from Memos Settings > Personal Access Tokens.");
  process.exit(1);
}

let oauthConfig: OAuthConfig;
try {
  const cfg = oauthConfigFromEnv();
  if (!cfg) {
    console.error(
      "OAUTH_PROVIDER (with OAUTH_PUBLIC_BASE_URL + OAUTH_ALLOWED_USERS) is required.",
    );
    process.exit(1);
  }
  oauthConfig = cfg;
} catch (e) {
  console.error(`OAuth config error: ${(e as Error).message}`);
  process.exit(1);
}
const oauthState = new OAuthState();

const client = new MemosClient(MEMOS_URL, MEMOS_TOKEN);

const VisibilityEnum = z.enum(["PRIVATE", "PROTECTED", "PUBLIC"]);
const StateEnum = z.enum(["NORMAL", "ARCHIVED"]);
const OAUTH_SECURITY_SCHEMES = [
  {
    type: "oauth2",
    scopes: ["read:user"],
  },
];

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
  server.registerTool(
    "list_memos",
    {
      description: "List and search memos. Returns memos matching the given filters. Use this to find recent memos, search by text, filter by tag, or browse your knowledge base.",
      inputSchema: {
        query: z.string().optional().describe("Search text to find in memo content (uses CEL filter: content.contains(\"text\"))"),
        tag: z.string().optional().describe("Filter by tag. Matches any memos containing this tag."),
        visibility: VisibilityEnum.optional().describe("Filter by visibility level"),
        state: StateEnum.optional().default("NORMAL").describe("Memo state: NORMAL (active) or ARCHIVED"),
        pinned: z.boolean().optional().describe("Filter by pinned status"),
        pageSize: z.number().int().min(1).max(100).optional().default(10).describe("Page size (1-100, default 10)"),
        orderBy: z.string().optional().default("display_time desc").describe("Sort order (e.g. 'display_time desc', 'create_time asc')"),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
      _meta: {
        securitySchemes: OAUTH_SECURITY_SCHEMES,
      },
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

  server.registerTool(
    "get_memo",
    {
      description: "Get a specific memo by its ID. Use this to read the full content of a memo.",
      inputSchema: {
        id: z.string().describe("The memo ID (the part after 'memos/', e.g. 'mZ0Qf48KtPHSRxrNnDmZaj')"),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
      _meta: {
        securitySchemes: OAUTH_SECURITY_SCHEMES,
      },
    },
    async ({ id }) => {
      const memo = await client.getMemo(id);

      return {
        content: [{ type: "text", text: formatMemo(memo) }],
      };
    },
  );

  server.registerTool(
    "create_memo",
    {
      description: "Create a new memo. Contents are written in Markdown format. Tags are automatically extracted from #tag syntax in the content. Optionally backdate or future-date the memo with displayTime (the Memos UI calls this 'change date').",
      inputSchema: {
        content: z.string().describe("The memo content in Markdown format. Use #tagname to add tags (e.g. '#todo #work')"),
        visibility: VisibilityEnum.optional().default("PRIVATE").describe("Visibility level. PRIVATE=only you, PROTECTED=logged-in users, PUBLIC=everyone"),
        pinned: z.boolean().optional().default(false).describe("Whether to pin the memo"),
        displayTime: z.string().datetime({ offset: true }).optional().describe("ISO 8601 datetime with timezone offset, e.g. '2026-05-14T09:30:00+02:00' for 14 May 2026 09:30 CEST. Defaults to current time if omitted. Internally the wrapper issues a PATCH after creation because the Memos backend ignores displayTime on POST."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
      _meta: {
        securitySchemes: OAUTH_SECURITY_SCHEMES,
      },
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

  server.registerTool(
    "update_memo",
    {
      description: "Update an existing memo. Only specify the fields you want to change. Setting displayTime moves the memo to a different date in the timeline (same as 'change date' in the Memos UI).",
      inputSchema: {
        id: z.string().describe("The memo ID to update"),
        content: z.string().optional().describe("New Markdown content"),
        visibility: VisibilityEnum.optional().describe("New visibility level"),
        pinned: z.boolean().optional().describe("New pinned status"),
        state: StateEnum.optional().describe("New state: NORMAL or ARCHIVED"),
        displayTime: z.string().datetime({ offset: true }).optional().describe("New display date/time. RFC3339 with timezone offset, e.g. '2026-05-14T09:30:00+02:00'."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
      _meta: {
        securitySchemes: OAUTH_SECURITY_SCHEMES,
      },
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

  server.registerTool(
    "delete_memo",
    {
      description: "Delete a memo permanently. For archiving instead, use update_memo with state: 'ARCHIVED'.",
      inputSchema: {
        id: z.string().describe("The memo ID to delete"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
      _meta: {
        securitySchemes: OAUTH_SECURITY_SCHEMES,
      },
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

function extractHeaderBearer(headerVal: string): string | undefined {
  // RFC 6750: scheme case-insensitive, >=1 whitespace, tolerate trailing whitespace.
  const m = headerVal.match(/^Bearer\s+(.+?)\s*$/i);
  return m ? m[1] : undefined;
}

type AuthOutcome =
  | { ok: true; user: string }
  | { ok: false; status: number; wwwAuthenticate: string };

async function authenticate(headerVal: string): Promise<AuthOutcome> {
  const headerToken = extractHeaderBearer(headerVal);
  if (headerToken) {
    try {
      const user = await validateBearer(headerToken, oauthConfig, oauthState);
      return { ok: true, user: user.login };
    } catch (e) {
      if (e instanceof AuthError) {
        console.error(`/mcp auth ${e.kind}: ${e.message}`);
        if (e.kind === "forbidden") {
          return {
            ok: false,
            status: 403,
            wwwAuthenticate: wwwAuthenticateHeader(oauthConfig),
          };
        }
      } else {
        console.error(`/mcp auth unexpected error: ${(e as Error).message}`);
      }
      // fall through to 401
    }
  }
  return {
    ok: false,
    status: 401,
    wwwAuthenticate: wwwAuthenticateHeader(oauthConfig),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function describeMcpRequest(body: unknown): string {
  return mcpMethods(body).map(({ method, tool }) => {
    return tool ? `${method} tool=${tool}` : method;
  }).join(",");
}

function mcpMethods(body: unknown): Array<{ method: string; tool?: string }> {
  const messages = Array.isArray(body) ? body : [body];
  return messages.map((message) => {
    if (!isRecord(message)) {
      return { method: "unknown" };
    }
    const method = typeof message.method === "string" ? message.method : "unknown";
    if (method !== "tools/call" || !isRecord(message.params)) {
      return { method };
    }
    const tool = typeof message.params.name === "string" ? message.params.name : "unknown";
    return { method, tool };
  });
}

function isPublicMcpDiscoveryRequest(body: unknown): boolean {
  const publicMethods = new Set([
    "initialize",
    "notifications/initialized",
    "tools/list",
    "resources/list",
    "prompts/list",
    "ping",
  ]);
  return mcpMethods(body).every(({ method }) => publicMethods.has(method));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function queryStringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function describeAuthorizeQuery(query: Record<string, unknown>): string {
  const clientID = queryStringValue(query.client_id);
  const redirectURI = queryStringValue(query.redirect_uri) ?? "missing";
  const scope = queryStringValue(query.scope) ?? "missing";
  const responseType = queryStringValue(query.response_type) ?? "missing";
  const hasState = queryStringValue(query.state) ? "yes" : "no";
  const hasPKCE = queryStringValue(query.code_challenge) ? "yes" : "no";
  const resource = queryStringValue(query.resource) ?? "missing";
  const clientIDPrefix = clientID ? `${clientID.slice(0, 8)}...` : "missing";
  return `client_id=${clientIDPrefix} redirect_uri=${redirectURI} scope=${scope} response_type=${responseType} state=${hasState} pkce=${hasPKCE} resource=${resource}`;
}

async function main(): Promise<void> {
  const app = express();
  // Honor X-Forwarded-For from cloudflared / nginx so req.ip is the real client.
  app.set("trust proxy", true);
  app.options("/oauth/register", (req, res) => {
    console.error(`/oauth/register options ip=${req.ip}`);
    res.setHeader("Access-Control-Allow-Origin", "https://chatgpt.com");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.status(204).end();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "20kb" }));
  app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!err) {
      next();
      return;
    }
    console.error(`request parse error method=${req.method} path=${req.path} ip=${req.ip}: ${errorMessage(err)}`);
    res.status(400).json({ error: "invalid_request", error_description: "request body parse failed" });
  });

  // Catch-all request logger registered BEFORE any route so it sees every
  // inbound HTTP request (including 404s). /mcp body lines are noisy, so we
  // skip them here — the /mcp handler logs its own method= line later.
  app.use((req, _res, next) => {
    if (!req.path.startsWith("/mcp")) {
      console.error(`req method=${req.method} path=${req.path} ip=${req.ip}`);
    }
    next();
  });

  // OAuth discovery — must be reachable unauthenticated, so register before /mcp guard.
  // Cache-Control no-store forces clients to re-fetch on each setup attempt;
  // ChatGPT caches metadata aggressively and silently re-uses stale payloads
  // across reconnect attempts otherwise (so server-side fixes are never seen).
  const noStore: express.RequestHandler = (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    next();
  };
  const protectedResourceHandler: express.RequestHandler = (req, res) => {
    console.error(`/.well-known/oauth-protected-resource path=${req.path} ip=${req.ip}`);
    res.json(protectedResourceMetadata(oauthConfig));
  };
  app.get("/.well-known/oauth-protected-resource", noStore, protectedResourceHandler);
  app.get("/.well-known/oauth-protected-resource/mcp", noStore, protectedResourceHandler);
  app.get("/.well-known/oauth-authorization-server", noStore, (req, res) => {
    console.error(`/.well-known/oauth-authorization-server ip=${req.ip}`);
    res.json(authorizationServerMetadata(oauthConfig));
  });
  app.post("/oauth/register", noStore, (req, res) => {
    const redirectCount = Array.isArray(req.body?.redirect_uris) ? req.body.redirect_uris.length : 0;
    console.error(`/oauth/register redirect_uris=${redirectCount} ip=${req.ip}`);
    const result = dynamicClientRegistration(req.body as Record<string, unknown>, oauthConfig);
    console.error(`/oauth/register status=${result.status} ip=${req.ip}`);
    res.status(result.status).json(result.body);
  });
  app.get("/oauth/authorize", (req, res) => {
    const location = githubAuthorizeURL(req.query, oauthConfig);
    console.error(`/oauth/authorize ${describeAuthorizeQuery(req.query)} ip=${req.ip}`);
    console.error(`/oauth/authorize redirect=${location} ip=${req.ip}`);
    res.redirect(location);
  });
  app.get("/oauth/github/callback", (req, res) => {
    const hasCode = typeof req.query.code === "string" ? "yes" : "no";
    const hasState = typeof req.query.state === "string" ? "yes" : "no";
    const error = typeof req.query.error === "string" ? req.query.error : "none";
    const location = githubCallbackRedirectURL(req.query, oauthConfig, oauthState);
    console.error(`/oauth/github/callback code=${hasCode} state=${hasState} error=${error} ip=${req.ip}`);
    console.error(`/oauth/github/callback redirect=${location} ip=${req.ip}`);
    res.redirect(location);
  });
  app.post("/oauth/token", async (req, res) => {
    console.error(`/oauth/token grant=${typeof req.body?.grant_type === "string" ? req.body.grant_type : "unknown"} ip=${req.ip}`);
    const result = await githubTokenExchange(req.body as Record<string, unknown>, req.header("authorization"), oauthConfig, oauthState);
    console.error(`/oauth/token status=${result.status} ip=${req.ip}`);
    res.status(result.status).json(result.body);
  });

  app.use("/mcp", async (req, res, next) => {
    if (req.method === "POST" && isPublicMcpDiscoveryRequest(req.body)) {
      const requestDescription = describeMcpRequest(req.body);
      console.error(`/mcp public-discovery method=${requestDescription} ip=${req.ip}`);
      next();
      return;
    }
    const outcome = await authenticate(req.header("authorization") ?? "");
    if (!outcome.ok) {
      // Log only aggregate signal — never the URL or header value, which
      // would persist failed bearer attempts in journalctl.
      const via = req.header("authorization") ? "header" : "none";
      console.error(`${outcome.status} /mcp ip=${req.ip} via=${via}`);
      res.setHeader("WWW-Authenticate", outcome.wwwAuthenticate);
      res.status(outcome.status).end();
      return;
    }
    res.locals.mcpUser = outcome.user;
    console.error(`/mcp auth ok user=${outcome.user} ip=${req.ip}`);
    next();
  });

  // Streamable HTTP in stateless mode: a fresh McpServer + transport per
  // request keeps clients fully isolated and avoids request-id collisions.
  app.post("/mcp", async (req, res) => {
    const user = typeof res.locals.mcpUser === "string" ? res.locals.mcpUser : "unknown";
    const requestDescription = describeMcpRequest(req.body);
    console.error(`/mcp method=${requestDescription} user=${user} ip=${req.ip}`);
    res.on("finish", () => {
      console.error(`/mcp status=${res.statusCode} method=${requestDescription} user=${user} ip=${req.ip}`);
    });
    try {
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
      console.error(`MCP POST handler error: ${errorMessage(err)}`);
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
  app.get("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed: stateless server doesn't accept GET /mcp" },
      id: null,
    });
  });

  app.listen(PORT, () => {
    console.error(
      `Memos MCP server listening on :${PORT} (POST /mcp, ` +
        `oauth=${oauthConfig.provider}(${oauthConfig.allowedUsers.join(",")}), ` +
        `dcrGithubClient=${oauthConfig.githubClientID ? "configured" : "missing"}, ` +
        `dcrGithubSecret=${oauthConfig.githubClientSecret ? "configured" : "missing"}, stateless)`,
    );
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
