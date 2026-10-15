import { describe, expect, it } from "vitest";
import { createLoginLimiter, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS } from "../../src/admin/login-limiter.ts";
import { expectedOrigin, isSameOriginRequest } from "../../src/admin/origin.ts";
import {
  ADMIN_SESSION_COOKIE,
  clearedSessionCookieHeader,
  createSessionToken,
  hashSessionToken,
  isSessionToken,
  readSessionCookie,
  sessionCookieHeader,
} from "../../src/admin/session.ts";

function request(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/admin/products", { method: "POST", headers });
}

const DEV = { NODE_ENV: "development" };
const PROD = { NODE_ENV: "production" };

describe("isSameOriginRequest", () => {
  it("accepts an Origin exactly equal to http://<Host> outside production", () => {
    expect(isSameOriginRequest(request({ host: "localhost:3000", origin: "http://localhost:3000" }), DEV)).toBe(true);
    expect(expectedOrigin(request({ host: "localhost:3000" }), DEV)).toBe("http://localhost:3000");
  });

  it("expects https under NODE_ENV=production", () => {
    const host = "coffy.example.test";
    expect(isSameOriginRequest(request({ host, origin: `https://${host}` }), PROD)).toBe(true);
    expect(isSameOriginRequest(request({ host, origin: `http://${host}` }), PROD)).toBe(false);
  });

  it.each([
    ["a missing Origin", { host: "localhost:3000" }],
    ["a missing Host", { origin: "http://localhost:3000" }],
    ["another site", { host: "localhost:3000", origin: "http://evil.test" }],
    ["a different port", { host: "localhost:3000", origin: "http://localhost:3001" }],
    ["a prefix match", { host: "localhost:3000", origin: "http://localhost:3000.evil.test" }],
    ["a trailing slash", { host: "localhost:3000", origin: "http://localhost:3000/" }],
    ["a null Origin", { host: "localhost:3000", origin: "null" }],
    ["a subdomain", { host: "localhost:3000", origin: "http://a.localhost:3000" }],
  ])("rejects %s", (_label, headers) => {
    expect(isSameOriginRequest(request(headers), DEV)).toBe(false);
  });
});

describe("login limiter", () => {
  it("allows the configured number of attempts per window, then refuses until the oldest leaves the window", () => {
    const limiter = createLoginLimiter(3, 60_000);
    expect(limiter.reserve(0)).toEqual({ ok: true });
    expect(limiter.reserve(10_000)).toEqual({ ok: true });
    expect(limiter.reserve(20_000)).toEqual({ ok: true });
    expect(limiter.reserve(30_000)).toEqual({ ok: false, retryAfterSeconds: 30 });
    // A refused attempt is not recorded, so it does not extend the lockout.
    expect(limiter.reserve(59_999)).toEqual({ ok: false, retryAfterSeconds: 1 });
    expect(limiter.reserve(60_000)).toEqual({ ok: true });
    expect(limiter.reserve(60_001)).toEqual({ ok: false, retryAfterSeconds: 10 });
  });

  it("starts over after reset", () => {
    const limiter = createLoginLimiter(1, 60_000);
    limiter.reserve(0);
    expect(limiter.reserve(1).ok).toBe(false);
    limiter.reset();
    expect(limiter.reserve(2).ok).toBe(true);
  });

  it("uses 10 attempts per 15 minutes", () => {
    expect([LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS]).toEqual([10, 900_000]);
  });
});

describe("session cookie", () => {
  it("creates 43-character base64url tokens and hashes them to 64 hex characters", () => {
    const token = createSessionToken();
    expect(isSessionToken(token)).toBe(true);
    expect(createSessionToken()).not.toBe(token);
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(isSessionToken(`${token}x`)).toBe(false);
    expect(isSessionToken(undefined)).toBe(false);
  });

  it("is HttpOnly, SameSite=Lax, host-only and lasts 8 hours; Secure only in production", () => {
    expect(sessionCookieHeader("t", DEV)).toBe(`${ADMIN_SESSION_COOKIE}=t; Path=/; Max-Age=28800; HttpOnly; SameSite=Lax`);
    expect(sessionCookieHeader("t", PROD)).toBe(
      `${ADMIN_SESSION_COOKIE}=t; Path=/; Max-Age=28800; HttpOnly; SameSite=Lax; Secure`,
    );
    expect(sessionCookieHeader("t", PROD)).not.toContain("Domain");
  });

  it("is cleared with the same name and path and Max-Age=0", () => {
    expect(clearedSessionCookieHeader(DEV)).toBe(`${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    expect(clearedSessionCookieHeader(PROD)).toContain("; Secure");
  });

  it("is read from the Cookie header by exact name", () => {
    expect(readSessionCookie(request({}))).toBeUndefined();
    expect(readSessionCookie(request({ cookie: `a=1; ${ADMIN_SESSION_COOKIE}=abc; b=2` }))).toBe("abc");
    expect(readSessionCookie(request({ cookie: `x${ADMIN_SESSION_COOKIE}=abc` }))).toBeUndefined();
    expect(readSessionCookie(request({ cookie: `${ADMIN_SESSION_COOKIE}=` }))).toBe("");
  });
});
