# Design

_A field marked **Repos:** applies only to those repositories; a field without the line is project-wide._

## Page List (Sitemap)

### Public pages

**Repos:** coffy-shop

| # | Page | URL |
| --- | --- | --- |
| 1 | Menü (home) | / |
| 2 | Sepet (cart) | /sepet |
| 3 | Sipariş ver (checkout) | /siparis-ver |
| 4 | Sipariş takibi (order tracking) + not-found state | /siparis/{token} |

_App Router page.tsx files under app/._

### Admin pages

**Repos:** coffy-shop

| # | Page | URL |
| --- | --- | --- |
| 1 | Yönetici girişi (login, no session needed) | /yonetim/giris |
| 2 | Ürünler (product list) | /yonetim/urunler |
| 3 | Yeni ürün (new product) | /yonetim/urunler/yeni |
| 4 | Ürünü düzenle (edit product) | /yonetim/urunler/{id} |
| 5 | Siparişler (order list) | /yonetim/siparisler |
| 6 | Sipariş detayı (order detail) | /yonetim/siparisler/{id} |
| 7 | Süt seçenekleri (milk options) | /yonetim/sut-secenekleri |

_Protected pages call requireAdminPage; proxy.ts matches /yonetim/:path* and lets the login page through._

## Wireframes

### Menu (home) — wireframe

**Repos:** coffy-shop

```
+----------------------------------+
| Coffy Shop            Sepet (2)  |  sticky top bar
+----------------------------------+
| Menü                             |
| Sıcak Kahveler                   |
| +------------------------------+ |
| | Espresso                     | |
| | Yoğun ve aromalı ...         | |
| | ₺90,00                       | |
| | Satışta                      | |
| | [ Sepete ekle ]              | |
| | Sepete eklendi.              | |
| +------------------------------+ |
| Soğuk İçecekler                  |
| +------------------------------+ |
| | Cold Brew   (dimmed)         | |
| | Satışta değil  [disabled]    | |
| +------------------------------+ |
+----------------------------------+
```

_MenuView + AddToCartButton; main max-width 40rem, same layout on desktop (centered)._

### Menu (home) — notes

**Repos:** coffy-shop

Container: main, max-width 40rem, centered, 1rem padding. Header: sticky brown top bar with brand link and "Sepet" link + item-count badge.
Body: one section per category (h2), product cards (white, radius 0.5rem).
States: empty menu -> "Menü şu anda boş."; empty category -> "Bu kategoride henüz ürün yok."; unavailable product -> card at 0.7 opacity, red "Satışta değil", add button disabled; add success -> "Sepete eklendi."; add over 20 -> "Bu üründen en fazla 20 adet eklenebilir."
Desktop delta: none beyond centering.

_Read from component strings and globals.css._

### Cart — wireframe

**Repos:** coffy-shop

```
+----------------------------------+
| Coffy Shop            Sepet (3)  |
+----------------------------------+
| Sepet                            |
| +------------------------------+ |
| | Espresso                     | |
| | Birim fiyat: ₺90,00          | |
| | Adet: 2                      | |
| | Ara toplam: ₺180,00          | |
| | [ - ] [ + ]                  | |
| | ( Sepetten çıkar )           | |
| +------------------------------+ |
| +------------------------------+ |
| | Cold Brew (dimmed)           | |
| | Satışta değil. Toplama dahil | |
| | edilmedi.  ( Sepetten çıkar )| |
| +------------------------------+ |
| Toplam: ₺180,00                  |
| Fiyatlar bilgi amaçlıdır; ...    |
| [ Siparişi tamamla ]             |
+----------------------------------+
```

_CartContents in src/cart/cart-view.tsx._

### Cart — notes

**Repos:** coffy-shop

States: loading (before hydration) -> "Sepet yükleniyor…" (aria-busy); empty -> "Sepetiniz boş." + "Menüye dön"; line ok -> -/+ (disabled at 1 and 20) and remove; line unavailable -> "Satışta değil. Toplama dahil edilmedi."; line missing -> "Ürün bulunamadı" with product code.
The total is informational; the note says current prices apply at order time.
Changes in another tab update this page (storage event).

_Cart store uses useSyncExternalStore with a null server snapshot to avoid an empty-cart flash._

### Checkout — wireframe

**Repos:** coffy-shop

