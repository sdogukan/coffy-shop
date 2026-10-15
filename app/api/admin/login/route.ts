import { readAdminConfig, verifyAdminCredentials } from "../../../../src/admin/config.ts";
import { adminError, describeError, json, readJsonBody } from "../../../../src/admin/http.ts";
import { loginLimiter } from "../../../../src/admin/login-limiter.ts";
import { isSameOriginRequest } from "../../../../src/admin/origin.ts";
import { isAcceptablePassword } from "../../../../src/admin/password.ts";
import { createSessionToken, hashSessionToken, sessionCookieHeader } from "../../../../src/admin/session.ts";
import { startAdminSession } from "../../../../src/db/admin-sessions.ts";

export const dynamic = "force-dynamic";

// A username and a password of at most 1024 characters each, even with every
// character JSON-escaped, fit well below this.
const MAX_BODY_LENGTH = 16_384;

function parseCredentials(body: unknown): { username: string; password: string } | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  const { username, password } = body as Record<string, unknown>;
  return isAcceptablePassword(username) && isAcceptablePassword(password) ? { username, password } : null;
}

// Order: Origin -> config -> limiter -> body -> verify. The attempt is counted
// before the body is read and before scrypt is awaited. Nothing from the body,
// the cookie token or the configured hash is ever logged.
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return adminError("forbidden_origin", 403);
  }
  const config = readAdminConfig();
  if (config === null) {
    return adminError("admin_disabled", 503);
  }
  const attempt = loginLimiter.reserve();
  if (!attempt.ok) {
    console.warn("Admin login refused: too many attempts");
    return adminError("too_many_attempts", 429, { "Retry-After": String(attempt.retryAfterSeconds) });
  }

  const read = await readJsonBody(request, MAX_BODY_LENGTH);
  const credentials = read.ok ? parseCredentials(read.body) : null;
  if (credentials === null) {
    return adminError("invalid_request", 400);
  }

  let valid: boolean;
  try {
    valid = await verifyAdminCredentials(config, credentials.username, credentials.password);
  } catch {
    console.error("Admin login failed: the password could not be verified");
    return adminError("server_error", 500);
  }
  if (!valid) {
    console.warn("Admin login rejected: invalid credentials");
    return adminError("invalid_credentials", 401);
  }

  loginLimiter.reset();
  const token = createSessionToken();
  try {
    startAdminSession(hashSessionToken(token));
  } catch (error) {
    console.error(`Admin login failed: the session could not be stored: ${describeError(error)}`);
    return adminError("server_error", 500);
  }
  return json({ status: "ok" }, 200, { "Set-Cookie": sessionCookieHeader(token) });
}
