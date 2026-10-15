"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { ProductFields, ProductPatch } from "../db/admin-products.ts";
import type { MenuProduct } from "../db/menu.ts";
import { type AdminOutcome, submitNewProduct, submitProductPatch } from "./admin-api.ts";
import { ADMIN_LOGIN_PATH, ADMIN_PRODUCTS_PATH } from "./paths.ts";
import { MAX_PRODUCT_DESCRIPTION_LENGTH, MAX_PRODUCT_NAME_LENGTH } from "./product-input.ts";
import { formatKurusForInput, parseTryToKurus, TRY_PRICE_FORMAT_MESSAGE } from "./try-price-input.ts";

export interface CategoryOption {
  id: string;
  name: string;
}

// What the form fields hold; the price stays the typed text until submit.
export interface ProductDraft {
  categoryId: string;
  name: string;
  description: string;
  price: string;
  isAvailable: boolean;
}

// editing: the form can be changed and sent. sending: a request is in
// flight. unknown: a create got no readable answer; the form stays locked
// so the same product is not sent twice.
export type ProductFormPhase = "editing" | "sending" | "unknown";

export type DraftResult<T> = { ok: true; value: T } | { ok: false; message: string };

const NO_CHANGES_MESSAGE = "Kaydedilecek bir değişiklik yok.";

export function draftFromProduct(product: MenuProduct): ProductDraft {
  return {
    categoryId: product.categoryId,
    name: product.name,
    description: product.description,
    price: formatKurusForInput(product.priceKurus),
    isAvailable: product.isAvailable,
  };
}

export function emptyDraft(categories: readonly CategoryOption[]): ProductDraft {
  return { categoryId: categories[0]?.id ?? "", name: "", description: "", price: "", isAvailable: true };
}

// The body of POST /api/admin/products: priceKurus is an integer. Name and
// description bounds are the server's check.
export function buildNewProduct(draft: ProductDraft): DraftResult<ProductFields> {
  const priceKurus = parseTryToKurus(draft.price);
  if (priceKurus === null) {
    return { ok: false, message: TRY_PRICE_FORMAT_MESSAGE };
  }
  return {
    ok: true,
    value: {
      categoryId: draft.categoryId,
      name: draft.name.trim(),
      description: draft.description.trim(),
      priceKurus,
      isAvailable: draft.isAvailable,
    },
  };
}

// The body of PATCH /api/admin/products/<id>: only the fields that differ
// from what the page showed, so an edit never overwrites a field another tab
// changed in the meantime (the toggle on the list, for example).
export function buildProductPatch(initial: MenuProduct, draft: ProductDraft): DraftResult<ProductPatch> {
  const fields = buildNewProduct(draft);
  if (!fields.ok) {
    return fields;
  }
  const patch: ProductPatch = {};
  const next = fields.value;
  if (next.categoryId !== initial.categoryId) {
    patch.categoryId = next.categoryId;
  }
  if (next.name !== initial.name) {
    patch.name = next.name;
  }
  if (next.description !== initial.description) {
    patch.description = next.description;
  }
  if (next.priceKurus !== initial.priceKurus) {
    patch.priceKurus = next.priceKurus;
  }
  if (next.isAvailable !== initial.isAvailable) {
    patch.isAvailable = next.isAvailable;
  }
  return Object.keys(patch).length === 0 ? { ok: false, message: NO_CHANGES_MESSAGE } : { ok: true, value: patch };
}

export interface SaveOutcomeHandlers {
  goToList: () => void;
  goToLogin: () => void;
  showError: (message: string, phase: "editing" | "unknown") => void;
}

// A create whose answer was lost locks the form (a resend could add the
// product twice). A lost edit does not: it sends absolute values, so sending
// it again changes nothing more.
export function applySaveOutcome(
  outcome: AdminOutcome<MenuProduct>,
  mode: "create" | "edit",
  handlers: SaveOutcomeHandlers,
): void {
  switch (outcome.kind) {
    case "ok":
      handlers.goToList();
      return;
    case "unauthorized":
      handlers.goToLogin();
      return;
    case "failed":
      handlers.showError(outcome.message, "editing");
      return;
    case "unknown":
      handlers.showError(outcome.message, mode === "create" ? "unknown" : "editing");
  }
}

