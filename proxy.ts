import { type NextRequest, NextResponse } from "next/server";
import { ADMIN_LOGIN_PATH } from "./src/admin/paths.ts";
import { ADMIN_SESSION_COOKIE, isSessionToken } from "./src/admin/session.ts";

// A redirect for convenience only, not the security gate: it looks at the
// cookie's shape, never at the database. Every protected admin page checks
// the session itself (src/admin/page-guard.ts) and every /api/admin handler
// does too.
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === ADMIN_LOGIN_PATH || isSessionToken(request.cookies.get(ADMIN_SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL(ADMIN_LOGIN_PATH, request.url));
}

export const config = {
  matcher: "/yonetim/:path*",
};
