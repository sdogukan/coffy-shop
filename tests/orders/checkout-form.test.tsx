import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Cart, resolveCart } from "../../src/cart/cart.ts";
import { CART_STORAGE_KEY } from "../../src/cart/cart-store.ts";
import type { MenuCategory } from "../../src/db/menu.ts";
import {
  applyCheckoutOutcome,
  type CheckoutFormViewProps,
  CheckoutForm,
  CheckoutFormView,
  copyText,
  type OrderConfirmationDetails,
  OrderConfirmation,
} from "../../src/orders/checkout-form.tsx";
import type { CheckoutOutcome } from "../../src/orders/checkout-submission.ts";

const MENU: MenuCategory[] = [
  {
    id: "sicak-kahveler",
    name: "Sıcak Kahveler",
    products: [
      { id: "espresso", categoryId: "sicak-kahveler", name: "Espresso", description: "", priceKurus: 9000, isAvailable: true, containsMilk: false },
      { id: "latte", categoryId: "sicak-kahveler", name: "Latte", description: "", priceKurus: 13550, isAvailable: true, containsMilk: true },
      { id: "cold-brew", categoryId: "sicak-kahveler", name: "Cold Brew", description: "", priceKurus: 12000, isAvailable: false, containsMilk: false },
    ],
  },
];

const CART: Cart = [
  { productId: "espresso", quantity: 2 },
  { productId: "latte", quantity: 1 },
];

const TRACKING_PATH = `/siparis/${"a".repeat(43)}`;
const noop = () => {};

function viewProps(overrides: Partial<CheckoutFormViewProps> = {}): CheckoutFormViewProps {
  return {
    lines: resolveCart(CART, MENU),
    customerName: "",
    note: "",
    phase: "editing",
    message: null,
    onCustomerNameChange: noop,
    onNoteChange: noop,
    onSubmit: noop,
    ...overrides,
  };
}

function render(overrides: Partial<CheckoutFormViewProps> = {}): string {
  return renderToStaticMarkup(<CheckoutFormView {...viewProps(overrides)} />);
}

function findElement(node: unknown, type: string): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (!isValidElement<Record<string, unknown>>(node)) {
    return undefined;
  }
  if (node.type === type) {
    return node;
  }
  return findElement(node.props.children, type);
}

