import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "../../proxy.ts";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "../../src/admin/session.ts";

function call(path: string, cookie?: string) {
  const headers: Record<string, string> = {};
  if (cookie !== undefined) {
    headers.cookie = cookie;
  }
  return proxy(new NextRequest(`http://localhost${path}`, { headers }));
}

function isPassedThrough(response: Response): boolean {
  return response.headers.get("x-middleware-next") === "1";
}

describe("admin proxy", () => {
  it("runs only for the /yonetim pages", () => {
    expect(config.matcher).toBe("/yonetim/:path*");
  });

  it.each(["/yonetim/urunler", "/yonetim/urunler/yeni", "/yonetim/urunler/espresso", "/yonetim"])(
    "redirects %s without the session cookie to /yonetim/giris",
    (path) => {
      const response = call(path);
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("http://localhost/yonetim/giris");
    },
  );

  it.each([
    ["an empty cookie", `${ADMIN_SESSION_COOKIE}=`],
    ["a malformed cookie", `${ADMIN_SESSION_COOKIE}=not-a-token`],
    ["another cookie only", `other=${"a".repeat(43)}`],
  ])("redirects with %s", (_name, cookie) => {
    expect(call("/yonetim/urunler", cookie).status).toBe(307);
  });

  it("lets /yonetim/giris through without a cookie, so the login page never loops", () => {
    expect(isPassedThrough(call("/yonetim/giris"))).toBe(true);
  });

  it("lets a request with a well-formed cookie through; the page itself checks the session", () => {
    const response = call("/yonetim/urunler", `${ADMIN_SESSION_COOKIE}=${createSessionToken()}`);
    expect(isPassedThrough(response)).toBe(true);
    expect(response.headers.get("location")).toBeNull();
  });
});
