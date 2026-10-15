import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminBar } from "../../src/admin/admin-bar.tsx";
import type { AdminOutcome } from "../../src/admin/admin-api.ts";
import { AdminProductList } from "../../src/admin/admin-product-list.tsx";
import { applyToggleOutcome, AvailabilityToggleView } from "../../src/admin/availability-toggle.tsx";
import { applyLoginOutcome, LoginForm, LoginFormView, type LoginFormViewProps } from "../../src/admin/login-form.tsx";
import { applyLogoutOutcome, LogoutButton } from "../../src/admin/logout-button.tsx";
import {
  applySaveOutcome,
  buildNewProduct,
  buildProductPatch,
  draftFromProduct,
  emptyDraft,
  type ProductDraft,
  ProductFormView,
  type ProductFormViewProps,
} from "../../src/admin/product-form.tsx";
import { TRY_PRICE_FORMAT_MESSAGE } from "../../src/admin/try-price-input.ts";
import type { MenuCategory, MenuProduct } from "../../src/db/menu.ts";

const noop = () => {};

const LATTE: MenuProduct = {
  id: "caffe-latte",
  categoryId: "sicak-kahveler",
  name: "Caffè Latte",
  description: "Espresso ve süt.",
  priceKurus: 13550,
  isAvailable: true,
};

const COLD_BREW: MenuProduct = {
  id: "cold-brew",
  categoryId: "soguk-icecekler",
  name: "Cold Brew",
  description: "",
  priceKurus: 15000,
  isAvailable: false,
};

const CATEGORIES = [
  { id: "sicak-kahveler", name: "Sıcak Kahveler" },
  { id: "soguk-icecekler", name: "Soğuk İçecekler" },
];

function findElement(node: unknown, predicate: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (!isValidElement<Record<string, unknown>>(node)) {
    return undefined;
  }
  if (predicate(node)) {
    return node;
  }
  return findElement(node.props.children, predicate);
}

function handlers() {
  return { goToList: vi.fn(), goToLogin: vi.fn(), goToProducts: vi.fn(), showError: vi.fn(), showProduct: vi.fn() };
}

describe("login form", () => {
  function render(overrides: Partial<LoginFormViewProps> = {}) {
    return renderToStaticMarkup(
      <LoginFormView
        username=""
        password=""
        sending={false}
        message={null}
        onUsernameChange={noop}
        onPasswordChange={noop}
        onSubmit={noop}
        {...overrides}
      />,
    );
  }

  it("has a username and a password field and a submit button, and no error before a submit", () => {
    const html = renderToStaticMarkup(<LoginForm />);
    expect(html).toContain('<label for="admin-username">Kullanıcı adı</label>');
    expect(html).toMatch(/<input id="admin-username" type="text" autoComplete="username"[^>]*required="" name="username" value=""\/>/);
    expect(html).toContain('<label for="admin-password">Şifre</label>');
    expect(html).toMatch(/<input id="admin-password" type="password" autoComplete="current-password" required="" name="password" value=""\/>/);
    expect(html).toContain('<button type="submit" class="button">Giriş yap</button>');
    expect(html).not.toContain('role="alert"');
  });

  it("shows the error message and locks the form while a login is in flight", () => {
    expect(render({ message: "Kullanıcı adı veya şifre hatalı." })).toContain(
      '<p class="form-error" role="alert">Kullanıcı adı veya şifre hatalı.</p>',
    );
    const sending = render({ sending: true });
    expect(sending).toContain('<fieldset disabled="">');
    expect(sending).toContain('disabled="">Giriş yapılıyor…</button>');
  });

  it("goes to the products page only on success and shows the server's message otherwise", () => {
    const ok = handlers();
    applyLoginOutcome({ kind: "ok", value: true }, ok);
    expect(ok.goToProducts).toHaveBeenCalledOnce();
    expect(ok.showError).not.toHaveBeenCalled();

    for (const outcome of [
      { kind: "unauthorized", message: "Kullanıcı adı veya şifre hatalı." },
      { kind: "failed", message: "Çok fazla başarısız giriş denemesi yapıldı." },
      { kind: "unknown", message: "Sunucuya ulaşılamadı." },
    ] as const) {
      const failed = handlers();
      applyLoginOutcome(outcome, failed);
      expect(failed.showError).toHaveBeenCalledWith(outcome.message);
      expect(failed.goToProducts).not.toHaveBeenCalled();
    }
  });
});

