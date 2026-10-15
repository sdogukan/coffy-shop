import type { DatabaseSync } from "node:sqlite";
import { type Env, openDatabase } from "./connection.ts";

// Absolute lifetime of a staff session. The session cookie's Max-Age uses the
// same value, so the browser drops the cookie when the row expires.
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

// SHA-256 hex of the cookie token. The raw token is never passed to this
// module, so it can never be stored or appear in a SQLite error.
const TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;

export interface AdminSession {
  createdAt: string;
  expiresAt: string;
}

function assertTokenHash(tokenHash: string): void {
  if (!TOKEN_HASH_PATTERN.test(tokenHash)) {
    throw new Error("Admin session token hash must be 64 lowercase hex characters");
  }
}

// Stores a new session. Expired and revoked rows are deleted in the same
// write transaction, so the table holds at most the sessions still usable.
export function createAdminSession(db: DatabaseSync, tokenHash: string, now: Date = new Date()): AdminSession {
  assertTokenHash(tokenHash);
  const session = {
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ADMIN_SESSION_TTL_SECONDS * 1000).toISOString(),
  };
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL").run(session.createdAt);
    db.prepare("INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)").run(
      tokenHash,
      session.createdAt,
      session.expiresAt,
    );
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) {
      db.exec("ROLLBACK");
    }
    throw error;
  }
  return session;
}

// A session counts only while it is neither revoked nor expired. ISO-8601 UTC
// strings from toISOString() compare correctly as text.
export function findActiveAdminSession(db: DatabaseSync, tokenHash: string, now: Date = new Date()): AdminSession | null {
  if (!TOKEN_HASH_PATTERN.test(tokenHash)) {
    return null;
  }
  const row = db
    .prepare(
      "SELECT created_at, expires_at FROM admin_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?",
    )
    .get(tokenHash, now.toISOString()) as { created_at: string; expires_at: string } | undefined;
  return row === undefined ? null : { createdAt: row.created_at, expiresAt: row.expires_at };
}

// Returns whether a still-unrevoked row was revoked by this call.
export function revokeAdminSession(db: DatabaseSync, tokenHash: string, now: Date = new Date()): boolean {
  if (!TOKEN_HASH_PATTERN.test(tokenHash)) {
    return false;
  }
  const result = db
    .prepare("UPDATE admin_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
    .run(now.toISOString(), tokenHash);
  return Number(result.changes) > 0;
}

// The functions below open the existing database (never create it), do one
// operation and always close the connection. Errors propagate to the caller.

export function startAdminSession(tokenHash: string, env: Env = process.env): AdminSession {
  let db: DatabaseSync | undefined;
  try {
    db = openDatabase({ env });
    return createAdminSession(db, tokenHash);
  } finally {
    db?.close();
  }
}

export function readActiveAdminSession(tokenHash: string, env: Env = process.env): AdminSession | null {
  let db: DatabaseSync | undefined;
  try {
    db = openDatabase({ env });
    return findActiveAdminSession(db, tokenHash);
  } finally {
    db?.close();
  }
}

export function endAdminSession(tokenHash: string, env: Env = process.env): boolean {
  let db: DatabaseSync | undefined;
  try {
    db = openDatabase({ env });
    return revokeAdminSession(db, tokenHash);
  } finally {
    db?.close();
  }
}
