# QA

_A field marked **Repos:** applies only to those repositories; a field without the line is project-wide._

## Test Strategy

### Test levels

**Repos:** coffy-shop

- Typecheck — tsc --noEmit on every PR and main build
- Unit + feature — Vitest 5 (node env), 47 files under tests/, each test on its own temporary migrated SQLite file; route handlers are called directly with Request objects
- E2E smoke — Playwright 1.64 Chromium, 11 tests in e2e/smoke, against a local production build behind an HTTPS loopback proxy with a fresh DB and random test admin (npm run smoke)
- Deployed E2E — external E2E partner runs the e2e/README.md scenarios against Demo after the DIJJI deploy event
- Server config (visudo, systemd-analyze verify, caddy validate, provision.sh) — manual on the server only; CI checks them statically (bash -n, wrapper argument validation)

_No separate integration level: the Vitest feature suites already exercise handlers + real SQLite. All levels above except the server-config checks run in this environment._

### Coverage targets

**Repos:** coffy-shop

- Unit: no numeric % gate; every route handler, domain module and page has at least one Vitest suite
- E2E: every System Flow Diagram flow covered by at least one smoke or deployed scenario
- Lighthouse: no target

_No coverage tool or threshold is configured in vitest.config.ts; no Lighthouse run exists._

## Test Case List

### E2E scenarios

**Repos:** coffy-shop

| # | Scenario | Steps |
| --- | --- | --- |
| 0 | Health and version before a run (deploy flow) | GET /api/health = 200 ok/ok; GET /api/version sha equals the deployed commit |
| 1 | Order to Hazır (browser) | Add Espresso -> /sepet -> Siparişi tamamla -> name -> Siparişi ver -> tracking shows Yeni -> admin login -> Siparişler -> order -> Hazırlanıyor -> Hazır -> tracking shows Hazır |
| 2 | Invalid quantity (API) | POST /api/orders quantity 0 and 21 -> 400 invalid_quantity, no order |
| 3 | Empty cart (API) | POST /api/orders items [] -> 400 empty_cart |
| 4 | Unavailable product (API) | POST /api/orders cold-brew -> 400 product_unavailable |
| 5 | Admin API without a session (API) | GET /api/admin/orders -> 401; PATCH status with Origin, no cookie -> 401; PATCH without Origin -> 403 forbidden_origin |
| 6 | Invalid tracking link (browser) | /siparis/gecersiz-baglanti -> 404 'Sipariş bulunamadı veya bağlantı geçersiz' |
| 7 | Same checkout sent twice (API) | Same body twice -> identical 201, one order in admin list; same key different payload -> 409 idempotency_conflict |

_Scenario 0 is the pre-run check in e2e/README.md and verify-release.sh; 1-7 run locally as the 11 smoke tests and on Demo by the E2E partner._

### E2E scenarios (proposed additions)

**Repos:** coffy-shop

| # | Scenario | Steps |
| --- | --- | --- |
| 8 | Edit cart (browser) | Add Americano twice -> /sepet shows Adet 2 -> press - -> Adet 1 -> Sepetten çıkar -> 'Sepetiniz boş.' |
| 9 | Product availability round trip (browser) | Admin login -> toggle Limonata off -> menu shows 'Satışta değil' with disabled button -> toggle on again -> menu shows Satışta |
| 10 | Create and edit a product (browser, local smoke only) | Admin -> Yeni ürün -> fill fields -> Ürünü ekle -> appears on menu -> edit price -> new price on menu |
| 11 | Staff logout (browser) | Admin login -> Çıkış yap -> /yonetim/siparisler redirects to /yonetim/giris; GET /api/admin/orders with the old cookie -> 401 |

_Flows Edit cart, Staff product management and Staff logout have unit/feature coverage but no E2E scenario. Scenario 10 creates a product that cannot be deleted, so it suits only the fresh local smoke DB, not Demo (e2e/README.md: tests never change the menu permanently)._

### Unit coverage

**Repos:** coffy-shop

