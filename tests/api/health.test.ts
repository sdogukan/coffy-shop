import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dynamic, GET } from "../../app/api/health/route.ts";
import { createTempDatabase, openMigratedDatabase, type TempDatabase } from "../helpers/temp-database.ts";

const UNAVAILABLE = { status: "error", database: "unavailable" };

describe("GET /api/health", () => {
  let temp: TempDatabase;

  beforeEach(() => {
    temp = createTempDatabase();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    temp.cleanup();
  });

  it("is rendered per request", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("returns 200 with no-store when the migrated database is readable", async () => {
    openMigratedDatabase().close();
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", database: "ok" });
  });

  it("returns 503 for a missing file and does not create it", async () => {
    const response = GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(UNAVAILABLE);
    expect(existsSync(temp.path)).toBe(false);
  });

  it("returns 503 when the path is in a directory that does not exist", async () => {
    const path = join(temp.dir, "missing-dir", "coffy.sqlite");
    process.env.COFFY_DATABASE_PATH = path;
    const response = GET();
    expect(response.status).toBe(503);
    expect(existsSync(path)).toBe(false);
  });

  it("returns 503 when COFFY_DATABASE_PATH is unset", async () => {
    delete process.env.COFFY_DATABASE_PATH;
    const response = GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(UNAVAILABLE);
  });

  it("returns 503 for a database that exists but was never migrated", async () => {
    writeFileSync(temp.path, "");
    const response = GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(UNAVAILABLE);
  });

  it("returns 503 for a file that is not a SQLite database without leaking details", async () => {
    writeFileSync(temp.path, "not a database at all, just text that is long enough to fill a header page");
    const response = GET();
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toBe(JSON.stringify(UNAVAILABLE));
    expect(body).not.toContain(temp.dir);
  });
});