export interface ProductFormViewProps {
  categories: readonly CategoryOption[];
  draft: ProductDraft;
  phase: ProductFormPhase;
  message: string | null;
  submitLabel: string;
  onChange: (draft: ProductDraft) => void;
  onSubmit: () => void;
}

export function ProductFormView({ categories, draft, phase, message, submitLabel, onChange, onSubmit }: ProductFormViewProps) {
  return (
    <form
      className="admin-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <fieldset disabled={phase !== "editing"}>
        <label htmlFor="product-category">Kategori</label>
        <select
          id="product-category"
          name="categoryId"
          required
          value={draft.categoryId}
          onChange={(event) => onChange({ ...draft, categoryId: event.target.value })}
        >
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <label htmlFor="product-name">Ürün adı</label>
        <input
          id="product-name"
          name="name"
          type="text"
          required
          maxLength={MAX_PRODUCT_NAME_LENGTH}
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
        <label htmlFor="product-description">Açıklama</label>
        <textarea
          id="product-description"
          name="description"
          rows={3}
          maxLength={MAX_PRODUCT_DESCRIPTION_LENGTH}
          value={draft.description}
          onChange={(event) => onChange({ ...draft, description: event.target.value })}
        />
        <label htmlFor="product-price">Fiyat (TL)</label>
        <input
          id="product-price"
          name="price"
          type="text"
          inputMode="decimal"
          required
          maxLength={10}
          placeholder="135,50"
          aria-describedby="product-price-hint"
          value={draft.price}
          onChange={(event) => onChange({ ...draft, price: event.target.value })}
        />
        <p id="product-price-hint" className="form-hint">
          Kuruşu virgülle ayırın, örneğin 135,50.
        </p>
        <label className="admin-checkbox">
          <input
            name="isAvailable"
            type="checkbox"
            checked={draft.isAvailable}
            onChange={(event) => onChange({ ...draft, isAvailable: event.target.checked })}
          />
          Satışta
        </label>
      </fieldset>
      {message !== null && (
        <p className="form-error" role="alert">
          {message}
        </p>
      )}
      {phase === "unknown" ? (
        <Link href={ADMIN_PRODUCTS_PATH} className="button">
          Ürün listesine dön
        </Link>
      ) : (
        <button type="submit" className="button" disabled={phase === "sending"}>
          {phase === "sending" ? "Kaydediliyor…" : submitLabel}
        </button>
      )}
    </form>
  );
}

// Without a product it creates one; with a product it edits that one. The
// submit button is disabled while a request is in flight and nothing is
// resent automatically: a create has no idempotency key.
export function ProductForm({ categories, product }: { categories: readonly CategoryOption[]; product?: MenuProduct }) {
  const [draft, setDraft] = useState<ProductDraft>(() =>
    product === undefined ? emptyDraft(categories) : draftFromProduct(product),
  );
  const [phase, setPhase] = useState<ProductFormPhase>("editing");
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function submit() {
    if (inFlight.current) {
      return;
    }
    let send: () => Promise<AdminOutcome<MenuProduct>>;
    if (product === undefined) {
      const built = buildNewProduct(draft);
      if (!built.ok) {
        setMessage(built.message);
        return;
      }
      send = () => submitNewProduct(built.value);
    } else {
      const built = buildProductPatch(product, draft);
      if (!built.ok) {
        setMessage(built.message);
        return;
      }
      send = () => submitProductPatch(product.id, built.value);
    }
    inFlight.current = true;
    setPhase("sending");
    setMessage(null);
    applySaveOutcome(await send(), product === undefined ? "create" : "edit", {
      goToList: () => window.location.assign(ADMIN_PRODUCTS_PATH),
      goToLogin: () => window.location.replace(ADMIN_LOGIN_PATH),
      showError: (nextMessage, nextPhase) => {
        setMessage(nextMessage);
        setPhase(nextPhase);
        inFlight.current = nextPhase === "unknown";
      },
    });
  }

  return (
    <ProductFormView
      categories={categories}
      draft={draft}
      phase={phase}
      message={message}
      submitLabel={product === undefined ? "Ürünü ekle" : "Değişiklikleri kaydet"}
      onChange={setDraft}
      onSubmit={() => void submit()}
    />
  );
}
