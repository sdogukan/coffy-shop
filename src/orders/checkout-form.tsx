"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { type Cart, cartTotalKurus, type ResolvedCartLine, resolveCart } from "../cart/cart.ts";
import { clearCart, getCartSnapshot, getServerCartSnapshot, subscribeCart } from "../cart/cart-store.ts";
import type { MenuCategory } from "../db/menu.ts";
import { formatPriceKurus } from "../menu/format-price.ts";
import {
  type CheckoutOutcome,
  type CheckoutSubmitter,
  createCheckoutSubmitter,
  type PlacedOrderResponse,
  trackingUrl,
} from "./checkout-submission.ts";
import { MAX_CUSTOMER_NAME_LENGTH, MAX_NOTE_LENGTH } from "./order-request.ts";

// editing: the form can be changed and submitted. sending: a request is in
// flight. unknown: the last result is unknown; the form stays locked and the
// button resends the captured request.
export type CheckoutPhase = "editing" | "sending" | "unknown";

export interface OrderConfirmationDetails {
  order: PlacedOrderResponse;
  trackingUrl: string;
}

const SUBMIT_LABELS: Record<CheckoutPhase, string> = {
  editing: "Siparişi ver",
  sending: "Gönderiliyor…",
  unknown: "Tekrar dene",
};

