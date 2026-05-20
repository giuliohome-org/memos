// OAuth bearer-token validation + lightweight OAuth broker for the MCP endpoint.
//
// ChatGPT MCP requires that the authorization_server be controlled by the MCP
// server (it abandons discovery if authorization_endpoint points to a 3rd-party
// host like github.com directly). We therefore expose our own /oauth/authorize,
// /oauth/github/callback, /oauth/token endpoints that proxy GitHub OAuth, sign
// state/codes with HMAC, and validate the resulting bearer via api.github.com/user.
//
// RFC 9207 (iss parameter): the callback redirect includes `iss=<publicBaseUrl>`
// to defend against authorization-server mix-up attacks. Without this ChatGPT
// silently drops the callback and never reaches /oauth/token.
//
// Single-tenant by design: OAUTH_ALLOWED_USERS is required.

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { secretFromEnv } from "./secrets.js";

export type Provider = "github";

export interface OAuthConfig {
  provider: Provider;
  publicBaseUrl: string;
  allowedUsers: string[];
  refreshTokenSecret: string;
  githubClientID?: string;
  githubClientSecret?: string;
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

interface SignedAuthorizeState {
  clientID: string;
  redirectURI: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  resource?: string;
  issuedAt: number;
}

interface SignedAuthorizationCode extends SignedAuthorizeState {
  githubCode: string;
}

interface RegisteredClient {
  redirectURIs: string[];
  scope: string;
  issuedAt: number;
}

const USERINFO_CACHE_TTL_MS = 5 * 60 * 1000;
const HTTP_TIMEOUT_MS = 10_000;
const OAUTH_CODE_TTL_MS = 10 * 60 * 1000;
const DCR_CLIENT_PREFIX = "memosdcr";

export class OAuthState {
  private cache = new Map<string, CachedUser>();
  private codes = new Map<string, SignedAuthorizationCode>();

  get(key: string): CachedUser | undefined {
    this.prune();
    return this.cache.get(key);
  }

  set(key: string, login: string): void {
    this.cache.set(key, { login, fetchedAt: Date.now() });
  }

  setCode(code: SignedAuthorizationCode): string {
    this.prune();
    const key = randomUUID();
    this.codes.set(key, code);
    return key;
  }

  takeCode(key: string): SignedAuthorizationCode | undefined {
    this.prune();
    const code = this.codes.get(key);
    this.codes.delete(key);
    return code;
  }

