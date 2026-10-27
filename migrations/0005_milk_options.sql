-- Milk choices for drinks that contain milk.
--
-- contains_milk is NOT NULL DEFAULT 0 and added in place (no table rebuild),
-- so the previous release's product INSERT (explicit column list, without
-- this column) keeps working on a migrated database after a rollback.
--
-- milk_options holds the choices staff offer; surcharge_kurus is integer
-- kuruş. Options are never deleted: is_available = 0 takes one off the list.
-- The default row (Normal süt) is created here, not by the seed, because the
-- seed only runs when the database file is new. The table CHECK keeps the
-- default row at 0 kuruş and available, and the partial unique index allows
-- only one default row. Nothing references orders: an order keeps its own
-- snapshots.

ALTER TABLE products ADD COLUMN contains_milk INTEGER NOT NULL DEFAULT 0 CHECK (contains_milk IN (0, 1));

CREATE TABLE milk_options (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 64),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  surcharge_kurus INTEGER NOT NULL CHECK (surcharge_kurus >= 0),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  CHECK (is_default = 0 OR (surcharge_kurus = 0 AND is_available = 1))
) STRICT;

CREATE UNIQUE INDEX milk_options_single_default ON milk_options (is_default) WHERE is_default = 1;

INSERT INTO milk_options (id, name, surcharge_kurus, is_default, is_available, sort_order)
VALUES ('normal-sut', 'Normal süt', 0, 1, 1, 0);

-- Marks the seeded milk drinks on a database that already holds them. A new
-- database gets the same values from the catalog fixtures.
UPDATE products SET contains_milk = 1 WHERE id IN ('cappuccino', 'caffe-latte', 'iced-latte');