describe("CheckoutFormView", () => {
  it("shows the cart summary, Adınız, Sipariş notu and Siparişi ver, and asks for no payment data", () => {
    const html = render();
    expect(html).toContain("Espresso × 2");
    expect(html).toContain("₺180,00");
    expect(html).toContain("Latte × 1");
    expect(html).toContain("Toplam: ₺315,50");
    expect(html).toContain('<label for="checkout-customer-name">Adınız</label>');
    expect(html).toContain('<label for="checkout-note">Sipariş notu</label>');
    expect(html).toContain('<button type="submit" class="button">Siparişi ver</button>');
    expect(html).toContain('<a href="/sepet">Sepeti düzenle</a>');
    // The only fields are the name and the note.
    expect(html.match(/<input /g)).toHaveLength(1);
    expect(html.match(/<textarea /g)).toHaveLength(1);
    expect(html).toContain('name="customerName"');
    expect(html).toContain('name="note"');
    expect(html).toMatch(/<input[^>]*required=""[^>]*maxLength="60"/);
    expect(html).toMatch(/<textarea[^>]*maxLength="200"/);
    expect(html.toLocaleLowerCase("tr")).not.toMatch(/ödeme|kart numara|cvv|iban/);
  });

  it("shows the empty-cart state with a link to the menu and no form when the cart is empty", () => {
    const html = render({ lines: [] });
    expect(html).toContain("Sepetiniz boş.");
    expect(html).toContain('<a href="/">Menüye dön</a>');
    expect(html).not.toContain("<form");
  });

  it("flags lines that can no longer be ordered", () => {
    const html = render({
      lines: resolveCart(
        [
          { productId: "espresso", quantity: 1 },
          { productId: "cold-brew", quantity: 1 },
          { productId: "gone", quantity: 1 },
        ],
        MENU,
      ),
    });
    expect(html).toContain("Cold Brew × 1");
    expect(html).toContain("Satışta değil");
    expect(html).toContain("Ürün bulunamadı (kod: gone) × 1");
    expect(html).toContain("Menüde yok");
    expect(html).toContain("Toplam: ₺90,00");
  });

  it("locks the fields and the button while a request is in flight", () => {
    const html = render({ phase: "sending" });
    expect(html).toContain('<fieldset disabled="">');
    expect(html).toContain('<button type="submit" class="button" disabled="">Gönderiliyor…</button>');
  });

  it("keeps the fields locked and offers Tekrar dene after an unknown result", () => {
    const html = render({ phase: "unknown", message: "Doğrulanamadı." });
    expect(html).toContain('<fieldset disabled="">');
    expect(html).toContain('<button type="submit" class="button">Tekrar dene</button>');
    expect(html).toContain('<p class="form-error" role="alert">Doğrulanamadı.</p>');
  });

  it("shows the server's message with editable fields after a rejection", () => {
    const html = render({ message: "Latte şu anda satışta değil. Lütfen sepetinizden çıkarın." });
    expect(html).toContain("<fieldset>");
    expect(html).toContain('role="alert">Latte şu anda satışta değil. Lütfen sepetinizden çıkarın.</p>');
    expect(html).toContain(">Siparişi ver</button>");
  });

  it("prevents the browser's own form submission and calls onSubmit", () => {
    const onSubmit = vi.fn();
    const form = findElement(CheckoutFormView(viewProps({ onSubmit })), "form");
    const preventDefault = vi.fn();
    (form?.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});

describe("CheckoutForm before the browser cart is read", () => {
  it("renders a loading state with nothing to submit", () => {
    const html = renderToStaticMarkup(<CheckoutForm menu={MENU} />);
    expect(html).toContain("Sepet yükleniyor…");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Sepetiniz boş");
  });
});

describe("OrderConfirmation", () => {
  it("shows the reference, the total, the pickup note and a copyable absolute tracking link", () => {
    const url = `https://coffy.example${TRACKING_PATH}`;
    const html = renderToStaticMarkup(
      <OrderConfirmation details={{ order: { reference: "C-1001", trackingPath: TRACKING_PATH, totalKurus: 31550 }, trackingUrl: url }} />,
    );
    expect(html).toContain("Sipariş numaranız: <strong>C-1001</strong>");
    expect(html).toContain("Toplam: ₺315,50");
    expect(html).toContain("Mağazadan teslim alınacaktır.");
    expect(html).toContain(`<p class="tracking-link"><a href="${url}">${url}</a></p>`);
    expect(html).toContain(">Bağlantıyı kopyala</button>");
  });
});

describe("copyText", () => {
  it("writes the text to the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    expect(await copyText("https://x/siparis/t", { writeText })).toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://x/siparis/t");
  });

  it("reports failure without a clipboard (insecure context) or when writing is refused", async () => {
    expect(await copyText("t", undefined)).toBe(false);
    expect(await copyText("t", { writeText: async () => Promise.reject(new DOMException("denied", "NotAllowedError")) })).toBe(
      false,
    );
  });
});

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("applyCheckoutOutcome", () => {
  const STORED = JSON.stringify(CART);
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    storage.setItem(CART_STORAGE_KEY, STORED);
    vi.stubGlobal("window", { localStorage: storage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("on 201 shows the confirmation with the absolute tracking link first and then empties the stored cart", () => {
    const seenInStorage: (string | null)[] = [];
    const showConfirmation = vi.fn((_details: OrderConfirmationDetails) => {
      seenInStorage.push(storage.getItem(CART_STORAGE_KEY));
    });
    const showError = vi.fn();
    const order = { reference: "C-1001", trackingPath: TRACKING_PATH, totalKurus: 31550 };
    applyCheckoutOutcome({ kind: "placed", order }, "https://coffy.example", { showConfirmation, showError });

    expect(showConfirmation).toHaveBeenCalledWith({ order, trackingUrl: `https://coffy.example${TRACKING_PATH}` });
    expect(seenInStorage).toEqual([STORED]);
    expect(storage.getItem(CART_STORAGE_KEY)).toBe("[]");
    expect(showError).not.toHaveBeenCalled();
  });

  it("calls the clear step only after the confirmation", () => {
    const calls: string[] = [];
    applyCheckoutOutcome(
      { kind: "placed", order: { reference: "C-1001", trackingPath: TRACKING_PATH, totalKurus: 1 } },
      "https://coffy.example",
      { showConfirmation: () => calls.push("confirmation"), showError: () => calls.push("error") },
      () => calls.push("clear"),
    );
    expect(calls).toEqual(["confirmation", "clear"]);
  });

  it.each<[string, CheckoutOutcome, "editing" | "unknown"]>([
    ["a 400", { kind: "rejected", message: "Sepetinizdeki bir ürün artık menüde yok. Lütfen sepetinizi güncelleyin." }, "editing"],
    ["a 409", { kind: "rejected", message: "Bu sipariş isteği daha önce farklı bir içerikle gönderildi." }, "editing"],
    ["an unknown result", { kind: "unknown", message: "Doğrulanamadı." }, "unknown"],
  ])("on %s shows the message and keeps the stored cart", (_name, outcome, phase) => {
    const showConfirmation = vi.fn();
    const showError = vi.fn();
    applyCheckoutOutcome(outcome, "https://coffy.example", { showConfirmation, showError });
    expect(showError).toHaveBeenCalledWith((outcome as { message: string }).message, phase);
    expect(showConfirmation).not.toHaveBeenCalled();
    expect(storage.getItem(CART_STORAGE_KEY)).toBe(STORED);
  });
});