  private prune(): void {
    const now = Date.now();
    for (const [k, v] of this.cache) {
      if (now - v.fetchedAt > USERINFO_CACHE_TTL_MS) {
        this.cache.delete(k);
      }
    }
    for (const [k, v] of this.codes) {
      if (now - v.issuedAt > OAUTH_CODE_TTL_MS) {
        this.codes.delete(k);
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
  const refreshTokenSecret = secretFromEnv("OAUTH_REFRESH_TOKEN_SECRET") ?? secretFromEnv("MEMOS_TOKEN");
  if (!refreshTokenSecret) {
    throw new Error("OAUTH_REFRESH_TOKEN_SECRET or MEMOS_TOKEN is required when OAUTH_PROVIDER is set");
  }
  const githubClientID = firstEnv("GITHUB_OAUTH_CLIENT_ID", "OAUTH_GITHUB_CLIENT_ID", "OAUTH_CLIENT_ID");
  const githubClientSecret = firstEnv("GITHUB_OAUTH_CLIENT_SECRET", "OAUTH_GITHUB_CLIENT_SECRET", "OAUTH_CLIENT_SECRET");
  return { provider: "github", publicBaseUrl, allowedUsers, refreshTokenSecret, githubClientID, githubClientSecret };
}

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = secretFromEnv(name);
    if (value) return value;
  }
  return undefined;
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

export function authorizationServerMetadata(config: OAuthConfig): Record<string, unknown> {
  return {
    issuer: config.publicBaseUrl,
    authorization_endpoint: `${config.publicBaseUrl}/oauth/authorize`,
    token_endpoint: `${config.publicBaseUrl}/oauth/token`,
    registration_endpoint: `${config.publicBaseUrl}/oauth/register`,
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["read:user"],
    // RFC 9207: we always include the `iss` parameter in callbacks.
    authorization_response_iss_parameter_supported: true,
    // MCP spec: advertise CIMD support so strict clients see at least one
    // modern client-id mechanism. We don't actively fetch CIMD documents but
    // accepting URL-shaped client_ids is harmless (we just pass them through
    // to GitHub which will fail if invalid).
    client_id_metadata_document_supported: false,
  };
}

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function unbase64url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function signRefreshPayload(payload: string, config: OAuthConfig): string {
  return createHmac("sha256", config.refreshTokenSecret).update(payload).digest("base64url");
}

function createSignedValue(prefix: string, value: Record<string, unknown>, config: OAuthConfig): string {
  const payload = base64url(JSON.stringify(value));
  return `${prefix}.${payload}.${signRefreshPayload(payload, config)}`;
}

function readSignedValue<T>(value: string, prefix: string, config: OAuthConfig): T | undefined {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== prefix) {
    return undefined;
  }
  const expected = Buffer.from(signRefreshPayload(parts[1], config));
  const actual = Buffer.from(parts[2]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return undefined;
  }
  try {
    return JSON.parse(unbase64url(parts[1])) as T;
  } catch {
    return undefined;
  }
}

function readDcrClient(clientID: string, config: OAuthConfig): RegisteredClient | undefined {
  const client = readSignedValue<RegisteredClient>(clientID, DCR_CLIENT_PREFIX, config);
  if (!client || !Array.isArray(client.redirectURIs)) {
    return undefined;
  }
  const redirectURIs = client.redirectURIs.filter((uri): uri is string => typeof uri === "string" && uri.length > 0);
  if (redirectURIs.length === 0) {
    return undefined;
  }
  return {
    redirectURIs,
    scope: typeof client.scope === "string" && client.scope.length > 0 ? client.scope : "read:user",
    issuedAt: typeof client.issuedAt === "number" ? client.issuedAt : 0,
  };
}

function dcrClientSecret(clientID: string, config: OAuthConfig): string {
  return createHmac("sha256", config.refreshTokenSecret)
    .update(`dcr-client-secret:${clientID}`)
    .digest("base64url");
}

function isDcrClientIDFormat(clientID: string): boolean {
  return clientID.startsWith(`${DCR_CLIENT_PREFIX}.`);
}

function isSupportedDcrRedirectURI(uri: string): boolean {
  try {
    const url = new URL(uri);
    if (url.protocol !== "https:") {
      return false;
    }
    const isChatGpt = url.hostname === "chatgpt.com" && url.pathname.startsWith("/connector/oauth/");
    const isClaude = url.hostname === "claude.ai" && url.pathname === "/api/mcp/auth_callback";
    return isChatGpt || isClaude;
  } catch {
    return false;
  }
}

export function dynamicClientRegistration(body: Record<string, unknown>, config: OAuthConfig): { status: number; body: Record<string, unknown> } {
  if (!config.githubClientID || !config.githubClientSecret) {
    return {
      status: 503,
      body: {
        error: "temporarily_unavailable",
        error_description: "Dynamic client registration requires GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET on the MCP server",
      },
    };
  }
  const redirectURIs = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((uri): uri is string => typeof uri === "string" && isSupportedDcrRedirectURI(uri))
    : [];
  if (redirectURIs.length === 0) {
    return {
      status: 400,
      body: {
        error: "invalid_client_metadata",
        error_description: "redirect_uris must include a supported ChatGPT or Claude connector callback URL",
      },
    };
  }
  const requestedScopes = typeof body.scope === "string"
    ? body.scope.split(/\s+/).filter((scope) => scope === "read:user")
    : ["read:user"];
  const scope = requestedScopes.includes("read:user") ? "read:user" : "read:user";
  const clientID = createSignedValue(DCR_CLIENT_PREFIX, {
    redirectURIs,
    scope,
    issuedAt: Math.floor(Date.now() / 1000),
  }, config);
  const clientSecret = dcrClientSecret(clientID, config);
  return {
    status: 201,
    body: {
      client_id: clientID,
      client_secret: clientSecret,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: 0,
      redirect_uris: redirectURIs,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
      scope,
    },
  };
}

function isFresh(issuedAt: unknown): issuedAt is number {
  return typeof issuedAt === "number" && Date.now() - issuedAt <= OAUTH_CODE_TTL_MS;
}

function createRefreshToken(accessToken: string, scope: string, config: OAuthConfig): string {
  const payload = base64url(JSON.stringify({
    accessToken,
    scope,
    issuedAt: Math.floor(Date.now() / 1000),
  }));
  return `memosrt.${payload}.${signRefreshPayload(payload, config)}`;
}

function readRefreshToken(refreshToken: string, config: OAuthConfig): { accessToken: string; scope: string } | undefined {
  const parts = refreshToken.split(".");
  if (parts.length !== 3 || parts[0] !== "memosrt") {
    return undefined;
  }
  const expected = Buffer.from(signRefreshPayload(parts[1], config));
  const actual = Buffer.from(parts[2]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return undefined;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(unbase64url(parts[1]));
  } catch {
    return undefined;
  }
  const accessToken = (payload as { accessToken?: unknown }).accessToken;
  const scope = (payload as { scope?: unknown }).scope;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return undefined;
  }
  return { accessToken, scope: typeof scope === "string" ? scope : "read:user" };
}

export function githubAuthorizeURL(query: Record<string, unknown>, config: OAuthConfig): string {
  const params = new URLSearchParams();
  const clientID = typeof query.client_id === "string" ? query.client_id : "";
  const redirectURI = typeof query.redirect_uri === "string" ? query.redirect_uri : "";
  if (!clientID || !redirectURI) {
    params.set("error", "invalid_request");
    return `${config.publicBaseUrl}/oauth/github/callback?${params.toString()}`;
  }
  const registeredClient = readDcrClient(clientID, config);
  if (registeredClient && !registeredClient.redirectURIs.includes(redirectURI)) {
    params.set("error", "invalid_request");
    params.set("error_description", "redirect_uri mismatch");
    return `${redirectURI}?${params.toString()}`;
  }
  const isDcrClient = !!registeredClient || isDcrClientIDFormat(clientID);
  if (!registeredClient && isDcrClient && !isSupportedDcrRedirectURI(redirectURI)) {
    params.set("error", "invalid_request");
    params.set("error_description", "unsupported redirect_uri");
    return `${redirectURI}?${params.toString()}`;
  }
  const upstreamClientID = isDcrClient ? config.githubClientID : clientID;
  if (!upstreamClientID) {
    params.set("error", "server_error");
    params.set("error_description", "missing upstream github client id");
    return `${redirectURI}?${params.toString()}`;
  }

  const requestedScopes = (typeof query.scope === "string" ? query.scope : "")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0 && scope !== "offline_access");
  if (!requestedScopes.includes("read:user")) {
    requestedScopes.push("read:user");
  }
  const state = createSignedValue("memosstate", {
    clientID,
    redirectURI,
    state: typeof query.state === "string" ? query.state : undefined,
    codeChallenge: typeof query.code_challenge === "string" ? query.code_challenge : undefined,
    codeChallengeMethod: typeof query.code_challenge_method === "string" ? query.code_challenge_method : undefined,
    // RFC 8707: preserve the resource indicator across the GitHub round-trip
    // so we can validate audience at /oauth/token and include it in logs.
    resource: typeof query.resource === "string" ? query.resource : undefined,
    issuedAt: Date.now(),
  }, config);
  params.set("response_type", "code");
  params.set("client_id", upstreamClientID);
  params.set("redirect_uri", `${config.publicBaseUrl}/oauth/github/callback`);
  params.set("scope", requestedScopes.join(" "));
  params.set("state", state);
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export function githubCallbackRedirectURL(query: Record<string, unknown>, config: OAuthConfig, stateStore: OAuthState): string {
  const rawState = typeof query.state === "string" ? query.state : "";
  const state = readSignedValue<SignedAuthorizeState>(rawState, "memosstate", config);
  if (!state || !isFresh(state.issuedAt) || typeof state.redirectURI !== "string") {
    return `${config.publicBaseUrl}/mcp?error=invalid_state`;
  }
  const redirect = new URL(state.redirectURI);
  const error = typeof query.error === "string" ? query.error : undefined;
  if (error) {
    redirect.searchParams.set("error", error);
  } else if (typeof query.code === "string") {
    const code = stateStore.setCode({
      clientID: state.clientID,
      redirectURI: state.redirectURI,
      state: state.state,
      codeChallenge: state.codeChallenge,
      codeChallengeMethod: state.codeChallengeMethod,
      resource: state.resource,
      githubCode: query.code,
      issuedAt: Date.now(),
    });
    redirect.searchParams.set("code", code);
  } else {
    redirect.searchParams.set("error", "invalid_request");
  }
  if (state.state) {
    redirect.searchParams.set("state", state.state);
  }
  if (state.resource) {
    redirect.searchParams.set("resource", state.resource);
  }
  // RFC 9207 — required by ChatGPT MCP to accept the callback and proceed
  // to /oauth/token. Without this the client silently aborts after the
  // browser redirect lands, and no token exchange ever happens.
  redirect.searchParams.set("iss", config.publicBaseUrl);
  return redirect.toString();
}

function basicAuthClientCredentials(header: string | undefined): { clientID?: string; clientSecret?: string } {
  if (!header?.startsWith("Basic ")) {
    return {};
  }
  try {
    const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx < 0) {
      return {};
    }
    return {
      clientID: decodeURIComponent(decoded.slice(0, idx)),
      clientSecret: decodeURIComponent(decoded.slice(idx + 1)),
    };
  } catch {
    return {};
  }
}

