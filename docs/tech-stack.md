# Tech Stack

_A field marked **Repos:** applies only to those repositories; a field without the line is project-wide._

## Frontend

### Selection

**Repos:** coffy-shop

Next.js 16.4 (App Router) + React 19.3, plain global CSS

_Pages are server-rendered per request (force-dynamic) and client components handle the cart, checkout and admin forms. Styling is one hand-written app/globals.css with no CSS framework. Familiarity, community, maturity and hiring pool are all high for React/Next.js; cost is zero (open source)._

## Backend

### Selection

**Repos:** coffy-shop

Next.js route handlers on Node.js 24 (single process, standalone output)

_Every API lives under app/api as route handlers; domain logic is in src/. next.config.ts sets output standalone and the release runs server.js under systemd. Node is pinned to 24 (.nvmrc, engines >=24 <25) because node:sqlite and type stripping for the .ts CLIs come from Node 24._

## Database

### Selection

**Repos:** coffy-shop

SQLite via node:sqlite (Node 24 built-in), WAL mode, STRICT tables

_No database driver dependency: DatabaseSync from node:sqlite. The file path comes only from COFFY_DATABASE_PATH and must be absolute; on the server it lives under /var/lib/coffy-shop/data, outside /opt/coffy-shop/releases. WAL is set when the migration runner creates the file. Schema changes are ordered, additive SQL files in migrations/ tracked in schema_migrations. Zero cost and no lock-in, fits a single-process demo; the trade-off is a single writer and a single host._

## Auth / Identity

### Selection

**Repos:** coffy-shop

Custom: one env-configured staff account (scrypt hash) + database-backed session cookie; customers are anonymous (tracking token)

_COFFY_ADMIN_USERNAME + COFFY_ADMIN_PASSWORD_HASH (scrypt.N.r.p.salt.key) are read on every request; a missing or malformed value disables the admin area (fail closed, login 503). Login creates a 32-byte random token cookie (HttpOnly, SameSite=Lax, Secure in production, Max-Age 8h); only its SHA-256 is stored in admin_sessions. No managed identity provider, no customer accounts._

## Infrastructure / Deployment

### Selection

**Repos:** coffy-shop

Existing AWS Lightsail host (Ubuntu 24.04, shared with Dolmuş Takip): systemd service on 127.0.0.1:3002 behind shared Caddy (TLS)

_deploy/systemd/coffy-shop.service runs server.js as user coffy-shop with ProtectSystem=strict and ReadWritePaths=/var/lib/coffy-shop. Caddy site block coffy.52-29-95-160.sslip.io reverse-proxies to 127.0.0.1:3002. Releases live in /opt/coffy-shop/releases/<sha> with current/previous symlinks switched by the root-owned coffy-shop-deploy wrapper. provision.sh bootstraps accounts, directories, unit, wrapper and sudoers._

## Storage / Object Store

### Selection

**Repos:** coffy-shop

None

_No storage SDK in package.json and no upload endpoint. Images are not used (next.config.ts sets images.unoptimized). Database backups are written to /var/lib/coffy-shop/backups on the same host before every migration._

## Queue / Async Messaging

### Selection

**Repos:** coffy-shop

None

_Every handler opens SQLite, does one transaction and closes; no worker, queue or scheduler dependency exists._

## Observability

### Selection

**Repos:** coffy-shop

Console logging (console.error / console.warn) + GET /api/health and GET /api/version probes

_Handlers log failures without secrets (no body, cookie or hash values). /api/health returns 200 only when the database file exists and the migrated tables are readable, else 503. /api/version returns the 40-char commit SHA stamped at build time. The deploy job verifies both over HTTPS before reporting success._

### Log retention and alerting

**Repos:** coffy-shop

systemd journal only; no external monitoring, metrics or alerting for the Demo

_The unit sets no StandardOutput, so stdout/stderr go to the journal by systemd default; no monitoring dependency or uptime check exists in the repository. Restart=on-failure restarts a crashed process._

## CI/CD

### Selection

**Repos:** coffy-shop

GitHub Actions: pull request checks workflow + main build-and-deploy workflow (SSH to Lightsail, DIJJI deploy webhook)

_pr.yml runs typecheck, vitest, build and the Playwright smoke. main.yml builds and packages a linux-x64 release artifact, then the Demo environment job uploads it over SSH (pinned host key, dedicated key), activates it with the wrapper, verifies health/version over HTTPS, rolls back on failure and POSTs {sha, state, environment} to the DIJJI deploy webhook._

## Email / Notification

### Selection

**Repos:** coffy-shop

None — order status is read on the tracking page

_No email/SMS dependency in package.json. The checkout confirmation shows the tracking link with a copy button; the tracking page re-reads the status on each load (Durumu yenile link). The only outbound notification is the CI deploy webhook to DIJJI._

## Summary (TL;DR)

### Stack summary

**Repos:** coffy-shop

| Layer | Selection | Version | Repo |
| --- | --- | --- | --- |
| Frontend | Next.js App Router + React, plain CSS | next 16.4.0, react 19.3.0 | coffy-shop |
| Backend | Next.js route handlers on Node.js | Node 24 | coffy-shop |
| Database | SQLite via node:sqlite (WAL, STRICT) | Node 24 built-in | coffy-shop |
| Auth / Identity | Env-configured staff account + DB sessions; anonymous customers | - | coffy-shop |
| Infrastructure / Deployment | AWS Lightsail Ubuntu host, systemd, Caddy | Ubuntu 24.04 | coffy-shop |
| Storage / Object Store | None | - | coffy-shop |
| Queue / Async Messaging | None | - | coffy-shop |
| Observability | Console logs + health/version probes | - | coffy-shop |
| CI/CD | GitHub Actions | actions/checkout v7, setup-node v7 | coffy-shop |
| Email / Notification | None | - | coffy-shop |
| Language / tooling | TypeScript, Vitest, Playwright | typescript 6.0.3, vitest 5.0.4, @playwright/test 1.64.0 | coffy-shop |

_Versions are the exact pins in package.json and .nvmrc; Ubuntu version from deploy/README.md._
