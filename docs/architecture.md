# Architecture

_A field marked **Repos:** applies only to those repositories; a field without the line is project-wide._

## TL;DR

### TL;DR

**Repos:** coffy-shop

One Next.js 16 application (pages + route handlers) running as a single Node 24 process.
One SQLite database file (node:sqlite, WAL) outside the release directory; 7 tables incl. schema_migrations.
No cache layer: every page and API response is read fresh from SQLite and sent with no-store.
Auth: one env-configured staff account (scrypt) with SHA-256-hashed session tokens in SQLite; customers are anonymous and reach their order only through a 256-bit tracking token.
Deployed by GitHub Actions to an existing shared AWS Lightsail host: systemd on 127.0.0.1:3002 behind shared Caddy TLS.

_Summarises the code paths listed in the sources; the browser cart lives in localStorage and is priced by the server at order time._

## System Flow Diagram

### Flow: Browse menu and add to cart (MVP: menu, cart)

**Repos:** coffy-shop

1. Customer opens / ; the server reads categories and products from SQLite on every request.
2. Products are grouped by category with TRY prices (integer kuruş formatted tr-TR); unavailable products show "Satışta değil" and their add button is disabled.
3. "Sepete ekle" writes {productId, quantity} to localStorage key coffy-shop.cart (max 20 per product); the header badge shows the item count, also across tabs.

_Cart holds only ids and quantities; names, prices and availability always come from the current menu._

### Flow: Edit cart (MVP: cart)

**Repos:** coffy-shop

1. Customer opens /sepet; the server reads the current menu, the client reads the stored cart.
2. Each line is resolved against the menu: ok / unavailable / missing. Only ok lines count toward the informational total.
3. Customer changes quantity (1..20) with -/+ or removes a line; every change re-reads storage first so another tab's lines are not lost.
4. "Siparişi tamamla" goes to /siparis-ver.

_Prices shown are informational; the server prices the order from SQLite at placement time._

### Flow: Checkout and place a pickup order (MVP: pickup orders)

**Repos:** coffy-shop

1. Customer opens /siparis-ver, enters name (1-60 chars) and optional note (max 200), presses "Siparişi ver".
2. The browser builds the request once with a random idempotency key and POSTs /api/orders (20 s timeout).
3. The server validates shape only, then in one BEGIN IMMEDIATE transaction: looks up the key; same key + same payload fingerprint replays the stored answer, different payload answers 409 idempotency_conflict.
4. For a new key it reads products, rejects unknown/unavailable ones (400), prices every line from SQLite, stores the order (status new, reference C-<1000+id>, 43-char tracking token) with name/price snapshots.
5. 201 returns reference, trackingPath and total; the UI shows the confirmation, then clears the cart.
6. On timeout, network error or 5xx the form stays locked and "Tekrar dene" resends the identical body.

_Idempotency + fingerprint make a lost response safe to retry; client-sent prices are never read._

### Flow: Track an order (MVP: customer status page)

**Repos:** coffy-shop

1. Customer opens /siparis/<token>.
2. A malformed token returns 404 without touching the database; a well-formed token is looked up by tracking_token.
3. The page shows reference, name, current status as a 4-step list (Yeni, Hazırlanıyor, Hazır, Tamamlandı), item snapshots, total and note.
4. "Durumu yenile" reloads the page; status is read fresh every time. Unknown token renders the same 404 page as a malformed one.

_The page is noindex and no-referrer so the token does not leak through search engines or Referer headers._

### Flow: Staff login and logout (MVP: protected staff area)

**Repos:** coffy-shop

1. Staff opens /yonetim/... ; proxy.ts redirects to /yonetim/giris when no well-shaped session cookie exists (convenience only).
2. POST /api/admin/login: Origin check (403) -> admin config (503 when missing) -> global limiter, 10 attempts / 15 min (429) -> body -> constant-time credential check (401).
3. Success stores the session hash (8 h) and sets the HttpOnly cookie; the browser goes to /yonetim/urunler.
4. Every admin page and /api/admin handler re-checks the session against SQLite.
5. "Çıkış yap" POSTs /api/admin/logout: revokes the row and always clears the cookie (204).

