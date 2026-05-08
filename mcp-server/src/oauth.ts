// OAuth bearer-token validation for the MCP endpoint.
//
// When OAUTH_PROVIDER is set, Claude.ai's custom-connector advanced
// settings hold the upstream OAuth Client ID + Client Secret and run
// the OAuth 2.1 + PKCE flow directly against the IdP. This module's
// job on the server side is therefore minimal:
//
//   1. **Advertise** the IdP via the two well-known metadata endpoints
//      (RFC 9728 + RFC 8414) so Claude.ai can discover authorize/token
//      URLs after our 401 response.
//   2. **Validate** the bearer token Claude.ai eventually presents on
//      /mcp by calling the IdP's userinfo endpoint, with a short cache
//      keyed by SHA-256 of the token.
//
// Single-tenant by design: OAUTH_ALLOWED_USERS is required, so an empty
// allowlist cannot accidentally let any GitHub user in.

import { createHash } from "node:crypto";

export type Provider = "github";

export interface OAuthConfig {
  provider: Provider;
  publicBaseUrl: string;
  allowedUsers: string[];
}

export interface AuthenticatedUser {
  login: string;
}

export type AuthErrorKind = "unauthorized" | "forbidden" | "upstream";

export class AuthError extends Error {
  constructor(public readonly kind: AuthErrorKind, message: string) {
    super(message);
    this.name = "AuthError";
  }
}

interface CachedUser {
  login: string;
  fetchedAt: number;
}

const USERINFO_CACHE_TTL_MS = 5 * 60 * 1000;
const HTTP_TIMEOUT_MS = 10_000;

export class OAuthState {
  private cache = new Map<string, CachedUser>();

  get(key: string): CachedUser | undefined {
    this.prune();
    return this.cache.get(key);
  }

  set(key: string, login: string): void {
    this.cache.set(key, { login, fetchedAt: Date.now() });
  }

  private prune(): void {
    const now = Date.now();
    for (const [k, v] of this.cache) {
      if (now - v.fetchedAt > USERINFO_CACHE_TTL_MS) {
        this.cache.delete(k);
      }
    }
  }
}

export function configFromEnv(): OAuthConfig | null {
  const raw = process.env.OAUTH_PROVIDER?.trim().toLowerCase();
  if (!raw) return null;
  if (raw !== "github") {
    throw new Error(
      `OAUTH_PROVIDER='${raw}' not supported (only 'github' is implemented today)`,
    );
  }
  const publicBaseUrl = process.env.OAUTH_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (!publicBaseUrl) {
    throw new Error("OAUTH_PUBLIC_BASE_URL is required when OAUTH_PROVIDER is set");
  }
  const allowedUsers = (process.env.OAUTH_ALLOWED_USERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (allowedUsers.length === 0) {
    throw new Error(
      "OAUTH_ALLOWED_USERS must list at least one user when OAUTH_PROVIDER is set",
    );
  }
  return { provider: "github", publicBaseUrl, allowedUsers };
}

function tokenKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function validateBearer(
  token: string,
  config: OAuthConfig,
  state: OAuthState,
): Promise<AuthenticatedUser> {
  if (!token) {
    throw new AuthError("unauthorized", "missing bearer token");
  }
  const key = tokenKey(token);
  const cached = state.get(key);
  if (cached) {
    return enforceAllowlist(cached.login, config);
  }
  const login = await fetchGithubLogin(token);
  state.set(key, login);
  return enforceAllowlist(login, config);
}

function enforceAllowlist(login: string, config: OAuthConfig): AuthenticatedUser {
  const ok = config.allowedUsers.some((u) => u.toLowerCase() === login.toLowerCase());
  if (!ok) {
    throw new AuthError("forbidden", `user '${login}' not in OAUTH_ALLOWED_USERS`);
  }
  return { login };
}

async function fetchGithubLogin(token: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch("https://api.github.com/user", {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "User-Agent": "memos-mcp",
      },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (e) {
    throw new AuthError("upstream", `github /user fetch failed: ${(e as Error).message}`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new AuthError("unauthorized", `github rejected token: ${response.status}`);
  }
  if (!response.ok) {
    throw new AuthError("upstream", `github /user returned ${response.status}`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (e) {
    throw new AuthError("upstream", `github /user body: ${(e as Error).message}`);
  }
  const login = (body as { login?: unknown })?.login;
  if (typeof login !== "string" || login.length === 0) {
    throw new AuthError("upstream", "github /user: no 'login' field");
  }
  return login;
}

export function wwwAuthenticateHeader(config: OAuthConfig): string {
  return (
    `Bearer realm="MCP", ` +
    `resource_metadata="${config.publicBaseUrl}/.well-known/oauth-protected-resource"`
  );
}

export function protectedResourceMetadata(config: OAuthConfig): Record<string, unknown> {
  return {
    resource: `${config.publicBaseUrl}/mcp`,
    authorization_servers: [config.publicBaseUrl],
    bearer_methods_supported: ["header"],
    scopes_supported: ["read:user"],
  };
}

export function authorizationServerMetadata(_config: OAuthConfig): Record<string, unknown> {
  return {
    issuer: "https://github.com",
    authorization_endpoint: "https://github.com/login/oauth/authorize",
    token_endpoint: "https://github.com/login/oauth/access_token",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["read:user"],
  };
}
