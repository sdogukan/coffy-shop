import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDatabasePath, openDatabase } from "../../src/db/connection.ts";
import { createTempDatabase, type TempDatabase } from "../helpers/temp-database.ts";

describe("getDatabasePath", () => {
  it("rejects a missing, blank or relative COFFY_DATABASE_PATH", () => {
    expect(() => getDatabasePath({})).toThrow("COFFY_DATABASE_PATH is not set");
    expect(() => getDatabasePath({ COFFY_DATABASE_PATH: "  " })).toThrow("COFFY_DATABASE_PATH is not set");
    expect(() => getDatabasePath({ COFFY_DATABASE_PATH: "data/coffy.sqlite" })).toThrow("must be an absolute path");
  });

  it("returns an absolute path unchanged", () => {
    expect(getDatabasePath({ COFFY_DATABASE_PATH: "/var/lib/coffy-shop/data/coffy.sqlite" })).toBe(
      "/var/lib/coffy-shop/data/coffy.sqlite",
    );
  });
});

describe("openDatabase", () => {
  let temp: TempDatabase;

  beforeEach(() => {
    temp = createTempDatabase();
  });

  afterEach(() => {
    temp.cleanup();
  });

  it("does not create a missing file unless asked to", () => {
    expect(() => openDatabase()).toThrow();
    expect(existsSync(temp.path)).toBe(false);
  });

  it("creates the file in WAL mode when create is set", () => {
    const db = openDatabase({ create: true });
    try {
      expect(existsSync(temp.path)).toBe(true);
      expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
      expect(db.prepare("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
    } finally {
      db.close();
    }
  });

  it("keeps WAL mode when an existing file is reopened", () => {
    openDatabase({ create: true }).close();
    const db = openDatabase();
    try {
      expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
      expect(db.prepare("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
    } finally {
      db.close();
    }
  });

  it("opens an existing file whose path needs URL escaping", () => {
    const path = join(temp.dir, "my db #1?.sqlite");
    const env = { COFFY_DATABASE_PATH: path };
    openDatabase({ create: true, env }).close();
    const db = openDatabase({ env });
    try {
      db.exec("CREATE TABLE probe (id INTEGER)");
    } finally {
      db.close();
    }
    expect(existsSync(path)).toBe(true);
  });
});