_The proxy is not the security gate; requireAdminPage and requireAdminRequest are._

### Flow: Staff product management (MVP: menu availability)

**Repos:** coffy-shop

1. /yonetim/urunler lists every category with every product, unavailable ones included; milk products show a "Sütlü" status.
2. The availability toggle sends PATCH /api/admin/products/<id> {isAvailable}.
3. /yonetim/urunler/yeni posts POST /api/admin/products {categoryId, name, description?, priceKurus, isAvailable, containsMilk?}; containsMilk ("Sütlü ürün" checkbox) defaults to false.
4. /yonetim/urunler/<id> sends PATCH with only the changed fields, containsMilk included.
5. Validation: name 1-60, description <=200, price 1..1,000,000 kuruş (0,01-10.000,00 TL), containsMilk boolean, category must exist, unknown fields rejected. There is no DELETE.
6. /yonetim/sut-secenekleri (admin bar link "Süt seçenekleri") lists every milk option, removed ones included, Normal süt first and read-only as "Ücretsiz".
7. Adding an option posts POST /api/admin/milk-options {name, surchargeKurus}: name 1-60, surcharge 1..1,000,000 kuruş (the product price bounds); the option is created available, at the end of the list.
8. Changing an option sends PATCH /api/admin/milk-options/<id> with surchargeKurus and/or isAvailable ("Satıştan kaldır" / "Satışa aç" sends the target value). Normal süt is refused (400 default_milk_option) and stays 0 kuruş and available. There is no DELETE.
9. GET /api/admin/products returns {categories, milkOptions}: milkOptions holds only the available options, Normal süt first. Each option has one surcharge that applies to every milk product.

_Orders keep name/price snapshots, so product edits and milk option changes never change placed orders. Normal süt comes from migration 0005 because the seed runs only for a new database; the same migration marks Cappuccino, Caffè Latte and Iced Latte as milk products on an existing database, and the catalog fixtures do so on a new one. Showing milk options on the customer menu and pricing them into orders is not implemented yet; the issue assigns it to a separate follow-up (ISSUE-2)._

### Flow: Staff order status advance (MVP: order preparation status)

**Repos:** coffy-shop

1. /yonetim/siparisler lists every order newest first (reference, name, time in Europe/Istanbul, status, total).
2. /yonetim/siparisler/<id> shows the order and one button for the next status.
3. PATCH /api/admin/orders/<id>/status {"to": next}: the UPDATE only matches when the stored status is the one right before "to"; otherwise 409 invalid_transition.
4. Allowed: new -> preparing -> ready -> completed. No skipping, no going back, completed is final.
5. A lost answer tells staff to reload and check instead of resending.

_The tracking token never leaves the admin data layer; staff identify orders by reference and numeric id._

### Flow: Release and deploy to Demo (MVP: CI, Lightsail deploy, health/version, deployment event)

**Repos:** coffy-shop

1. Push to main: build job runs typecheck, tests, build and packages coffy-shop-<sha>-linux-x64.tar.gz.
2. Deploy job (GitHub environment Demo) checks settings, uploads over SSH to releases/<sha>.
3. sudo coffy-shop-deploy activate <sha> (flock): online backup if the DB exists -> migrate as coffy-shop -> seed only for a new DB -> switch current, keep previous -> restart service.
4. verify-release.sh checks /api/health = ok and /api/version = <sha> over HTTPS (12 attempts).
5. Any failure after activation runs coffy-shop-deploy rollback <sha> (code only; the database is never restored automatically).
6. Always: remove the SSH key, then POST {sha, state, environment: Demo} to the DIJJI deploy webhook.

_Migrations are additive so the previous release keeps working after a code rollback._

### Category management

**Repos:** coffy-shop

Out of scope: categories come only from seed data; staff manage products, not categories

_No category endpoint or page exists; product create/edit only accepts an existing categoryId (unknown_category otherwise)._

### Order cancellation

**Repos:** coffy-shop