```
+----------------------------------+
| Sipariş ver                      |
| +-- Sepetiniz -----------------+ |
| | Espresso × 2       ₺180,00   | |
| | Toplam: ₺180,00              | |
| | Sepeti düzenle               | |
| +------------------------------+ |
| +-- form ----------------------+ |
| | Adınız  [______________]     | |
| | Sipariş notu [__________]    | |
| | İsteğe bağlı, en fazla 200   | |
| | (error message, role=alert)  | |
| | [ Siparişi ver ]             | |
| +------------------------------+ |
+----------------------------------+
after 201:
+-- Siparişiniz alındı -----------+
| Sipariş numaranız: C-1001       |
| Toplam: ₺180,00                 |
| Mağazadan teslim alınacaktır.   |
| https://.../siparis/<token>     |
| [ Bağlantıyı kopyala ]          |
+---------------------------------+
```

_CheckoutFormView and OrderConfirmation in src/orders/checkout-form.tsx._

### Checkout — notes

**Repos:** coffy-shop

States: loading -> "Sepet yükleniyor…"; empty -> "Sepetiniz boş." + "Menüye dön"; editing -> button "Siparişi ver"; sending -> fieldset disabled, button "Gönderiliyor…"; unknown (timeout/network/5xx) -> form stays locked, button "Tekrar dene" resends the same body; rejected (4xx) -> server message shown, form editable; success -> confirmation, then cart cleared.
Copy button: "Bağlantı kopyalandı." or a fallback telling the customer to select the link text.
Inputs: name required, maxLength 60, autocomplete name; note maxLength 200.

_createCheckoutSubmitter keeps the captured body until a definitive answer._

### Order tracking — wireframe

**Repos:** coffy-shop

```
+----------------------------------+
| Sipariş takibi                   |
| Sipariş numarası: C-1001         |
| Teslim alacak: Ayşe              |
| Durum: Hazırlanıyor              |
| +------------------------------+ |
| | Yeni          (done)         | |
| | Hazırlanıyor  (current, fill)| |
| | Hazır                        | |
| | Tamamlandı                   | |
| +------------------------------+ |
| [ Durumu yenile ]                |
| Espresso / Birim / Adet / Ara t. |
| Toplam: ₺180,00                  |
| Mağazadan teslim alınacaktır.    |
+----------------------------------+
not-found:
| Sipariş bulunamadı veya bağlantı |
| geçersiz      Menüye dön         |
```

_OrderTrackingView and not-found.tsx; steps become a horizontal row at >= 30rem._

### Order tracking — notes

**Repos:** coffy-shop

Steps: ordered list labelled "Sipariş durumu"; done steps outlined, current step filled and aria-current="step".
Refresh: "Durumu yenile" is a plain link to the same URL (no polling).
States: found; not-found (404) for malformed and unknown tokens alike.
Desktop delta (>= 30rem): steps laid out in one row, equal width.
Metadata: noindex, nofollow, referrer no-referrer.

_Token secrecy and fresh reads drive these choices._

### Admin login — wireframe

**Repos:** coffy-shop

```
+----------------------------------+
| Coffy Shop            Sepet      |
+----------------------------------+
| Yönetici girişi                  |
| +------------------------------+ |
| | Kullanıcı adı [__________]   | |
| | Şifre         [__________]   | |
| | (error, role=alert)          | |
| | [ Giriş yap ]                | |
| +------------------------------+ |
+----------------------------------+
```

_LoginForm in src/admin/login-form.tsx._

### Admin login — notes

**Repos:** coffy-shop

States: idle; sending (button disabled); error messages from the API: "Kullanıcı adı veya şifre hatalı.", "Çok fazla başarısız giriş denemesi yapıldı...", "Yönetici girişi şu anda kapalı."; success -> /yonetim/urunler.
Admin pages are noindex.

_Messages come from ADMIN_ERRORS in src/admin/http.ts._

### Admin products — wireframe

**Repos:** coffy-shop

```
+----------------------------------+
| Coffy Shop            Sepet      |
+----------------------------------+
| Yönetim  Ürünler Siparişler Süt seçenekleri [Çıkış yap] |  dark admin bar
+----------------------------------+
| Ürünler                          |
| [ Yeni ürün ekle ]               |
| Sıcak Kahveler                   |
| +------------------------------+ |
| | Espresso        ₺90,00       | |
| | Satışta  ( satışı kapat )    | |
| | Düzenle                      | |
| +------------------------------+ |
| | Cappuccino      ₺130,00      | |
| | Sütlü                        | |
| | Satışta  ( satışı kapat )    | |
| | Düzenle                      | |
| +------------------------------+ |
+----------------------------------+
```

