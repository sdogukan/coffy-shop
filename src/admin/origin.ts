import type { Env } from "../db/connection.ts";

// The CSRF gate for every mutating admin request, login and logout included.
// The Origin header must equal this request's own origin exactly; a missing
// Origin is rejected.
//
// Premise: the server listens only on 127.0.0.1 (systemd HOSTNAME) and the
// only client that reaches it is Caddy, which terminates TLS and forwards the
// browser's Host header unchanged. That is why Host can define the expected
// origin, and why the scheme is https under NODE_ENV=production.
export function expectedOrigin(request: Request, env: Env = process.env): string | null {
  const host = request.headers.get("host");
  if (host === null || host === "") {
    return null;
  }
  return `${env.NODE_ENV === "production" ? "https" : "http"}://${host}`;
}

export function isSameOriginRequest(request: Request, env: Env = process.env): boolean {
  const origin = request.headers.get("origin");
  const expected = expectedOrigin(request, env);
  return origin !== null && expected !== null && origin === expected;
}
