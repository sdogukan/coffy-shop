# Coffy Shop

A small coffee ordering application developed through DIJJI's Request and task workflows.

## Project status

This repository is the starting point for development. It contains the application skeleton (landing page, SQLite foundation, health and version endpoints); the menu, cart, orders and deployment automation will be produced by DIJJI tasks.

## MVP scope

- A responsive Turkish menu with categories, TRY prices, and product availability.
- A shopping cart with quantities and server-validated totals.
- Pickup orders with a reference and a customer-facing status page.
- A protected staff area for menu availability and order preparation status.
- SQLite storage that survives application releases and restarts.
- CI checks and a separate deployment to an existing AWS Lightsail host.
- Health and version endpoints plus a verifiable deployment-completion event for E2E testing.

Real payments, delivery logistics, and the external E2E partner's orchestration are outside the initial scope.

## Delivery conventions

- `main` is the trunk and deployment branch; development changes arrive through pull requests.
- Deployment success must identify the exact deployed commit and follow a live readiness check.
- Runtime data lives outside release directories.
- Credentials, environment files, databases, and customer data must never be committed.

## Local development

Requirements: Node.js 24 (see `.nvmrc`) and npm. The database scripts run as plain `node` on `.ts` files, which relies on Node 24's built-in type stripping and `node:sqlite`; no extra tooling is needed.

```bash
npm ci

# The SQLite file path comes only from COFFY_DATABASE_PATH and must be absolute.
# data/ is git-ignored, so a local database there is never committed.
mkdir -p data
export COFFY_DATABASE_PATH="$PWD/data/coffy.sqlite"

npm run migrate   # creates the file if missing and applies pending migrations
npm run seed      # inserts missing sample products by fixed ID; never changes existing rows
npm run dev       # http://localhost:3000
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the development server. |
| `npm run typecheck` | Type-checks the project (`tsc --noEmit`). |
| `npm test` | Runs the unit and feature test suite (Vitest, `tests/`). Every test uses its own temporary SQLite file; `COFFY_DATABASE_PATH` from your shell is ignored. |
| `npm run smoke` | Builds, then runs `npm run smoke:run`. The one command for the end-to-end smoke. |
| `npm run smoke:run` | Runs the Playwright smoke (`e2e/smoke`) against the existing build: a fresh temporary database, a random test admin, `next start` and an HTTPS proxy on `127.0.0.1`, all removed afterwards. See [Smoke test](#smoke-test). |
| `npm run build` | Production build with standalone output (`.next/standalone`). |
| `npm start` | Serves the production build locally with `next start` (the release runs the standalone `server.js`). |
| `npm run migrate` | Applies pending files from `migrations/` in name order; each file and its `schema_migrations` row commit together. |
| `npm run seed` | Inserts sample categories and products that are missing by fixed ID. |
| `npm run reset -- --database <absolute file> --confirm-wipe` | Wipes a local database and rebuilds it as a fresh migrate + seed (sample menu, no orders, no admin sessions). The path comes only from `--database`, never from `COFFY_DATABASE_PATH`. Refuses a relative or missing path, anything under `/var/lib/coffy-shop` or `/var/lib/dolmus-takip` (also through a symlink) and `NODE_ENV=production`. |
| `npm run backup -- <absolute file>` | Writes an online backup of the database to a new file; never overwrites an existing one. |
| `npm run --silent admin:hash-password` | Reads a staff password from standard input and prints its `COFFY_ADMIN_PASSWORD_HASH` value. |

Endpoints:

- `GET /api/health` returns `200 {"status":"ok","database":"ok"}` when the database at `COFFY_DATABASE_PATH` exists and is migrated, otherwise `503 {"status":"error","database":"unavailable"}`. It never creates the database file.
- `GET /api/version` returns `{"sha":"<40-character commit SHA>"}`. The SHA is stamped at build time from `GITHUB_SHA` in CI, or from `git rev-parse HEAD` locally.

## Smoke test

`npm run smoke` checks the whole flow end to end against a local production build: menu,
cart, checkout, admin login, the order moved Yeni → Hazırlanıyor → Hazır, and the tracking
page showing Hazır, plus the negative cases (invalid quantity, empty cart, unavailable
product, admin API without a session or `Origin`, invalid tracking link, a resent checkout).

```bash
npx playwright install chromium   # once
npm run smoke                     # or: npm run build && npm run smoke:run
```

It needs `openssl` on `PATH`. Your shell's `COFFY_*` variables are never used: the server
gets its own temporary database and test admin, and the specs refuse any base URL that is
not `https` on a loopback address. The scenarios, their expected results and the notes for
running them against Demo are in [`e2e/README.md`](e2e/README.md). The pull request workflow
runs `npm run smoke:run` after its build step.

## Admin area

Staff sign in at `/yonetim/giris` with one account configured through the environment:

- `COFFY_ADMIN_USERNAME` — the login name, compared exactly (case-sensitive).
- `COFFY_ADMIN_PASSWORD_HASH` — the scrypt hash of the password, never the password itself.

Generate the hash on a trusted machine. The password is read from standard input only: on a
terminal it is typed without echo and asked twice, and it may also be piped. It is never
accepted as a command-line argument and never printed; only the hash is written to stdout.
`--silent` keeps npm's own banner out of the output.

```bash
npm run --silent admin:hash-password
```

The hash has the form `scrypt.<N>.<r>.<p>.<salt>.<key>` (salt and key are base64url) and
contains no `$`, quotes, whitespace or `#`, so it is written unquoted on one line, both in
`.env.local` and in the server's environment file. Never commit either value.

The admin area fails closed: while either variable is missing or empty, or the hash is
malformed, login answers `503`, every existing session is rejected, and the public menu and
ordering keep working. A session lasts 8 hours; logout revokes it on the server.

Admin endpoints (JSON, `Cache-Control: no-store`, errors as `{"error", "code"}`):

- `POST /api/admin/login` with `{"username", "password"}` sets the HttpOnly session cookie.
- `POST /api/admin/logout` revokes the session and clears the cookie.
- `GET /api/admin/products` lists every category with every product, unavailable ones included.
- `POST /api/admin/products` creates a product; `PATCH /api/admin/products/<id>` updates only
  the fields sent. Products are never deleted; set `isAvailable` to `false` to take one off the menu.

Mutating requests must carry `Content-Type: application/json` and an `Origin` header equal to
the site's own origin (`https://` under `NODE_ENV=production`), so call them from the admin
pages rather than from another site or tool. Under `npm start` (production mode over plain
http) the secure session cookie is not stored, so try the admin area with `npm run dev`.

New migrations go in `migrations/` as `NNNN_description.sql`, must be additive and must not contain their own `BEGIN`/`COMMIT`.