- Web server API — tests/api: orders, health, version, admin-auth (login/logout, invalid config), admin-products, admin-orders (incl. refusals without session)
- Admin domain — tests/admin: password, config, origin + limiter + session, product-input, try-price-input, admin-api client, proxy, admin components
- Cart domain — tests/cart: cart rules, cart-store, cart-view
- Orders domain — tests/orders: order-request, order-status, checkout-submission, checkout-form
- Menu — tests/menu: format-price, menu-view
- Data access — tests/db: connection, migrate, catalog, menu, orders, admin-orders, admin-products, admin-sessions, backup, reset, reset-guard; concurrent order and status workers in tests/helpers
- Database CLI — tests/cli.test.ts: entry points, guarded reset refusals, admin:hash-password
- Deploy wrapper and server files — tests/deploy/scripts.test.ts: shell syntax, wrapper argument validation, provisioning, config files, runbook
- CI and smoke tooling — tests/scripts: workflows, package-release, upload-release, verify-release, check-deploy-config, smoke harness
- Page: Menü — tests/app/page.test.tsx (menu page, root layout)
- Page: Sepet — tests/app/sepet-page.test.tsx
- Page: Sipariş ver, Sipariş takibi, not-found — tests/app/siparis-pages.test.tsx
- Page: Yönetici girişi and admin pages (Ürünler, Yeni ürün, Ürünü düzenle, Siparişler, Sipariş detayı) — tests/app/yonetim-pages.test.tsx

_Mapped from test file names and their top-level describe blocks._

## CI/CD Integration

### Pipeline flow

**Repos:** coffy-shop

PR opened/updated (pr.yml, target main): npm ci -> typecheck -> npm test -> npm run build -> npx playwright install --with-deps chromium -> npm run smoke:run. Older runs of the same PR are cancelled.
Main push (main.yml):
  build: npm ci -> typecheck -> test -> build -> package:release -> upload artifact (7 days).
  deploy (environment Demo, always runs, no cancel-in-progress): require build success -> check deploy settings -> download artifact -> configure SSH -> upload release -> activate (wrapper: backup, migrate, seed-if-new, switch, restart) -> verify health/version over HTTPS -> rollback on failure -> remove SSH key -> notify DIJJI webhook (success|failure).
Tag push: none.

_A failed build still runs the deploy job only to send the failure notification; nothing is uploaded._

### Run frequency

**Repos:** coffy-shop

| Test type | When |
| --- | --- |
| Typecheck | Every PR update and every push to main |
| Unit + feature (Vitest) | Every PR update and every push to main; locally with npm test |
| E2E smoke (Playwright, local build) | Every PR update; locally with npm run smoke |
| Health + version verification | Every Demo deploy (up to 12 attempts) |
| Deployed E2E scenarios | After each successful Demo deploy notification (external E2E partner) |
| Server config validation | Manually when provisioning or changing the server |

_Triggers from pr.yml and main.yml; deployed E2E timing from deploy/README.md section 5._

## Bug Tracking

### Labels

**Repos:** coffy-shop

- bug
- severity: critical (ordering or deploy broken) / major / minor
- area: menu / cart / checkout / tracking / admin / deploy
- env: local / demo
- regression

_No issue templates or label config exist in the repository; the label set was confirmed in Blueprint review._

### Bug template

**Repos:** coffy-shop

Title: <area>: <what went wrong>
Environment: local / Demo; commit SHA from GET /api/version
Steps to reproduce: numbered
Expected result / Actual result
Order reference (C-<number>) if relevant — never the tracking link, admin password or cookie
Response status and error code ({error, code}) for API failures
Screenshot without credentials

_Mirrors the e2e/README.md rule that credentials never appear in reports; no template exists in the repo, so the template was confirmed in Blueprint review._

## Manual Test Checklist

### Manual Test Checklist

**Repos:** coffy-shop

- Real devices: iOS Safari and Android Chrome — menu, cart, checkout and tracking layout at narrow widths
- Slow / dropped network during checkout: 'Tekrar dene' resends and only one order appears for staff
- Private mode or blocked localStorage: cart shows a clear state and does not crash
- Two tabs: adding in one tab updates the cart badge and cart page in the other
- Keyboard only: every button, form field and the order status control are reachable and operable
- Screen reader: order steps announce the current step; form errors and add-to-cart status are announced
- Copy tracking link: works over HTTPS; fallback message when clipboard is unavailable
- Two staff on the same order: the second click gets the 'durumu değişmiş olabilir' message
- Turkish text and TRY formatting (₺, comma decimals) on all pages; order times shown in Istanbul time

_Derived from client behaviors in src/cart, src/orders and src/admin that the smoke does not exercise._

### Manual Test Checklist — server setup

**Repos:** coffy-shop

- sudo systemd-analyze verify /etc/systemd/system/coffy-shop.service
- sudo visudo -c and sudo -u coffy-deploy sudo -l lists only the deploy wrapper
- sudo caddy validate on the whole Caddyfile before reload; Dolmuş Takip site still answers
- curl http://127.0.0.1:3002/api/health returns ok after env changes and restarts
- Restored backup passes PRAGMA integrity_check before use

_deploy/README.md section 'Not validated in the repository's CI' and the runbook steps._
