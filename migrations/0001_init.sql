-- Catalog tables. Prices are integer kuruş, availability is 0/1.
-- STRICT tables reject values of the wrong storage type.

CREATE TABLE categories (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 64),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  sort_order INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE products (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 64),
  category_id TEXT NOT NULL REFERENCES categories (id),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT NOT NULL DEFAULT '',
  price_kurus INTEGER NOT NULL CHECK (price_kurus >= 0),
  is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX products_category_id ON products (category_id);