Not supported: statuses only move forward; an uncollected order is closed as completed

_orders.status CHECK allows only new, preparing, ready, completed; advanceOrderStatus never moves back. README MVP scope lists only order preparation status._

## Service Topology

### Services

**Repos:** coffy-shop

- coffy-shop web server — Next.js standalone server.js: customer pages, admin pages and every /api endpoint (systemd unit coffy-shop, 127.0.0.1:3002)
- Database CLI — src/cli: migrate, seed, backup, guarded local reset, admin:hash-password (run with plain node on .ts)
- coffy-shop-deploy wrapper — root-owned activate/rollback script run by the deploy job via sudo
- Caddy (shared, external) — TLS termination and reverse proxy for coffy.52-29-95-160.sslip.io
- GitHub Actions (external) — PR checks, release build, Demo deploy
- DIJJI deploy webhook (external) — receives {sha, state, environment} after every deploy attempt
- Local smoke harness — scripts/smoke: temporary DB, next start, HTTPS loopback proxy, Playwright

_One deployable service; the rest are tooling or external systems._

### Database tables

**Repos:** coffy-shop

- categories — menu categories with display order
- products — menu products: category, name, description, price in kuruş, availability, milk flag, display order
- milk_options — staff-managed milk choices: name, surcharge in kuruş, default flag (Normal süt), availability, display order
- orders — pickup orders: reference, tracking token, status, customer name, note, total, idempotency key + payload fingerprint, created/updated time
- order_items — order lines with product name and unit price snapshots
- admin_sessions — SHA-256 hashes of staff session tokens with expiry and revocation time
- schema_migrations — applied migration file names

_Created by migrations 0001-0005 plus the runner's own schema_migrations table._

### Connection diagram

**Repos:** coffy-shop

```
[Customer browser]          [Staff browser]
   | localStorage cart          | session cookie
   +-----------+   +------------+
               | HTTPS
               v
   +-----------------------------+   Lightsail host (Ubuntu 24.04)
   | Caddy (shared, TLS)         |
   +-----------------------------+
               | http 127.0.0.1:3002
               v
   +-----------------------------+
   | coffy-shop Next.js server   |
   |  pages + /api route handlers|
   +-----------------------------+
               | node:sqlite
               v
   +-----------------------------+      +---------------------------+
   | SQLite file (WAL)           |<-----| coffy-shop-deploy wrapper |
   | /var/lib/coffy-shop/data    |      | backup / migrate / seed   |
   +-----------------------------+      +---------------------------+
                                                    ^ sudo over SSH
+-------------------+   tar.gz + SSH                |
| GitHub Actions    |-------------------------------+
| PR checks / Main  |---- HTTPS health + version ---> Caddy
+-------------------+
          | POST {sha, state, environment}
          v
[DIJJI deploy webhook]
```

_Only Caddy reaches the app (HOSTNAME=127.0.0.1); the deploy account can run only the wrapper (sudoers)._

## Database Design

### categories table

**Repos:** coffy-shop

| Column | Type | Key / Constraint | Notes |
| --- | --- | --- | --- |
| id | TEXT | PRIMARY KEY, length 1-64 | fixed slug, e.g. sicak-kahveler |
| name | TEXT | NOT NULL, non-blank | display name |
| sort_order | INTEGER | NOT NULL DEFAULT 0 | menu order |

_Relational SQLite STRICT table; the template's PK/SK columns are adapted to column/type/constraint because the chosen database is SQLite, not a key-value store._

### products table

**Repos:** coffy-shop

| Column | Type | Key / Constraint | Notes |
| --- | --- | --- | --- |
| id | TEXT | PRIMARY KEY, length 1-64 | fixed slug, e.g. espresso |
| category_id | TEXT | NOT NULL, REFERENCES categories(id) | indexed |
| name | TEXT | NOT NULL, non-blank | app limits 1-60 chars |
| description | TEXT | NOT NULL DEFAULT '' | app limits to 200 chars |
| price_kurus | INTEGER | NOT NULL, >= 0 | app limits 1..1,000,000 |
| is_available | INTEGER | NOT NULL DEFAULT 1, IN (0,1) | 0 = off the menu |
| contains_milk | INTEGER | NOT NULL DEFAULT 0, IN (0,1) | 1 = milk drink (migration 0005) |
| sort_order | INTEGER | NOT NULL DEFAULT 0 | order inside category |