describe("admin bar and logout", () => {
  it("shows a link to the products and a Çıkış button that is a button, not a link", () => {
    const html = renderToStaticMarkup(<AdminBar />);
    expect(html).toContain('<a class="admin-bar-title" href="/yonetim/urunler">Yönetim · Ürünler</a>');
    expect(html).toContain('<button type="button" class="admin-bar-logout">Çıkış</button>');
    expect(html).not.toContain('href="/api/admin/logout"');
  });

  it("goes to the login page after a logout and shows the reason when it failed", () => {
    const ok = handlers();
    applyLogoutOutcome({ kind: "ok", value: true }, ok);
    expect(ok.goToLogin).toHaveBeenCalledOnce();

    const failed = handlers();
    applyLogoutOutcome({ kind: "failed", message: "İstek reddedildi." }, failed);
    expect(failed.goToLogin).not.toHaveBeenCalled();
    expect(failed.showError).toHaveBeenCalledWith("İstek reddedildi.");
  });

  it("renders the logout button on its own with no error", () => {
    expect(renderToStaticMarkup(<LogoutButton />)).toBe('<button type="button" class="admin-bar-logout">Çıkış</button>');
  });
});

describe("availability toggle", () => {
  it("shows the state and the opposite action, and is disabled while pending", () => {
    const open = renderToStaticMarkup(
      <AvailabilityToggleView productName="Espresso" isAvailable pending={false} message={null} onToggle={noop} />,
    );
    expect(open).toContain('<p class="admin-status">Satışta</p>');
    expect(open).toContain('aria-label="Espresso: satışı kapat">Satışı kapat</button>');
    expect(open).not.toContain("disabled");

    const closedPending = renderToStaticMarkup(
      <AvailabilityToggleView productName="Cold Brew" isAvailable={false} pending message="Hata" onToggle={noop} />,
    );
    expect(closedPending).toContain('<p class="admin-status admin-status-closed">Kapalı</p>');
    expect(closedPending).toContain('disabled="" aria-label="Cold Brew: satışa aç">Satışa aç</button>');
    expect(closedPending).toContain('<p class="form-error" role="alert">Hata</p>');
  });

  it("calls onToggle from the button", () => {
    const onToggle = vi.fn();
    const button = findElement(
      AvailabilityToggleView({ productName: "Espresso", isAvailable: true, pending: false, message: null, onToggle }),
      (element) => element.type === "button",
    );
    (button?.props.onClick as () => void)();
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("shows the server's product state, goes to login on 401 and shows errors otherwise", () => {
    const ok = handlers();
    applyToggleOutcome({ kind: "ok", value: COLD_BREW }, ok);
    expect(ok.showProduct).toHaveBeenCalledWith(COLD_BREW);

    const unauthorized = handlers();
    applyToggleOutcome({ kind: "unauthorized", message: "Oturum yok" }, unauthorized);
    expect(unauthorized.goToLogin).toHaveBeenCalledOnce();
    expect(unauthorized.showProduct).not.toHaveBeenCalled();
    expect(unauthorized.showError).not.toHaveBeenCalled();

    for (const kind of ["failed", "unknown"] as const) {
      const failed = handlers();
      applyToggleOutcome({ kind, message: "Yapılamadı" }, failed);
      expect(failed.showError).toHaveBeenCalledWith("Yapılamadı");
      expect(failed.showProduct).not.toHaveBeenCalled();
    }
  });
});

describe("admin product list", () => {
  const MENU: MenuCategory[] = [
    { id: "sicak-kahveler", name: "Sıcak Kahveler", products: [LATTE] },
    { id: "soguk-icecekler", name: "Soğuk İçecekler", products: [COLD_BREW] },
    { id: "tatlilar", name: "Tatlılar", products: [] },
  ];

  it("lists every product with its TRY price, a toggle and an edit link, closed ones included", () => {
    const html = renderToStaticMarkup(<AdminProductList menu={MENU} />);
    expect(html).toContain("<h3>Caffè Latte</h3>");
    expect(html).toContain('<p class="product-price">₺135,50</p>');
    expect(html).toContain('<a class="admin-edit-link" href="/yonetim/urunler/caffe-latte">Düzenle</a>');
    const coldBrew = html.slice(html.indexOf("<h3>Cold Brew</h3>"));
    expect(coldBrew).toContain("₺150,00");
    expect(coldBrew).toContain("Kapalı");
    expect(coldBrew).toContain(">Satışa aç</button>");
    expect(coldBrew).toContain('href="/yonetim/urunler/cold-brew"');
    expect(html).toContain("Bu kategoride henüz ürün yok.");
  });

  it("encodes the product id in the edit link", () => {
    const html = renderToStaticMarkup(
      <AdminProductList menu={[{ id: "c", name: "C", products: [{ ...LATTE, id: "a b/c" }] }]} />,
    );
    expect(html).toContain('href="/yonetim/urunler/a%20b%2Fc"');
  });
});

describe("product form", () => {
  function viewProps(overrides: Partial<ProductFormViewProps> = {}): ProductFormViewProps {
    return {
      categories: CATEGORIES,
      draft: draftFromProduct(LATTE),
      phase: "editing",
      message: null,
      submitLabel: "Değişiklikleri kaydet",
      onChange: noop,
      onSubmit: noop,
      ...overrides,
    };
  }

  it("starts with the product's current values, the price as TRY text", () => {
    expect(draftFromProduct(LATTE)).toEqual({
      categoryId: "sicak-kahveler",
      name: "Caffè Latte",
      description: "Espresso ve süt.",
      price: "135,50",
      isAvailable: true,
    });
    const html = renderToStaticMarkup(<ProductFormView {...viewProps()} />);
    expect(html).toContain('<option value="sicak-kahveler" selected="">Sıcak Kahveler</option>');
    expect(html).toMatch(/<input id="product-name" type="text" required="" maxLength="60" name="name" value="Caffè Latte"\/>/);
    expect(html).toMatch(/<textarea id="product-description"[^>]*maxLength="200">Espresso ve süt.<\/textarea>/);
    expect(html).toMatch(/<input id="product-price" type="text" inputMode="decimal"[^>]*name="price" value="135,50"\/>/);
    expect(html).toMatch(/<input type="checkbox" name="isAvailable" checked=""\/>/);
    expect(html).toContain('<button type="submit" class="button">Değişiklikleri kaydet</button>');
  });

  it("starts a new product in the first category, open for sale and with empty fields", () => {
    expect(emptyDraft(CATEGORIES)).toEqual({ categoryId: "sicak-kahveler", name: "", description: "", price: "", isAvailable: true });
    expect(emptyDraft([]).categoryId).toBe("");
  });

  it("disables the submit button while sending and, after a lost create, offers only the way back to the list", () => {
    const sending = renderToStaticMarkup(<ProductFormView {...viewProps({ phase: "sending" })} />);
    expect(sending).toContain('<fieldset disabled="">');
    expect(sending).toContain('<button type="submit" class="button" disabled="">Kaydediliyor…</button>');

    const unknown = renderToStaticMarkup(<ProductFormView {...viewProps({ phase: "unknown", message: "Doğrulanamadı" })} />);
    expect(unknown).toContain('<fieldset disabled="">');
    expect(unknown).not.toContain('type="submit"');
    expect(unknown).toContain('<a class="button" href="/yonetim/urunler">Ürün listesine dön</a>');
    expect(unknown).toContain('<p class="form-error" role="alert">Doğrulanamadı</p>');
  });

  it("reports every field change as a new draft", () => {
    const onChange = vi.fn<(draft: ProductDraft) => void>();
    const tree = ProductFormView(viewProps({ onChange }));
    const price = findElement(tree, (element) => element.props.id === "product-price");
    (price?.props.onChange as (event: unknown) => void)({ target: { value: "99,9" } });
    const checkbox = findElement(tree, (element) => element.props.name === "isAvailable");
    (checkbox?.props.onChange as (event: unknown) => void)({ target: { checked: false } });
    expect(onChange.mock.calls.map(([draft]) => draft)).toEqual([
      { ...draftFromProduct(LATTE), price: "99,9" },
      { ...draftFromProduct(LATTE), isAvailable: false },
    ]);
  });

  it("builds a create body with integer priceKurus and trimmed text", () => {
    expect(
      buildNewProduct({ categoryId: "sicak-kahveler", name: "  Flat White ", description: " Çift shot ", price: "140,5", isAvailable: false }),
    ).toEqual({
      ok: true,
      value: { categoryId: "sicak-kahveler", name: "Flat White", description: "Çift shot", priceKurus: 14050, isAvailable: false },
    });
  });

  it.each(["", "abc", "1.250,00", "-5", "1,234"])("refuses to send a price typed as %j", (price) => {
    expect(buildNewProduct({ ...emptyDraft(CATEGORIES), name: "X", price })).toEqual({
      ok: false,
      message: TRY_PRICE_FORMAT_MESSAGE,
    });
    expect(buildProductPatch(LATTE, { ...draftFromProduct(LATTE), price })).toEqual({ ok: false, message: TRY_PRICE_FORMAT_MESSAGE });
  });

  it("sends only the fields that changed on edit", () => {
    expect(buildProductPatch(LATTE, { ...draftFromProduct(LATTE), price: "140" })).toEqual({ ok: true, value: { priceKurus: 14000 } });
    expect(
      buildProductPatch(LATTE, { ...draftFromProduct(LATTE), name: "Latte", categoryId: "soguk-icecekler", isAvailable: false }),
    ).toEqual({ ok: true, value: { name: "Latte", categoryId: "soguk-icecekler", isAvailable: false } });
    expect(buildProductPatch(LATTE, { ...draftFromProduct(LATTE), description: "" })).toEqual({ ok: true, value: { description: "" } });
  });

  it("sends nothing when the edit changes nothing (whitespace and an equal price included)", () => {
    expect(buildProductPatch(LATTE, { ...draftFromProduct(LATTE), name: " Caffè Latte ", price: "135,5" })).toEqual({
      ok: false,
      message: "Kaydedilecek bir değişiklik yok.",
    });
  });

  it("goes to the list on success and to the login page on 401", () => {
    const ok = handlers();
    applySaveOutcome({ kind: "ok", value: LATTE }, "create", ok);
    expect(ok.goToList).toHaveBeenCalledOnce();

    const unauthorized = handlers();
    applySaveOutcome({ kind: "unauthorized", message: "Oturum yok" }, "edit", unauthorized);
    expect(unauthorized.goToLogin).toHaveBeenCalledOnce();
    expect(unauthorized.goToList).not.toHaveBeenCalled();
  });

  it.each([
    ["failed", "create", "editing"],
    ["failed", "edit", "editing"],
    ["unknown", "create", "unknown"],
    ["unknown", "edit", "editing"],
  ] as const)("after a %s %s the form is %s", (kind, mode, phase) => {
    const result = handlers();
    applySaveOutcome({ kind, message: "Mesaj" } as AdminOutcome<MenuProduct>, mode, result);
    expect(result.showError).toHaveBeenCalledWith("Mesaj", phase);
    expect(result.goToList).not.toHaveBeenCalled();
  });
});