export function CheckoutSummary({ lines }: { lines: readonly ResolvedCartLine[] }) {
  return (
    <section className="checkout-summary" aria-labelledby="checkout-summary-title">
      <h2 id="checkout-summary-title">Sepetiniz</h2>
      <ul className="checkout-lines">
        {lines.map((line) => (
          <li key={line.productId} className={line.status === "ok" ? "checkout-line" : "checkout-line cart-line-flagged"}>
            <span>
              {line.status === "missing" ? `Ürün bulunamadı (kod: ${line.productId})` : line.product.name} ×{" "}
              {line.quantity}
            </span>
            {line.status === "ok" ? (
              <span>{formatPriceKurus(line.lineTotalKurus)}</span>
            ) : (
              <span className="cart-line-flag">{line.status === "missing" ? "Menüde yok" : "Satışta değil"}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="cart-total">Toplam: {formatPriceKurus(cartTotalKurus(lines))}</p>
      <p className="cart-note">Fiyatlar bilgi amaçlıdır; sipariş sırasında güncel fiyatlar esas alınır.</p>
      <Link href="/sepet">Sepeti düzenle</Link>
    </section>
  );
}

export interface CheckoutFormViewProps {
  lines: readonly ResolvedCartLine[];
  customerName: string;
  note: string;
  phase: CheckoutPhase;
  message: string | null;
  onCustomerNameChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onSubmit: () => void;
}

// Presentational checkout: takes resolved lines and the form state, owns none.
export function CheckoutFormView({
  lines,
  customerName,
  note,
  phase,
  message,
  onCustomerNameChange,
  onNoteChange,
  onSubmit,
}: CheckoutFormViewProps) {
  if (lines.length === 0) {
    return (
      <div className="cart-empty">
        <p>Sepetiniz boş.</p>
        <Link href="/">Menüye dön</Link>
      </div>
    );
  }
  return (
    <>
      <CheckoutSummary lines={lines} />
      <form
        className="checkout-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <fieldset disabled={phase !== "editing"}>
          <label htmlFor="checkout-customer-name">Adınız</label>
          <input
            id="checkout-customer-name"
            name="customerName"
            type="text"
            autoComplete="name"
            required
            maxLength={MAX_CUSTOMER_NAME_LENGTH}
            value={customerName}
            onChange={(event) => onCustomerNameChange(event.target.value)}
          />
          <label htmlFor="checkout-note">Sipariş notu</label>
          <textarea
            id="checkout-note"
            name="note"
            rows={3}
            maxLength={MAX_NOTE_LENGTH}
            aria-describedby="checkout-note-hint"
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
          />
          <p id="checkout-note-hint" className="form-hint">
            İsteğe bağlı, en fazla {MAX_NOTE_LENGTH} karakter.
          </p>
        </fieldset>
        {message !== null && (
          <p className="form-error" role="alert">
            {message}
          </p>
        )}
        <button type="submit" className="button" disabled={phase === "sending"}>
          {SUBMIT_LABELS[phase]}
        </button>
      </form>
    </>
  );
}

// Clipboard access needs a secure context and permission; without it the
// link text stays on screen for the customer to select.
export async function copyText(
  text: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined = globalThis.navigator?.clipboard,
): Promise<boolean> {
  if (clipboard === undefined) {
    return false;
  }
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const COPY_MESSAGES = {
  idle: "",
  copied: "Bağlantı kopyalandı.",
  failed: "Bağlantı kopyalanamadı; yukarıdaki bağlantıyı seçip kopyalayabilirsiniz.",
} as const;

export function OrderConfirmation({ details }: { details: OrderConfirmationDetails }) {
  const [copyState, setCopyState] = useState<keyof typeof COPY_MESSAGES>("idle");
  return (
    <section className="order-confirmation">
      <h2>Siparişiniz alındı</h2>
      <p>
        Sipariş numaranız: <strong>{details.order.reference}</strong>
      </p>
      <p>Toplam: {formatPriceKurus(details.order.totalKurus)}</p>
      <p>Mağazadan teslim alınacaktır.</p>
      <p>Siparişinizin durumunu bu bağlantıdan takip edebilirsiniz:</p>
      <p className="tracking-link">
        <a href={details.trackingUrl}>{details.trackingUrl}</a>
      </p>
      <button
        type="button"
        className="button"
        onClick={async () => setCopyState((await copyText(details.trackingUrl)) ? "copied" : "failed")}
      >
        Bağlantıyı kopyala
      </button>
      <p className="copy-status" role="status">
        {COPY_MESSAGES[copyState]}
      </p>
    </section>
  );
}

export interface CheckoutOutcomeHandlers {
  showConfirmation: (details: OrderConfirmationDetails) => void;
  // editing: the order was rejected and can be changed. unknown: the form
  // stays locked for a retry of the same request.
  showError: (message: string, phase: "editing" | "unknown") => void;
}

// Only a 201 empties the cart, and only after the confirmation is committed.
// Otherwise the cart subscription renders the empty-cart state first and the
// confirmation never shows.
export function applyCheckoutOutcome(
  outcome: CheckoutOutcome,
  origin: string,
  handlers: CheckoutOutcomeHandlers,
  clear: () => unknown = clearCart,
): void {
  if (outcome.kind === "placed") {
    const details = { order: outcome.order, trackingUrl: trackingUrl(origin, outcome.order.trackingPath) };
    flushSync(() => handlers.showConfirmation(details));
    clear();
    return;
  }
  handlers.showError(outcome.message, outcome.kind === "rejected" ? "editing" : "unknown");
}

// Reads the browser cart, matches it to the menu the server just read and
// places the order.
export function CheckoutForm({ menu }: { menu: readonly MenuCategory[] }) {
  const cart = useSyncExternalStore(subscribeCart, getCartSnapshot, getServerCartSnapshot);
  const [customerName, setCustomerName] = useState("");
  const [note, setNote] = useState("");
  const [phase, setPhase] = useState<CheckoutPhase>("editing");
  const [message, setMessage] = useState<string | null>(null);
  // The cart of the request in flight or awaiting a retry; shown instead of
  // the live cart so the summary matches what is sent.
  const [pendingCart, setPendingCart] = useState<Cart | null>(null);
  const [confirmation, setConfirmation] = useState<OrderConfirmationDetails | null>(null);
  const submitter = useRef<CheckoutSubmitter | null>(null);

  if (confirmation !== null) {
    return <OrderConfirmation details={confirmation} />;
  }
  if (cart === null) {
    return <p aria-busy="true">Sepet yükleniyor…</p>;
  }

  async function submit(currentCart: Cart) {
    submitter.current ??= createCheckoutSubmitter();
    const attempt = submitter.current.submit({ customerName, note, cart: currentCart });
    if (attempt === null) {
      return;
    }
    setPhase("sending");
    setMessage(null);
    setPendingCart(attempt.draft.cart);
    const outcome = await attempt.outcome;
    applyCheckoutOutcome(outcome, window.location.origin, {
      showConfirmation: setConfirmation,
      showError: (nextMessage, nextPhase) => {
        setMessage(nextMessage);
        setPhase(nextPhase);
        if (nextPhase === "editing") {
          setPendingCart(null);
        }
      },
    });
  }

  return (
    <CheckoutFormView
      lines={resolveCart(pendingCart ?? cart, menu)}
      customerName={customerName}
      note={note}
      phase={phase}
      message={message}
      onCustomerNameChange={setCustomerName}
      onNoteChange={setNote}
      onSubmit={() => void submit(cart)}
    />
  );
}