_AdminBar + AdminProductList + AvailabilityToggle; at >= 30rem each card is one row._

### Admin products — notes

**Repos:** coffy-shop

States: no categories -> "Henüz kategori yok."; empty category -> "Bu kategoride henüz ürün yok."; toggle pending -> button disabled; toggle error -> message (role=alert); 401 -> redirect to login.
Closed products show their status in red. Milk products show a "Sütlü" status text (.admin-status) under the price.
Desktop delta (>= 30rem): info, toggle and edit link side by side.

_Read from component code and globals.css admin rules._

### Admin product form (new / edit) — wireframe

**Repos:** coffy-shop

```
+----------------------------------+
| (admin bar)                      |
| Yeni ürün  /  Ürünü düzenle      |
| +------------------------------+ |
| | Kategori   [select v]        | |
| | Ürün adı   [__________]      | |
| | Açıklama   [__________]      | |
| | Fiyat (TL) [______]          | |
| | [x] Satışta                  | |
| | [x] Sütlü ürün               | |
| | (error, role=alert)          | |
| | [ Vazgeç ]  [ Ürünü ekle ]   | |
| |      or [ Değişiklikleri kaydet ] |
| +------------------------------+ |
+----------------------------------+
```

_One ProductForm component for both pages._

### Admin product form (new / edit) — notes

**Repos:** coffy-shop

Price input is TRY text converted to kuruş (try-price-input), valid 0,01-10.000,00 TL.
"Sütlü ürün" checkbox (containsMilk) next to "Satışta": unchecked on a new product, the stored value on edit; sent only when changed.
Validation messages: invalid_name, invalid_description, invalid_price, unknown_category (Turkish texts in PRODUCT_INPUT_ERRORS).
States: editing; sending (submit disabled); error; success -> back to /yonetim/urunler. Unknown product id -> not found.

_Server validation in product-input.ts mirrors the form limits._

### Admin orders — wireframe

**Repos:** coffy-shop

```
+----------------------------------+
| (admin bar)                      |
| Siparişler                       |
| +------------------------------+ |
| | C-1002            Hazır      | |
| | Ayşe              ₺180,00    | |
| | 15.10.2026 14:05             | |
| +------------------------------+ |
| | C-1001            Yeni       | |
| | ...                          | |
+----------------------------------+
```

_AdminOrderList; time formatted tr-TR in Europe/Istanbul._

### Admin orders — notes

**Repos:** coffy-shop

States: empty -> "Henüz sipariş yok."; list newest first; reference links to the detail page.
No filtering, paging or auto-refresh: staff reload the page.
Desktop delta (>= 30rem): info left, status and total right-aligned on one row.

_Every order is listed in one query ordered by id DESC._

### Admin order detail — wireframe

**Repos:** coffy-shop

```
+----------------------------------+
| (admin bar)                      |
| Sipariş C-1001                   |
| Teslim alacak: Ayşe              |
| Durum: Yeni                      |
| [ Hazırlanıyor olarak işaretle ] |
| (error, role=alert)              |
| Espresso / Birim / Adet / Ara t. |
| Toplam: ₺180,00                  |
| Sipariş notu: ...                |
+----------------------------------+
```

_OrderStatusControl renders exactly one next-step button; none for completed._

### Admin order detail — notes

**Repos:** coffy-shop

States: pending (button disabled); success -> shown status updates to the stored one; 409 -> server message, status unchanged; unknown -> "Durum değişikliğinin kaydedilip kaydedilmediği doğrulanamadı..." ; 401 -> login; completed -> no button.
Malformed or unknown id -> not found.

_applyStatusOutcome only changes the shown status on 200._

### Admin milk options — wireframe

**Repos:** coffy-shop

```
+----------------------------------+
| (admin bar)                      |
| Süt seçenekleri                  |
| +------------------------------+ |
| | Normal süt                   | |
| | Ücretsiz                     | |
| +------------------------------+ |
| | Yulaf sütü      +₺25,50      | |
| | Satışta                      | |
| | Ek ücret (TL) [25,50]        | |
| | [ Ek ücreti kaydet ]         | |
| | [ Satıştan kaldır ]          | |
| | (error, role=alert)          | |
| +------------------------------+ |
| Yeni süt seçeneği                |
| Süt seçeneği adı [__________]    |
| Ek ücret (TL)    [25,50]         |
| (error, role=alert)              |
| [ Süt seçeneğini ekle ]          |
|   or [ Listeyi yenile ]          |
+----------------------------------+
```