_Products are never deleted through the app; availability is the off switch. contains_milk was added in place with DEFAULT 0, so the previous release's INSERT (without the column) keeps working after a rollback._

### orders table

**Repos:** coffy-shop

| Column | Type | Key / Constraint | Notes |
| --- | --- | --- | --- |
| id | INTEGER | PRIMARY KEY | sequential, assigned under write lock |
| reference | TEXT | NOT NULL UNIQUE | C-<1000+id>, staff-facing only |
| tracking_token | TEXT | NOT NULL UNIQUE, length 43 | 256-bit base64url, customer's only access key |
| status | TEXT | NOT NULL DEFAULT 'new', IN (new, preparing, ready, completed) | codes; Turkish labels in UI |
| customer_name | TEXT | NOT NULL, length 1-60 |  |
| note | TEXT | NULL or length 1-200 |  |
| total_kurus | INTEGER | NOT NULL, >= 0 | computed from DB prices |
| idempotency_key | TEXT | NOT NULL UNIQUE, length 16-128 | client-generated |
| payload_fingerprint | TEXT | NOT NULL, length 64 | SHA-256 of normalized payload |
| created_at | TEXT | NOT NULL | ISO-8601 UTC |
| updated_at | TEXT | NULL | last staff status change (migration 0004) |

_STRICT table; updated_at added nullable without default so the previous release keeps working after a rollback._

### order_items table

**Repos:** coffy-shop

| Column | Type | Key / Constraint | Notes |
| --- | --- | --- | --- |
| order_id | INTEGER | PK part 1, REFERENCES orders(id) |  |
| product_id | TEXT | PK part 2, length 1-64, no FK | products stay deletable by reset |
| product_name_snapshot | TEXT | NOT NULL, non-blank |  |
| unit_price_kurus_snapshot | INTEGER | NOT NULL, >= 0 |  |
| quantity | INTEGER | NOT NULL, 1-20 |  |
| line_total_kurus | INTEGER | NOT NULL, >= 0 |  |

_Composite PRIMARY KEY (order_id, product_id): request lines are merged per product before insert._

### admin_sessions table

**Repos:** coffy-shop

| Column | Type | Key / Constraint | Notes |
| --- | --- | --- | --- |
| token_hash | TEXT | PRIMARY KEY, 64 lowercase hex | SHA-256 of the cookie token |
| created_at | TEXT | NOT NULL | ISO-8601 UTC |
| expires_at | TEXT | NOT NULL, indexed | created_at + 8 h |
| revoked_at | TEXT | NULL | set by logout |

_Expired and revoked rows are deleted in the same transaction that creates a new session._

### schema_migrations table

**Repos:** coffy-shop

| Column | Type | Key / Constraint | Notes |
| --- | --- | --- | --- |
| name | TEXT | PRIMARY KEY | migration file name NNNN_name.sql |
| applied_at | TEXT | NOT NULL | ISO-8601 UTC |

_Created by runMigrations; each file commits together with its row in one BEGIN IMMEDIATE transaction._

### GSIs

**Repos:** coffy-shop

| Index | Table | Columns | Purpose |
| --- | --- | --- | --- |
| products_category_id | products | category_id | menu grouped by category |
| milk_options PRIMARY KEY | milk_options | id | option lookup on change and the unused-id check on create |
| milk_options_single_default (partial UNIQUE) | milk_options | is_default WHERE is_default = 1 | at most one default option |
| orders.reference (UNIQUE) | orders | reference | unique staff-facing reference |
| orders.tracking_token (UNIQUE) | orders | tracking_token | customer tracking page lookup |
| orders.idempotency_key (UNIQUE) | orders | idempotency_key | replay / conflict detection on checkout |
| orders PRIMARY KEY | orders | id | admin list newest first (ORDER BY id DESC) and detail by id |
| order_items PRIMARY KEY | order_items | order_id, product_id | lines of one order |
| admin_sessions PRIMARY KEY | admin_sessions | token_hash | session check on every admin request |
| admin_sessions_expires_at | admin_sessions | expires_at | cleanup of expired sessions |

