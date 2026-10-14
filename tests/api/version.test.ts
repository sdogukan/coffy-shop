import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dynamic, GET } from "../../app/api/version/route.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("GET /api/version", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("is rendered per request", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("returns only the stamped 40-character lowercase hex sha with no-store", async () => {
    vi.stubEnv("COFFY_BUILD_SHA", SHA);
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({ sha: SHA });
    expect(Object.keys(body)).toEqual(["sha"]);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["short", SHA.slice(0, 7)],
    ["uppercase", SHA.toUpperCase()],
    ["branch name", "main"],
    ["with whitespace", `${SHA}\n`],
  ])("returns a non-200 error without echoing a %s stamp", async (_label, value) => {
    vi.stubEnv("COFFY_BUILD_SHA", value);
    const response = GET();
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({ error: "Version unavailable" });
  });
});
