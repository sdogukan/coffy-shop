-- When staff last changed an order's status. NULL until the first change.
-- Nullable with no default, so the column is added in place without a table
-- rebuild, and the previous release's INSERT (explicit column list) keeps
-- working on a migrated database after a rollback.

ALTER TABLE orders ADD COLUMN updated_at TEXT;
