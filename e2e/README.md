# Coffy Shop end-to-end scenarios

This document is for the E2E partner who tests the deployed Demo site, and for developers
who run the same scenarios locally. It lists what must be true before a run, every
scenario with its steps and expected result, and how to check that the deployed build is
the one under test.

## Target

| Variable | Meaning |
| --- | --- |
| `COFFY_APP_URL` | Public HTTPS URL of the Demo site, without a trailing path (for example `https://<host>`). The same name is used by the deploy job. |
| `COFFY_E2E_ADMIN_USERNAME` | Staff login name of the test admin account. |
| `COFFY_E2E_ADMIN_PASSWORD` | Password of that account. |

Only the names are listed here. Keep the two credential values in your own secret store,
never in a test report, log, trace, screenshot or video: the login form shows the
username, and a recording of the password field can carry the password. The account is
the one the server is configured with (`COFFY_ADMIN_USERNAME` and the scrypt hash in
`COFFY_ADMIN_PASSWORD_HASH`, see `deploy/README.md`, section "Staff login"); the server
never stores the password itself.

## Before a run: health and version check

The deploy job already runs this check (`scripts/ci/verify-release.sh`) before it reports
a deploy as successful (`deploy/README.md`, "How a deploy runs"). Repeat it before a run so
the tests are known to target the deployed commit:

1. `GET $COFFY_APP_URL/api/health` answers `200` with `{"status":"ok","database":"ok"}`.
   `503` with `{"status":"error","database":"unavailable"}` means the database is missing or
   not migrated; do not start the run.
2. `GET $COFFY_APP_URL/api/version` answers `{"sha":"<40-character commit SHA>"}`, and the SHA
   equals the commit the deploy notification named.

## Prerequisites and test data

- **Seed fixtures.** A new database is seeded with fixed IDs. The scenarios use:

  | Product ID | Name | Price | Available |
  | --- | --- | --- | --- |
  | `espresso` | Espresso | ₺90,00 | yes |
  | `americano` | Americano | ₺110,00 | yes |
  | `limonata` | Ev Yapımı Limonata | ₺95,00 | yes |
  | `cold-brew` | Cold Brew | ₺150,00 | **no** — the unavailable product |

  Staff can edit the menu on Demo. If a product above has been changed, restore it from the
  admin area before the run instead of adapting the tests to it.
- **Demo is never reset automatically.** Seeding runs only when the database did not exist
  yet, and the reset command refuses the server's data directory and `NODE_ENV=production`.
  Orders from earlier runs stay in the database.
- **Tests create their own data.** Every scenario places its own order with a fresh
  idempotency key and finds it again by the reference (`C-<number>`) or tracking link the
  API returned, never by its position or the number of orders in a list.
- **Tests never change the menu permanently.** None of the scenarios below edits a product.
  A future scenario that has to change one restores it in the same run.
- **No failed logins.** Ten failed logins within 15 minutes lock the admin login on the
  server for every client. The scenarios log in only with the correct test credentials.
- **Admin requests.** Mutating `/api/admin/*` requests need `Content-Type: application/json`
  and an `Origin` header equal to the origin of `COFFY_APP_URL`; the session cookie is
  `Secure`, so the admin area works only over HTTPS. Errors are JSON `{"error", "code"}`.

## Scenarios

### 1. Order to Hazır (browser)

| Step | Expected result |
| --- | --- |
| Open `/`, press **Sepete ekle** under Espresso. | The product shows "Sepete eklendi."; the cart badge in the header shows 1. |
| Open `/sepet`. | One Espresso line with "Adet: 1"; the link **Siparişi tamamla** is shown. |
| Press **Siparişi tamamla**, enter a name in **Adınız**, press **Siparişi ver**. | "Siparişiniz alındı" with a reference (`C-<number>`) and a tracking link `/siparis/<token>`. |
| Open the tracking link. | The reference is shown; in the list "Sipariş durumu" the current step (`aria-current="step"`) is **Yeni**. |
| Open `/yonetim/giris`, sign in with the test admin (**Kullanıcı adı**, **Şifre**, **Giriş yap**). | The product list `/yonetim/urunler` opens. |
| Open **Siparişler**, then the order with your reference. | The page "Sipariş C-<number>" shows "Durum: Yeni". |
| Press **Hazırlanıyor olarak işaretle**, then **Hazır olarak işaretle**. | "Durum: Hazırlanıyor", then "Durum: Hazır". |
| Open the tracking link again. | The current step is **Hazır** and the page shows "Durum: Hazır". |

### 2. Invalid quantity (API)

`POST /api/orders` with `{"customerName", "note", "items": [{"productId": "espresso", "quantity": 0}], "idempotencyKey"}`,
then the same with quantity `21`. Each answers `400` with `code` `invalid_quantity` and no order
is created. A quantity is valid from 1 to 20 per product.

### 3. Empty cart (API)

`POST /api/orders` with `"items": []` answers `400` with `code` `empty_cart`.

### 4. Unavailable product (API)

`POST /api/orders` with one `cold-brew` answers `400` with `code` `product_unavailable`.

### 5. Admin API without a session (API)

| Request | Expected result |
| --- | --- |
| `GET /api/admin/orders` without the session cookie | `401`, `code` `unauthorized` |
| `PATCH /api/admin/orders/<id>/status` with `{"to": "preparing"}` and the site's own `Origin`, no cookie | `401`, `code` `unauthorized`; the order is unchanged |
| The same `PATCH` without an `Origin` header | `403`, `code` `forbidden_origin` (checked before the session) |

### 6. Invalid tracking link (browser)

Open `/siparis/gecersiz-baglanti`. The answer is `404` with the heading
"Sipariş bulunamadı veya bağlantı geçersiz". A well-formed but unknown token looks the same.

### 7. Same checkout sent twice (API)

| Step | Expected result |
| --- | --- |
| Send one `POST /api/orders` body twice, byte for byte (same `idempotencyKey`). | Both answer `201` with the identical body (`reference`, `trackingPath`, `totalKurus`). |
| Sign in as the test admin (`POST /api/admin/login`, same `Origin`) and `GET /api/admin/orders`. | Exactly one order carries that reference. |
| Send a new key with one `limonata`, then the same key with two. | The first answers `201`, the second `409` with `code` `idempotency_conflict`; no second order is created. |

## Running the scenarios locally

The repository runs all of the scenarios above against a local production build, never
against Demo:

```bash
npm ci
npx playwright install chromium   # once; CI uses --with-deps
npm run smoke                     # builds, then runs the smoke
npm run smoke:run                 # runs the smoke against an existing build
```

Requirements: Node.js 24, `openssl` on `PATH`, and Playwright's Chromium.

The smoke creates a temporary directory with a new migrated and seeded SQLite database, a
random test admin and a self-signed certificate; starts `next start` on `127.0.0.1` with an
environment built from scratch (it never reads `COFFY_DATABASE_PATH`, `COFFY_APP_URL` or any
other `COFFY_*` value from your shell); and puts an HTTPS proxy on `127.0.0.1` in front of it
that forwards the `Host` header unchanged, as Caddy does on the server. Playwright then runs
`e2e/smoke` with one worker and no retries. The base URL must be an `https` loopback address,
so the specs refuse to run against any other host. Afterwards the server is stopped, the
directory is deleted and the command exits with Playwright's result. Repeated runs start from
the same fresh state and give the same result.

Expected output: `11 passed`, followed by
`smoke: cleanup complete: nothing left running, temporary directory removed`.
Playwright writes its output to `test-results/`, which is git-ignored; traces, screenshots
and videos are turned off.
