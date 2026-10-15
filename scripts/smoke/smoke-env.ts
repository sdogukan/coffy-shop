import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";
import { join } from "node:path";
import { DATABASE_PATH_ENV, type Env } from "../../src/db/connection.ts";
import { ADMIN_PASSWORD_HASH_ENV, ADMIN_USERNAME_ENV } from "../../src/admin/config.ts";

// The pure parts of the local smoke (scripts/smoke/run-smoke.ts), shared with
// playwright.config.ts and the specs. Only Node built-ins and repo modules
// are imported: the orchestrator runs with plain node.

// Set by the orchestrator for the Playwright run only. Nothing here reads
// COFFY_APP_URL or COFFY_DATABASE_PATH from the developer's shell.
export const SMOKE_BASE_URL_ENV = "COFFY_SMOKE_BASE_URL";
export const SMOKE_ADMIN_USERNAME_ENV = "COFFY_SMOKE_ADMIN_USERNAME";
export const SMOKE_ADMIN_PASSWORD_ENV = "COFFY_SMOKE_ADMIN_PASSWORD";

const COFFY_ENV_PREFIX = "COFFY_";
const IPV4_LOOPBACK_PATTERN = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const IPV6_LOOPBACK_HOSTNAME = "[::1]";

export interface SmokePaths {
  databasePath: string;
  keyPath: string;
  certPath: string;
  serverLogPath: string;
}

// Everything the smoke writes lives in its own temporary directory, which is
// removed on every exit path.
export function smokePaths(dir: string): SmokePaths {
  return {
    databasePath: join(dir, "coffy.sqlite"),
    keyPath: join(dir, "proxy-key.pem"),
    certPath: join(dir, "proxy-cert.pem"),
    serverLogPath: join(dir, "server.log"),
  };
}

// Returns the origin of an https URL on a loopback IP literal with an explicit
// port, or throws. "localhost" is refused too: its address comes from the
// resolver, so it is not guaranteed to stay on this machine.
export function parseSmokeBaseUrl(value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${SMOKE_BASE_URL_ENV} is not set; run the smoke with npm run smoke or npm run smoke:run`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${SMOKE_BASE_URL_ENV} is not a URL`);
  }
  const isLoopback = IPV4_LOOPBACK_PATTERN.test(url.hostname) || url.hostname === IPV6_LOOPBACK_HOSTNAME;
  if (
    url.protocol !== "https:" ||
    !isLoopback ||
    url.port === "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`${SMOKE_BASE_URL_ENV} must be https://<loopback IP>:<port> with nothing after it, got ${value}`);
  }
  return url.origin;
}

export interface ServerEnvOptions {
  databasePath: string;
  adminUsername: string;
  adminPasswordHash: string;
  inherited: Env;
}

// The environment of next start, built from scratch: nothing from the shell
// but PATH and HOME, so an exported COFFY_DATABASE_PATH or admin hash can never
// point the smoke server at another database or account. NODE_ENV=production
// is what the host runs, so the https Origin and Secure cookie rules apply.
export function buildServerEnv({ databasePath, adminUsername, adminPasswordHash, inherited }: ServerEnvOptions): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const name of ["PATH", "HOME"]) {
    const value = inherited[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  return {
    ...env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    [DATABASE_PATH_ENV]: databasePath,
    [ADMIN_USERNAME_ENV]: adminUsername,
    [ADMIN_PASSWORD_HASH_ENV]: adminPasswordHash,
  };
}

export interface PlaywrightEnvOptions {
  baseUrl: string;
  adminUsername: string;
  adminPassword: string;
  inherited: Env;
}

// The Playwright runner keeps the shell's environment (browser path, display,
// CI flags) except every COFFY_* value, which is replaced by the three smoke
// values, and NODE_ENV, which is test. The base URL is checked here as well as
// in playwright.config.ts.
export function buildPlaywrightEnv({ baseUrl, adminUsername, adminPassword, inherited }: PlaywrightEnvOptions): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(inherited)) {
    if (value !== undefined && !name.startsWith(COFFY_ENV_PREFIX)) {
      env[name] = value;
    }
  }
  return {
    ...env,
    NODE_ENV: "test",
    [SMOKE_BASE_URL_ENV]: parseSmokeBaseUrl(baseUrl),
    [SMOKE_ADMIN_USERNAME_ENV]: adminUsername,
    [SMOKE_ADMIN_PASSWORD_ENV]: adminPassword,
  };
}

// Connection-level headers are never forwarded (RFC 9110 section 7.6.1).
const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

export function withoutHopByHopHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const listed = (typeof headers.connection === "string" ? headers.connection : "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== "");
  const drop = new Set([...HOP_BY_HOP_HEADERS, ...listed]);
  const result: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !drop.has(name)) {
      result[name] = value;
    }
  }
  return result;
}

// What Caddy's reverse_proxy sends upstream on the host: the browser's Host
// unchanged (src/admin/origin.ts derives the expected Origin from it) and
// fresh X-Forwarded-* values; ones the client sent are not trusted.
export function buildUpstreamHeaders(headers: IncomingHttpHeaders, clientAddress: string | undefined): OutgoingHttpHeaders {
  const upstream = withoutHopByHopHeaders(headers);
  delete upstream["x-forwarded-for"];
  delete upstream["x-forwarded-host"];
  delete upstream["x-forwarded-proto"];
  if (clientAddress !== undefined) {
    upstream["x-forwarded-for"] = clientAddress;
  }
  if (headers.host !== undefined) {
    upstream["x-forwarded-host"] = headers.host;
  }
  upstream["x-forwarded-proto"] = "https";
  return upstream;
}