_AdminBar + MilkOptionList + MilkOptionCreateForm on a separate page linked from the admin bar (the design reference allowed a page or a section on Ürünler). Yulaf sütü is an example row: only Normal süt exists until staff add options._

### Admin milk options — notes

**Repos:** coffy-shop

Normal süt (default) shows "Ücretsiz" with no surcharge input and no removal control, so nothing on the page can change it.
Other options: name, +surcharge, status "Satışta" or "Satıştan kaldırıldı" (red, like closed products); "Ek ücret (TL)" is TRY text (try-price-input) saved with "Ek ücreti kaydet"; "Satıştan kaldır" / "Satışa aç" sends the target availability. Both controls are disabled while a request is pending and the row shows only the server's answer.
Add form "Yeni süt seçeneği": "Süt seçeneği adı" (max 60) and "Ek ücret (TL)" with the hint "Kuruşu virgülle ayırın, örneğin 25,50."; success reloads the page so the list shows the new option; an unknown outcome locks the form and offers "Listeyi yenile" instead of a resend.
Errors: invalid TRY text shows the format message without a request; a server 400 shows its Turkish message in .form-error role=alert; 401 -> /yonetim/giris.
Layout: the task design reference asks for mobile-first single column with one row at >= 30rem. Implementation gap: app/globals.css has no >= 30rem rule for .admin-milk-option, so the card stays a single column at every width.

_A create has no idempotency key, so the form never resends on its own; absolute target values keep two tabs from flipping each other's state._

## Design System

### Color palette

**Repos:** coffy-shop

Primary: #6b3e1f (top bar, buttons, links, current order step)
Text: #2b1d14 (also admin bar background)
Background: #fbf7f2; surfaces/cards: #fff
Border / disabled: #b9a89b; muted text: #7a6a5e
Error: #a12a1b (form errors, "Satışta değil"); admin bar error text: #ffd7d0
Success / warning / info: not defined

_Hard-coded hex values in globals.css; no CSS variables._

### Typography

**Repos:** coffy-shop

Font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height 1.5.
Sizes in use: browser defaults for h1/h2, 1.1rem for card headings, 0.9rem for form hints.
Weights: 600 for labels, links and status, 700 for prices, totals and the current step.
No xs-4xl scale defined.

_Only the sizes above appear in globals.css._

### Spacing

**Repos:** coffy-shop

Base unit: 1rem (16px). Scale in use: 0.25rem, 0.4rem, 0.5rem, 0.75rem, 1rem.
Page padding 1rem; card padding 1rem; card gap 0.75rem.

_rem values from globals.css._

### Border radius

**Repos:** coffy-shop

md: 0.5rem (cards, buttons, inputs, order steps)
full: 999px (cart badge)
sm / lg / xl: not used

_Only two radius values exist in globals.css._

### Component patterns

**Repos:** coffy-shop

Button: .button primary (brown fill, white text, min-height 2.75rem); .button-secondary (outline); disabled (#b9a89b, not-allowed). Links styled as buttons via a.button.
Input: full width, 0.5rem padding, 1px #b9a89b border, 0.5rem radius; labels bold above the field.
Card: white surface, 0.5rem radius, 1rem padding (.product, .cart-line, .checkout-summary, .admin-form ...).
Feedback: .form-error with role="alert"; status text with role="status".
Modal: none.

_Class names from globals.css and the components using them._

### Responsive breakpoints

**Repos:** coffy-shop

- base: mobile-first single column, content max-width 40rem (640px), centered
- min-width 30rem (480px): admin product/order cards become one row; order steps become a horizontal row
- sm 640 / md 768 / lg 1024 / xl 1280: not used

_One @media rule in globals.css._

### Animation

**Repos:** coffy-shop

None: no transitions, keyframes or animation rules.

_globals.css has no transition or animation property._

## Framework Config

### Framework Config

**Repos:** coffy-shop

Styling: app/globals.css imported once in app/layout.tsx; no Tailwind, no CSS modules, no CSS variables.
next.config.ts:
  output: "standalone"
  images: { unoptimized: true }
  env: { COFFY_BUILD_SHA: GITHUB_SHA or git rev-parse HEAD (must be 40 lowercase hex) }
proxy.ts: matcher "/yonetim/:path*" redirects to /yonetim/giris without a well-shaped session cookie.
html lang="tr".

_Exact config files in the repository root._
