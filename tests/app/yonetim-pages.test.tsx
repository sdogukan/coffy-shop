import { cookies } from "next/headers";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import AdminLoginPage, { metadata as loginMetadata } from "../../app/yonetim/giris/page.tsx";
import AdminEditProductPage, { dynamic as editDynamic } from "../../app/yonetim/urunler/[id]/page.tsx";
import AdminProductsPage, { dynamic as listDynamic, metadata as listMetadata } from "../../app/yonetim/urunler/page.tsx";
import AdminNewProductPage, { dynamic as newDynamic } from "../../app/yonetim/urunler/yeni/page.tsx";
import { hashAdminPassword } from "../../src/admin/password.ts";
import { ADMIN_SESSION_COOKIE, createSessionToken, hashSessionToken } from "../../src/admin/session.ts";
import { createAdminSession, endAdminSession, startAdminSession } from "../../src/db/admin-sessions.ts";
import { PRODUCT_FIXTURES, seedCatalog } from "../../src/db/catalog.ts";
import { openDatabase } from "../../src/db/connection.ts";
import { formatPriceKurus } from "../../src/menu/format-price.ts";
import { createTempDatabase, openMigratedDatabase, type TempDatabase } from "../helpers/temp-database.ts";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const REDIRECT_TO_LOGIN = { digest: "NEXT_REDIRECT;replace;/yonetim/giris;307;" };
const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashAdminPassword("Gizli-Kahve-Parolasi-42");
});

// What next/headers' cookies() returns for a request carrying this cookie.
function sendCookie(value: string | undefined): void {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === ADMIN_SESSION_COOKIE && value !== undefined ? { name, value } : undefined),
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

function loggedIn(): string {
  const token = createSessionToken();
  startAdminSession(hashSessionToken(token));
  return token;
}

const PAGES: [string, () => Promise<unknown>][] = [
  ["/yonetim/urunler", () => AdminProductsPage()],
  ["/yonetim/urunler/yeni", () => AdminNewProductPage()],
  ["/yonetim/urunler/[id]", () => AdminEditProductPage({ params: Promise.resolve({ id: "cold-brew" }) })],
];

async function render(page: Promise<unknown>): Promise<string> {
  return renderToStaticMarkup((await page) as ReactElement);
}