_SQLite has no GSIs; the field records the secondary and unique indexes that serve each access pattern in the flows._

### TTL

**Repos:** coffy-shop

| Type | Duration | Field |
| --- | --- | --- |
| Staff session | 8 hours absolute | admin_sessions.expires_at (rows deleted on next login) |
| Session cookie | 8 hours | coffy_admin_session Max-Age |
| Login attempt window | 15 minutes, 10 attempts, in memory | loginLimiter (reset on restart) |
| Checkout request timeout | 20 seconds | ORDER_REQUEST_TIMEOUT_MS (browser) |
| Release directories | 5 newest + current + previous | /opt/coffy-shop/releases |
| Database backups | never deleted automatically | /var/lib/coffy-shop/backups |
| CI release artifact | 7 days | actions/upload-artifact retention-days |

_SQLite has no native TTL; expiry is enforced by queries and scripts._

### milk_options table

**Repos:** coffy-shop

| Column | Type | Key / Constraint | Notes |
| --- | --- | --- | --- |
| id | TEXT | PRIMARY KEY, length 1-64 | normal-sut for the default; 16 hex characters for staff-added options |
| name | TEXT | NOT NULL, trimmed length 1-60 | e.g. Normal süt |
| surcharge_kurus | INTEGER | NOT NULL, >= 0 | default row 0; app limits staff options to 1..1,000,000 |
| is_default | INTEGER | NOT NULL DEFAULT 0, IN (0,1); partial UNIQUE where 1 | only Normal süt |
| is_available | INTEGER | NOT NULL DEFAULT 1, IN (0,1) | 0 = removed from sale |
| sort_order | INTEGER | NOT NULL DEFAULT 0 | staff order; new options appended |
| (table CHECK) | - | is_default = 0 OR (surcharge_kurus = 0 AND is_available = 1) | the default stays free and available |

_Created by migration 0005 together with the Normal süt row: the seed runs only for a new database, so the row must come from the migration. Options are never deleted; one surcharge per option applies to every milk product. Nothing references orders: order lines keep their own snapshots. Updates skip a default row inside the same BEGIN IMMEDIATE transaction, on top of the table CHECK._

## API Endpoint List

### API Endpoint List

**Repos:** coffy-shop

| Method | Path | Description | Auth required |
| --- | --- | --- | --- |
| POST | /api/orders | Place a pickup order (idempotent); 201 reference, trackingPath, totalKurus | No |
| GET | /api/health | 200 ok when the DB exists and is migrated, else 503 | No |
| GET | /api/version | Build commit SHA | No |
| POST | /api/admin/login | Start a staff session; sets HttpOnly cookie | No (same Origin, rate limited) |
| POST | /api/admin/logout | Revoke the session, clear the cookie (204) | No (same Origin) |
| GET | /api/admin/products | Every category with every product (incl. containsMilk) and the available milk options, Normal süt first | Yes |
| POST | /api/admin/products | Create a product | Yes + same Origin |
| PATCH | /api/admin/products/{id} | Update the sent fields of one product | Yes + same Origin |
| POST | /api/admin/milk-options | Add a milk option {name, surchargeKurus}; 201 {milkOption} | Yes + same Origin |
| PATCH | /api/admin/milk-options/{id} | Update surchargeKurus and/or isAvailable; Normal süt refused (400 default_milk_option); 200 {milkOption} | Yes + same Origin |
| GET | /api/admin/orders | Every order, newest first, without tracking token | Yes |
| GET | /api/admin/orders/{id} | One order with item snapshots and note | Yes |
| PATCH | /api/admin/orders/{id}/status | Move one step forward: body {to} | Yes + same Origin |

