import { NextResponse } from "next/server";
import { adminError, describeError, NO_STORE } from "../../../../src/admin/http.ts";
import { isSameOriginRequest } from "../../../../src/admin/origin.ts";
import {
  clearedSessionCookieHeader,
  hashSessionToken,
  isSessionToken,
  readSessionCookie,
} from "../../../../src/admin/session.ts";
import { endAdminSession } from "../../../../src/db/admin-sessions.ts";

export const dynamic = "force-dynamic";

// Revokes the session behind the cookie, if any, and always expires the
// cookie, also for an unknown, expired or malformed one. The body is not read.
export function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return adminError("forbidden_origin", 403);
  }
  const clearCookie = { "Set-Cookie": clearedSessionCookieHeader() };
  const token = readSessionCookie(request);
  if (isSessionToken(token)) {
    try {
      endAdminSession(hashSessionToken(token));
    } catch (error) {
      console.error(`Admin logout failed: the session could not be revoked: ${describeError(error)}`);
      return adminError("server_error", 500, clearCookie);
    }
  }
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE, ...clearCookie } });
}
