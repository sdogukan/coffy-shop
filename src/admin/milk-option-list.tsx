"use client";

import { useRef, useState } from "react";
import type { MilkOption, MilkOptionFields, MilkOptionPatch } from "../db/milk-options.ts";
import { formatPriceKurus } from "../menu/format-price.ts";
import { type AdminOutcome, submitMilkOptionPatch, submitNewMilkOption } from "./admin-api.ts";
import { MAX_MILK_OPTION_NAME_LENGTH } from "./milk-option-input.ts";
import { ADMIN_LOGIN_PATH, ADMIN_MILK_OPTIONS_PATH } from "./paths.ts";
import type { DraftResult, ProductFormPhase } from "./product-form.tsx";
import { formatKurusForInput, parseTryToKurus, TRY_PRICE_FORMAT_MESSAGE } from "./try-price-input.ts";

// The staff page for milk options. Normal süt (the default) is shown as
// "Ücretsiz" with no input and no removal control, so nothing on the page can
// send a PATCH for it. Every other option has a surcharge editor and a
// "Satıştan kaldır" / "Satışa aç" control; both send absolute values and the
// row shows only what the server answered, never the click.

// The surcharge field is TRY text like the product price; the 0,01-10.000,00
// TL range is the server's check.
export function buildSurchargePatch(text: string): DraftResult<MilkOptionPatch> {
  const surchargeKurus = parseTryToKurus(text);
  return surchargeKurus === null
    ? { ok: false, message: TRY_PRICE_FORMAT_MESSAGE }
    : { ok: true, value: { surchargeKurus } };
}

export interface MilkOptionChangeHandlers {
  start: () => void;
  showOption: (option: MilkOption) => void;
  goToLogin: () => void;
  showError: (message: string) => void;
}

// One change to one option. A change that could not be built (an invalid
// surcharge text) shows its message and sends nothing. A lost answer is only
// reported: the request carried absolute values, so sending it again changes
// nothing more.
export async function sendMilkOptionChange(
  built: DraftResult<MilkOptionPatch>,
  send: (patch: MilkOptionPatch) => Promise<AdminOutcome<MilkOption>>,
  handlers: MilkOptionChangeHandlers,
): Promise<void> {
  if (!built.ok) {
    handlers.showError(built.message);
    return;
  }
  handlers.start();
  const outcome = await send(built.value);
  switch (outcome.kind) {
    case "ok":
      handlers.showOption(outcome.value);
      return;
    case "unauthorized":
      handlers.goToLogin();
      return;
    default:
      handlers.showError(outcome.message);
  }
}

export interface MilkOptionRowViewProps {
  option: MilkOption;
  surchargeText: string;
  pending: boolean;
  message: string | null;
  onSurchargeTextChange: (text: string) => void;
  onSaveSurcharge: () => void;
  onToggleAvailability: () => void;
}

export function MilkOptionRowView({
  option,
  surchargeText,
  pending,
  message,
  onSurchargeTextChange,
  onSaveSurcharge,
  onToggleAvailability,
}: MilkOptionRowViewProps) {
  const inputId = `milk-surcharge-${option.id}`;
  return (
    <li className="admin-milk-option">
      <div className="admin-product-info">
        <h3>{option.name}</h3>
        <p className="product-price">+{formatPriceKurus(option.surchargeKurus)}</p>
        <p className={option.isAvailable ? "admin-status" : "admin-status admin-status-closed"}>
          {option.isAvailable ? "Satışta" : "Satıştan kaldırıldı"}
        </p>
      </div>
      <form
        className="admin-milk-surcharge"
        onSubmit={(event) => {
          event.preventDefault();
          onSaveSurcharge();
        }}
      >
        <label htmlFor={inputId}>Ek ücret (TL)</label>
        <input
          id={inputId}
          name="surcharge"
          type="text"
          inputMode="decimal"
          required
          maxLength={10}
          disabled={pending}
          value={surchargeText}
          onChange={(event) => onSurchargeTextChange(event.target.value)}
        />
        <button type="submit" className="button button-secondary" disabled={pending}>
          Ek ücreti kaydet
        </button>
      </form>
      <button
        type="button"
        className="button button-secondary"
        disabled={pending}
        aria-label={`${option.name}: ${option.isAvailable ? "satıştan kaldır" : "satışa aç"}`}
        onClick={onToggleAvailability}
      >
        {option.isAvailable ? "Satıştan kaldır" : "Satışa aç"}
      </button>
      {message !== null && (
        <p className="form-error" role="alert">
          {message}
        </p>
      )}
    </li>
  );
}

// Both controls of a row are disabled while either request is pending, so two
// answers for the same option never race to set what the row shows.
function MilkOptionRow({ initialOption }: { initialOption: MilkOption }) {
  const [option, setOption] = useState(initialOption);
  const [surchargeText, setSurchargeText] = useState(() => formatKurusForInput(initialOption.surchargeKurus));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function change(built: DraftResult<MilkOptionPatch>) {
    if (inFlight.current) {
      return;
    }
    const release = () => {
      inFlight.current = false;
      setPending(false);
    };
    await sendMilkOptionChange(built, (patch) => submitMilkOptionPatch(option.id, patch), {
      start: () => {
        inFlight.current = true;
        setPending(true);
        setMessage(null);
      },
      showOption: (stored) => {
        setOption(stored);
        setSurchargeText(formatKurusForInput(stored.surchargeKurus));
        release();
      },
      // The controls stay disabled while the page leaves.
      goToLogin: () => window.location.replace(ADMIN_LOGIN_PATH),
      showError: (nextMessage) => {
        setMessage(nextMessage);
        release();
      },
    });
  }

  return (
    <MilkOptionRowView
      option={option}
      surchargeText={surchargeText}
      pending={pending}
      message={message}
      onSurchargeTextChange={setSurchargeText}
      onSaveSurcharge={() => void change(buildSurchargePatch(surchargeText))}
      onToggleAvailability={() => void change({ ok: true, value: { isAvailable: !option.isAvailable } })}
    />
  );
}