_All responses are JSON with Cache-Control no-store; errors are {error (Turkish message), code (snake_case)}. Mutating admin calls need Content-Type application/json._

## Cache Strategy

### Cache policy

**Repos:** coffy-shop

Layers: none. Every page sets dynamic = force-dynamic and every API response sends Cache-Control: no-store.
Invalidation: not needed; each request opens SQLite, reads and closes.
Client state: the cart lives in localStorage and is always re-resolved against the menu the server just read.

_Avoids stale prices/availability and stale order status; acceptable for a single-process demo load._

## Security Checklist

### Security Checklist

**Repos:** coffy-shop

| Control | Implementation |
| --- | --- |
| Brute force | Global in-memory limiter: 10 login attempts per 15 min (429 + Retry-After); counted before the body is read; reset on success and on restart |
| Username enumeration | Username compared via SHA-256 digests in constant time; scrypt always runs, so timing does not reveal a valid username |
| Password hashing | scrypt N=32768 r=8 p=1, 16-byte salt, 32-byte key; parameters bounded; hash only in the server env file |
| Session token | 32 random bytes base64url; only SHA-256 stored; HttpOnly, SameSite=Lax, Secure in production, host-only; 8 h absolute; logout revokes server-side |
| JWT secret / token rotation | Not applicable: no JWT; sessions are not rotated and survive a password change until expiry or logout |
| Reset / verify token | Not applicable: single env-configured account, no password reset flow |
| CSRF | Every mutating admin request (login/logout included) requires Origin exactly equal to the request's own origin, plus Content-Type application/json |
| XSS | React output escaping; no dangerouslySetInnerHTML in app/ or src/ |
| Fail closed | Missing/malformed admin env disables login (503) and rejects every session; public menu and ordering keep working |
| Customer order access | 256-bit tracking token is the only key; no lookup by reference; unknown and malformed tokens give the same 404; page is noindex + no-referrer |
| Input limits | Body size caps per endpoint (64 KB orders, 16 KB login, 8 KB products, 1 KB milk options, 256 B status); strict schema, unknown fields rejected |
| Network exposure | Server listens on 127.0.0.1 only; Caddy terminates TLS; systemd hardening (NoNewPrivileges, ProtectSystem=strict, ProtectHome, PrivateTmp) |
| Deploy secrets | GitHub Demo environment secrets; dedicated ed25519 key with restrict; pinned host key; sudo limited to the deploy wrapper; env file root:coffy-shop 0640 |

_Custom auth, so the checklist is detailed. Every row is read from code or the runbook._

### Public ordering rate limit

**Repos:** coffy-shop

No rate limit on POST /api/orders; accepted risk for the Demo scope

_Only the admin login is rate limited (login-limiter.ts). Caddy site block adds no limit. Body size and line count are capped._

## ADRs

### ADRs

**Repos:** coffy-shop

- ADR-001: Application shape — one Next.js app serves pages and API (no separate backend service)
- ADR-002: Database — SQLite through node:sqlite, one WAL file outside the release directory, path only from COFFY_DATABASE_PATH
- ADR-003: Schema evolution — additive-only migrations; rollback switches code only and never restores the database
- ADR-004: Money — integer kuruş everywhere; order lines snapshot product name and unit price
- ADR-005: Customer access — tracking token is the only key to an order; no lookup by reference, no customer accounts
- ADR-006: Order safety — client idempotency key + server payload fingerprint; same key replays, different payload is 409
- ADR-007: Staff auth — single env-configured account, scrypt hash, SHA-256-hashed DB sessions, fail closed
- ADR-008: Order lifecycle — new -> preparing -> ready -> completed, one step forward only, completed is final
- ADR-009: Cart — browser localStorage holds ids and quantities only; the server prices every line
- ADR-010: Login throttling — one global in-memory limiter instead of per-client keys
- ADR-011: Deployment — GitHub Actions to an existing shared Lightsail host over SSH, root-owned activate/rollback wrapper, shared Caddy TLS

_Each ADR is stated in code comments or the runbook (migrations, src/db, src/admin, deploy/README.md)._
