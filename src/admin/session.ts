import { createHash, randomBytes } from "node:crypto";
import type { Env } from "../db/connection.ts";
import { ADMIN_SESSION_TTL_SECONDS, type AdminSession, readActiveAdminSession } from "../db/admin-sessions.ts";
import { readAdminConfig } from "./config.ts";
import { adminError, describeError } from "./http.ts";
import { isSameOriginRequest } from "./origin.ts";

// Staff session cookie: 32 random bytes, base64url (43 characters). The
// database stores only hashSessionToken(token); login, logout and every check
// go through that same function. No Domain attribute, so the cookie is
// host-only.
export const ADMIN_SESSION_COOKIE = "coffy_admin_session";

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function isSessionToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookieAttributes(maxAgeSeconds: number, env: Env): string {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  return `Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure}`;
}

// Max-Age equals the session's absolute lifetime in admin_sessions.
export function sessionCookieHeader(token: string, env: Env = process.env): string {
  return `${ADMIN_SESSION_COOKIE}=${token}; ${cookieAttributes(ADMIN_SESSION_TTL_SECONDS, env)}`;
}

export function clearedSessionCookieHeader(env: Env = process.env): string {
  return `${ADMIN_SESSION_COOKIE}=; ${cookieAttributes(0, env)}`;
}

// Route handlers read the cookie from the request itself (not from
// next/headers), so they can be called directly with a Request.
export function readSessionCookie(request: Request): string | undefined {
  const header = request.headers.get("cookie");
  if (header === null) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator !== -1 && part.slice(0, separator).trim() === ADMIN_SESSION_COOKIE) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

// The session check for pages and route handlers: null unless the admin
// config is valid (fail closed, so breaking the env ends existing sessions
// too) and the cookie's token hash belongs to an unrevoked, unexpired row.
// A malformed cookie returns null without opening the database. Database
// errors propagate.
export function readAdminSession(cookieValue: string | undefined, env: Env = process.env): AdminSession | null {
  if (readAdminConfig(env) === null || !isSessionToken(cookieValue)) {
    return null;
  }
  return readActiveAdminSession(hashSessionToken(cookieValue), env);
}

// Guard for every protected /api/admin handler. Returns the response to send
// when the request is refused, or null when it may proceed. Mutations are
// Origin-checked first (403), then every request needs a valid session (401).
export function requireAdminRequest(request: Request, { mutation }: { mutation: boolean }, env: Env = process.env): Response | null {
  if (mutation && !isSameOriginRequest(request, env)) {
    return adminError("forbidden_origin", 403);
  }
  let session: AdminSession | null;
  try {
    session = readAdminSession(readSessionCookie(request), env);
  } catch (error) {
    console.error(`Admin session check failed: ${describeError(error)}`);
    return adminError("server_error", 500);
  }
  return session === null ? adminError("unauthorized", 401) : null;
}