// Every option as the server read it, Normal süt first, removed ones included.
export function MilkOptionList({ options }: { options: readonly MilkOption[] }) {
  return (
    <ul className="admin-milk-option-list">
      {options.map((option) =>
        option.isDefault ? (
          <li key={option.id} className="admin-milk-option">
            <div className="admin-product-info">
              <h3>{option.name}</h3>
              <p className="product-price">Ücretsiz</p>
            </div>
          </li>
        ) : (
          <MilkOptionRow key={option.id} initialOption={option} />
        ),
      )}
    </ul>
  );
}

// What the add form holds; the surcharge stays the typed text until submit.
export interface MilkOptionDraft {
  name: string;
  surcharge: string;
}

export const EMPTY_MILK_OPTION_DRAFT: MilkOptionDraft = { name: "", surcharge: "" };

// The body of POST /api/admin/milk-options. Name bounds are the server's check.
export function buildNewMilkOption(draft: MilkOptionDraft): DraftResult<MilkOptionFields> {
  const surchargeKurus = parseTryToKurus(draft.surcharge);
  if (surchargeKurus === null) {
    return { ok: false, message: TRY_PRICE_FORMAT_MESSAGE };
  }
  return { ok: true, value: { name: draft.name.trim(), surchargeKurus } };
}

export interface CreateOutcomeHandlers {
  reloadList: () => void;
  goToLogin: () => void;
  showError: (message: string, phase: "editing" | "unknown") => void;
}

// A created option shows up through a fresh server read of the list. A create
// whose answer was lost locks the form: a resend could add the option twice.
export function applyMilkOptionCreateOutcome(outcome: AdminOutcome<MilkOption>, handlers: CreateOutcomeHandlers): void {
  switch (outcome.kind) {
    case "ok":
      handlers.reloadList();
      return;
    case "unauthorized":
      handlers.goToLogin();
      return;
    case "failed":
      handlers.showError(outcome.message, "editing");
      return;
    case "unknown":
      handlers.showError(outcome.message, "unknown");
  }
}

export interface MilkOptionCreateFormViewProps {
  draft: MilkOptionDraft;
  phase: ProductFormPhase;
  message: string | null;
  onChange: (draft: MilkOptionDraft) => void;
  onSubmit: () => void;
}

export function MilkOptionCreateFormView({ draft, phase, message, onChange, onSubmit }: MilkOptionCreateFormViewProps) {
  return (
    <form
      className="admin-form"
      aria-labelledby="milk-option-new-title"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <h2 id="milk-option-new-title">Yeni süt seçeneği</h2>
      <fieldset disabled={phase !== "editing"}>
        <label htmlFor="milk-option-name">Süt seçeneği adı</label>
        <input
          id="milk-option-name"
          name="name"
          type="text"
          required
          maxLength={MAX_MILK_OPTION_NAME_LENGTH}
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
        <label htmlFor="milk-option-surcharge">Ek ücret (TL)</label>
        <input
          id="milk-option-surcharge"
          name="surcharge"
          type="text"
          inputMode="decimal"
          required
          maxLength={10}
          placeholder="25,50"
          aria-describedby="milk-option-surcharge-hint"
          value={draft.surcharge}
          onChange={(event) => onChange({ ...draft, surcharge: event.target.value })}
        />
        <p id="milk-option-surcharge-hint" className="form-hint">
          Kuruşu virgülle ayırın, örneğin 25,50.
        </p>
      </fieldset>
      {message !== null && (
        <p className="form-error" role="alert">
          {message}
        </p>
      )}
      {phase === "unknown" ? (
        // A full page load, not a client navigation to the same route, so the
        // list is read again and this form starts over unlocked.
        <a href={ADMIN_MILK_OPTIONS_PATH} className="button">
          Listeyi yenile
        </a>
      ) : (
        <button type="submit" className="button" disabled={phase === "sending"}>
          {phase === "sending" ? "Kaydediliyor…" : "Süt seçeneğini ekle"}
        </button>
      )}
    </form>
  );
}

// The submit button is disabled while a request is in flight and nothing is
// resent automatically: a create has no idempotency key.
export function MilkOptionCreateForm() {
  const [draft, setDraft] = useState<MilkOptionDraft>(EMPTY_MILK_OPTION_DRAFT);
  const [phase, setPhase] = useState<ProductFormPhase>("editing");
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function submit() {
    if (inFlight.current) {
      return;
    }
    const built = buildNewMilkOption(draft);
    if (!built.ok) {
      setMessage(built.message);
      return;
    }
    inFlight.current = true;
    setPhase("sending");
    setMessage(null);
    applyMilkOptionCreateOutcome(await submitNewMilkOption(built.value), {
      // The form stays locked while the page reloads with the new option.
      reloadList: () => window.location.reload(),
      goToLogin: () => window.location.replace(ADMIN_LOGIN_PATH),
      showError: (nextMessage, nextPhase) => {
        setMessage(nextMessage);
        setPhase(nextPhase);
        inFlight.current = nextPhase === "unknown";
      },
    });
  }

  return (
    <MilkOptionCreateFormView
      draft={draft}
      phase={phase}
      message={message}
      onChange={setDraft}
      onSubmit={() => void submit()}
    />
  );
}
