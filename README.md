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
| `npm test` | Runs the test suite. Every test uses its own temporary SQLite file; `COFFY_DATABASE_PATH` from your shell is ignored. |
| `npm run build` | Production build with standalone output (`.next/standalone`). |
| `npm start` | Serves the production build locally with `next start` (the release runs the standalone `server.js`). |
| `npm run migrate` | Applies pending files from `migrations/` in name order; each file and its `schema_migrations` row commit together. |
| `npm run seed` | Inserts sample categories and products that are missing by fixed ID. |
| `npm run reset` | Replaces the catalog with the sample data. Refuses unless `NODE_ENV=test` or the catalog is empty. |
| `npm run backup -- <absolute file>` | Writes an online backup of the database to a new file; never overwrites an existing one. |

Endpoints:

- `GET /api/health` returns `200 {"status":"ok","database":"ok"}` when the database at `COFFY_DATABASE_PATH` exists and is migrated, otherwise `503 {"status":"error","database":"unavailable"}`. It never creates the database file.
- `GET /api/version` returns `{"sha":"<40-character commit SHA>"}`. The SHA is stamped at build time from `GITHUB_SHA` in CI, or from `git rev-parse HEAD` locally.

New migrations go in `migrations/` as `NNNN_description.sql`, must be additive and must not contain their own `BEGIN`/`COMMIT`.
