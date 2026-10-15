-- Staff sessions. The cookie carries a random token; only its SHA-256 (hex)
-- is stored, so a copy of the database cannot be replayed as a cookie.
-- A session ends at expires_at (8 hours after login) or when logout sets
-- revoked_at. Nothing references products, so the catalog stays deletable.

CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;

CREATE INDEX admin_sessions_expires_at ON admin_sessions (expires_at);