describe("admin pages", () => {
  let temp: TempDatabase;

  beforeEach(() => {
    temp = createTempDatabase();
    const db = openMigratedDatabase();
    seedCatalog(db);
    db.close();
    vi.stubEnv("COFFY_ADMIN_USERNAME", "barista");
    vi.stubEnv("COFFY_ADMIN_PASSWORD_HASH", passwordHash);
  });

  afterEach(() => {
    temp.cleanup();
    vi.unstubAllEnvs();
    vi.mocked(cookies).mockReset();
  });

  it("are rendered per request and kept out of search engines", () => {
    expect(listDynamic).toBe("force-dynamic");
    expect(newDynamic).toBe("force-dynamic");
    expect(editDynamic).toBe("force-dynamic");
    expect(listMetadata.robots).toEqual({ index: false, follow: false });
    expect(loginMetadata.robots).toEqual({ index: false, follow: false });
  });

  describe.each(PAGES)("%s", (_path, renderPage) => {
    it("redirects to /yonetim/giris without a cookie, before reading any product data", async () => {
      sendCookie(undefined);
      // No database at all: reading products would throw instead of redirecting.
      temp.cleanup();
      await expect(renderPage()).rejects.toMatchObject(REDIRECT_TO_LOGIN);
    });

    it.each([
      ["a malformed cookie", () => "not-a-token"],
      ["an unknown token", () => createSessionToken()],
      [
        "a revoked session",
        () => {
          const token = loggedIn();
          endAdminSession(hashSessionToken(token));
          return token;
        },
      ],
      [
        "an expired session",
        () => {
          const token = createSessionToken();
          const db = openDatabase();
          createAdminSession(db, hashSessionToken(token), new Date(Date.now() - 9 * 60 * 60 * 1000));
          db.close();
          return token;
        },
      ],
    ])("redirects to /yonetim/giris with %s", async (_name, makeToken) => {
      sendCookie(makeToken());
      await expect(renderPage()).rejects.toMatchObject(REDIRECT_TO_LOGIN);
    });

    it.each([
      ["a missing username", "COFFY_ADMIN_USERNAME", ""],
      ["a malformed password hash", "COFFY_ADMIN_PASSWORD_HASH", "scrypt.bozuk"],
    ])("redirects a valid session to /yonetim/giris when the admin env has %s", async (_name, key, value) => {
      sendCookie(loggedIn());
      vi.stubEnv(key, value);
      await expect(renderPage()).rejects.toMatchObject(REDIRECT_TO_LOGIN);
    });

    it("shows the admin bar with Çıkış to a valid session", async () => {
      sendCookie(loggedIn());
      const html = await render(renderPage());
      expect(html).toContain('<button type="button" class="admin-bar-logout">Çıkış</button>');
    });
  });

  it("lists every product, Cold Brew as closed, with TRY prices, a toggle and an edit link per row", async () => {
    sendCookie(loggedIn());
    const html = await render(AdminProductsPage());
    expect(html).toContain("<h1>Ürünler</h1>");
    expect(html).toContain('<a class="button" href="/yonetim/urunler/yeni">Yeni ürün ekle</a>');
    expect(html.match(/<li class="admin-product">/g)).toHaveLength(PRODUCT_FIXTURES.length);
    for (const product of PRODUCT_FIXTURES) {
      const start = html.indexOf(`<h3>${product.name}</h3>`);
      expect(start, product.name).toBeGreaterThan(-1);
      const row = html.slice(start, html.indexOf("</li>", start));
      expect(row).toContain(`<p class="product-price">${formatPriceKurus(product.priceKurus)}</p>`);
      expect(row).toContain(product.isAvailable === 1 ? ">Satışı kapat</button>" : ">Satışa aç</button>");
      expect(row).toContain(`<a class="admin-edit-link" href="/yonetim/urunler/${product.id}">Düzenle</a>`);
    }
    const coldBrewStart = html.indexOf("<h3>Cold Brew</h3>");
    const coldBrew = html.slice(coldBrewStart, html.indexOf("</li>", coldBrewStart));
    expect(coldBrew).toContain('<p class="admin-status admin-status-closed">Kapalı</p>');
    expect(coldBrew).toContain("₺150,00");
  });

  it("shows the create form with every category and an empty price", async () => {
    sendCookie(loggedIn());
    const html = await render(AdminNewProductPage());
    expect(html).toContain("<h1>Yeni ürün</h1>");
    expect(html).toContain('<option value="sicak-kahveler" selected="">Sıcak Kahveler</option>');
    expect(html).toContain('<option value="soguk-icecekler">Soğuk İçecekler</option>');
    expect(html).toMatch(/name="price" value=""\/>/);
    expect(html).toContain('<button type="submit" class="button">Ürünü ekle</button>');
  });

  it("shows the product's current values on the edit page", async () => {
    sendCookie(loggedIn());
    const html = await render(AdminEditProductPage({ params: Promise.resolve({ id: "cold-brew" }) }));
    expect(html).toContain("<h1>Ürünü düzenle</h1>");
    expect(html).toContain('<option value="soguk-icecekler" selected="">Soğuk İçecekler</option>');
    expect(html).toContain('name="name" value="Cold Brew"/>');
    expect(html).toContain(">18 saat soğuk demlenmiş, yumuşak içimli kahve.</textarea>");
    expect(html).toContain('name="price" value="150,00"/>');
    expect(html).toContain('<input type="checkbox" name="isAvailable"/>');
    expect(html).toContain('<button type="submit" class="button">Değişiklikleri kaydet</button>');
  });

  it.each([["an unknown id", "yok-boyle-urun"], ["an id over 64 characters", "a".repeat(65)]])(
    "renders the not-found page for %s",
    async (_name, id) => {
      sendCookie(loggedIn());
      await expect(AdminEditProductPage({ params: Promise.resolve({ id }) })).rejects.toMatchObject(NOT_FOUND);
    },
  );

  it("checks the session before the product id, so an unknown id without a session goes to login", async () => {
    sendCookie(undefined);
    await expect(AdminEditProductPage({ params: Promise.resolve({ id: "yok-boyle-urun" }) })).rejects.toMatchObject(
      REDIRECT_TO_LOGIN,
    );
  });
});

describe("admin login page", () => {
  it("shows the username and password fields and no admin bar", () => {
    const html = renderToStaticMarkup(<AdminLoginPage />);
    expect(html).toContain("<h1>Yönetici girişi</h1>");
    expect(html).toContain('name="username"');
    expect(html).toContain('type="password"');
    expect(html).not.toContain("Çıkış");
    expect(html).not.toContain("admin-bar");
  });
});
