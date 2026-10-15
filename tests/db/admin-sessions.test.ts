import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSession,
  endAdminSession,
  findActiveAdminSession,
  readActiveAdminSession,
  revokeAdminSession,
  startAdminSession,
} from "../../src/db/admin-sessions.ts";
import { createTempDatabase, openMigratedDatabase, type TempDatabase } from "../helpers/temp-database.ts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const LOGIN = new Date("2026-10-15T08:00:00.000Z");

function rows(db: DatabaseSync) {
  return db.prepare("SELECT token_hash, created_at, expires_at, revoked_at FROM admin_sessions ORDER BY token_hash").all();
}

describe("admin sessions", () => {
  let temp: TempDatabase;
  let db: DatabaseSync;

  beforeEach(() => {
    temp = createTempDatabase();
    db = openMigratedDatabase();
  });

  afterEach(() => {
    db.close();
    temp.cleanup();
  });

  it("stores only the token hash with an 8-hour absolute expiry", () => {
    expect(ADMIN_SESSION_TTL_SECONDS).toBe(28_800);
    expect(createAdminSession(db, HASH_A, LOGIN)).toEqual({
      createdAt: "2026-10-15T08:00:00.000Z",
      expiresAt: "2026-10-15T16:00:00.000Z",
    });
    expect(rows(db)).toEqual([
      { token_hash: HASH_A, created_at: "2026-10-15T08:00:00.000Z", expires_at: "2026-10-15T16:00:00.000Z", revoked_at: null },
    ]);
  });

  it.each([["a raw 43-character token", "x".repeat(43)], ["uppercase hex", "A".repeat(64)], ["63 characters", "a".repeat(63)]])(
    "refuses to store %s",
    (_label, value) => {
      expect(() => createAdminSession(db, value, LOGIN)).toThrow("64 lowercase hex");
      expect(rows(db)).toEqual([]);
    },
  );

  it("rejects a non-hex token hash at the table level too", () => {
    expect(() =>
      db.prepare("INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES (?, 'x', 'y')").run("g".repeat(64)),
    ).toThrow();
  });

  it("finds the session until it expires, and not from the expiry instant on", () => {
    createAdminSession(db, HASH_A, LOGIN);
    expect(findActiveAdminSession(db, HASH_A, new Date("2026-10-15T15:59:59.999Z"))).not.toBeNull();
    expect(findActiveAdminSession(db, HASH_A, new Date("2026-10-15T16:00:00.000Z"))).toBeNull();
  });

  it("never accepts a revoked session and revokes only once", () => {
    createAdminSession(db, HASH_A, LOGIN);
    expect(revokeAdminSession(db, HASH_A, LOGIN)).toBe(true);
    expect(revokeAdminSession(db, HASH_A, LOGIN)).toBe(false);
    expect(findActiveAdminSession(db, HASH_A, LOGIN)).toBeNull();
  });

  it("returns null or false for unknown and malformed hashes", () => {
    expect(findActiveAdminSession(db, HASH_B, LOGIN)).toBeNull();
    expect(findActiveAdminSession(db, "not-a-hash", LOGIN)).toBeNull();
    expect(revokeAdminSession(db, HASH_B, LOGIN)).toBe(false);
    expect(revokeAdminSession(db, "not-a-hash", LOGIN)).toBe(false);
  });

  it("deletes expired and revoked rows when a new session is stored", () => {
    createAdminSession(db, HASH_A, LOGIN);
    createAdminSession(db, "c".repeat(64), LOGIN);
    revokeAdminSession(db, "c".repeat(64), LOGIN);
    createAdminSession(db, HASH_B, new Date("2026-10-15T16:00:00.000Z"));
    expect(rows(db).map((row) => (row as { token_hash: string }).token_hash)).toEqual([HASH_B]);
  });

  it("opens and closes the database in the env-based wrappers", () => {
    startAdminSession(HASH_A);
    expect(readActiveAdminSession(HASH_A)).not.toBeNull();
    expect(endAdminSession(HASH_A)).toBe(true);
    expect(readActiveAdminSession(HASH_A)).toBeNull();
  });
});
