import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_LOGIN_PATH } from "./paths.ts";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "./session.ts";

// The session check every protected admin page runs itself, before it reads
// any product data. The proxy only redirects by cookie presence, and a
// layout does not re-run on client navigation between sibling pages, so
// neither is the gate. A missing, malformed, unknown, revoked or expired
// cookie, or an invalid admin config, redirects to the login page. Database
// errors propagate to the error page.
export async function requireAdminPage(): Promise<void> {
  const cookieStore = await cookies();
  if (readAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value) === null) {
    redirect(ADMIN_LOGIN_PATH);
  }
}
