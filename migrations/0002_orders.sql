-- Pickup orders. Prices are integer kuruş copied from products when the
-- order is placed, so an order never changes when the menu does.

CREATE TABLE orders (
  id INTEGER PRIMARY KEY NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  tracking_token TEXT NOT NULL UNIQUE CHECK (length(tracking_token) = 43),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'preparing', 'ready', 'completed')),
  customer_name TEXT NOT NULL CHECK (length(customer_name) BETWEEN 1 AND 60),
  note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 200),
  total_kurus INTEGER NOT NULL CHECK (total_kurus >= 0),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 16 AND 128),
  payload_fingerprint TEXT NOT NULL CHECK (length(payload_fingerprint) = 64),
  created_at TEXT NOT NULL
) STRICT;

-- product_id deliberately has no REFERENCES products: the name and price are
-- snapshots, and products must stay deletable (resetCatalog) once orders exist.
CREATE TABLE order_items (
  order_id INTEGER NOT NULL REFERENCES orders (id),
  product_id TEXT NOT NULL CHECK (length(product_id) BETWEEN 1 AND 64),
  product_name_snapshot TEXT NOT NULL CHECK (length(trim(product_name_snapshot)) > 0),
  unit_price_kurus_snapshot INTEGER NOT NULL CHECK (unit_price_kurus_snapshot >= 0),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  line_total_kurus INTEGER NOT NULL CHECK (line_total_kurus >= 0),
  PRIMARY KEY (order_id, product_id)
) STRICT;