export async function githubTokenExchange(
  body: Record<string, unknown>,
  authorizationHeader: string | undefined,
  config: OAuthConfig,
  stateStore: OAuthState,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const basic = basicAuthClientCredentials(authorizationHeader);
  const grantType = typeof body.grant_type === "string" ? body.grant_type : "";
  if (grantType === "refresh_token") {
    const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
    const refreshed = readRefreshToken(refreshToken, config);
    if (!refreshed) {
      return { status: 400, body: { error: "invalid_grant" } };
    }
    return {
      status: 200,
      body: {
        access_token: refreshed.accessToken,
        token_type: "Bearer",
        scope: refreshed.scope,
        expires_in: 3600,
        refresh_token: refreshToken,
      },
    };
  }
  if (grantType !== "authorization_code") {
    return { status: 400, body: { error: "unsupported_grant_type" } };
  }

  const rawCode = typeof body.code === "string" ? body.code : "";
  const code = stateStore.takeCode(rawCode);
  if (!code || !isFresh(code.issuedAt) || typeof code.githubCode !== "string") {
    return { status: 400, body: { error: "invalid_grant" } };
  }
  const clientID = typeof body.client_id === "string" ? body.client_id : basic.clientID;
  const clientSecret = typeof body.client_secret === "string" ? body.client_secret : basic.clientSecret;
  if (!clientID || clientID !== code.clientID || !clientSecret) {
    return { status: 401, body: { error: "invalid_client" } };
  }
  const registeredClient = readDcrClient(clientID, config);
  const isDcrClient = !!registeredClient || isDcrClientIDFormat(clientID);
  if (registeredClient) {
    const expectedSecret = dcrClientSecret(clientID, config);
    const expected = Buffer.from(expectedSecret);
    const actual = Buffer.from(clientSecret);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return { status: 401, body: { error: "invalid_client" } };
    }
  }
  if (typeof body.redirect_uri === "string" && body.redirect_uri !== code.redirectURI) {
    return { status: 400, body: { error: "invalid_grant", error_description: "redirect_uri mismatch" } };
  }
  if (code.codeChallenge) {
    const verifier = typeof body.code_verifier === "string" ? body.code_verifier : "";
    const challengeMethod = code.codeChallengeMethod ?? "plain";
    const actualChallenge = challengeMethod === "S256"
      ? createHash("sha256").update(verifier).digest("base64url")
      : verifier;
    if (actualChallenge !== code.codeChallenge) {
      return { status: 400, body: { error: "invalid_grant", error_description: "PKCE verification failed" } };
    }
  }

  const forwarded = new URLSearchParams();
  forwarded.set("grant_type", "authorization_code");
  forwarded.set("code", code.githubCode);
  forwarded.set("redirect_uri", `${config.publicBaseUrl}/oauth/github/callback`);
  forwarded.set("client_id", isDcrClient ? (config.githubClientID ?? "") : clientID);
  forwarded.set("client_secret", isDcrClient ? (config.githubClientSecret ?? "") : clientSecret);
  if (isDcrClient && (!config.githubClientID || !config.githubClientSecret)) {
    return { status: 500, body: { error: "server_error", error_description: "missing upstream github oauth credentials" } };
  }

  let response: Response;
  try {
    response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "memos-mcp",
      },
      body: forwarded,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (e) {
    return { status: 502, body: { error: "upstream_error", error_description: (e as Error).message } };
  }

  let tokenBody: Record<string, unknown>;
  try {
    tokenBody = await response.json() as Record<string, unknown>;
  } catch (e) {
    return { status: 502, body: { error: "upstream_error", error_description: (e as Error).message } };
  }
  if (!response.ok || typeof tokenBody.access_token !== "string") {
    return { status: response.status, body: tokenBody };
  }
  const scope = typeof tokenBody.scope === "string" && tokenBody.scope.length > 0 ? tokenBody.scope : "read:user";
  tokenBody.token_type = tokenBody.token_type ?? "Bearer";
  tokenBody.scope = scope;
  tokenBody.expires_in = tokenBody.expires_in ?? 3600;
  tokenBody.refresh_token = createRefreshToken(tokenBody.access_token, scope, config);
  return { status: 200, body: tokenBody };
}
