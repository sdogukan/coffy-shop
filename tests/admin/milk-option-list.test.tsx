import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AdminOutcome } from "../../src/admin/admin-api.ts";
import { MILK_OPTION_INPUT_ERRORS } from "../../src/admin/milk-option-input.ts";
import {
  applyMilkOptionCreateOutcome,
  buildNewMilkOption,
  buildSurchargePatch,
  EMPTY_MILK_OPTION_DRAFT,
  MilkOptionCreateFormView,
  type MilkOptionCreateFormViewProps,
  type MilkOptionDraft,
  MilkOptionList,
  MilkOptionRowView,
  type MilkOptionRowViewProps,
  sendMilkOptionChange,
} from "../../src/admin/milk-option-list.tsx";
import { ADMIN_ERRORS } from "../../src/admin/http.ts";
import { TRY_PRICE_FORMAT_MESSAGE } from "../../src/admin/try-price-input.ts";
import type { MilkOption, MilkOptionPatch } from "../../src/db/milk-options.ts";

const noop = () => {};

const NORMAL_MILK: MilkOption = { id: "normal-sut", name: "Normal süt", surchargeKurus: 0, isDefault: true, isAvailable: true };
const OAT: MilkOption = { id: "yulaf", name: "Yulaf sütü", surchargeKurus: 2550, isDefault: false, isAvailable: true };
const ALMOND: MilkOption = { id: "badem", name: "Badem sütü", surchargeKurus: 2000, isDefault: false, isAvailable: false };

function findElement(
  node: unknown,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | undefined {
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

function changeHandlers() {
  return { start: vi.fn(), showOption: vi.fn(), goToLogin: vi.fn(), showError: vi.fn() };
}

function answer(outcome: AdminOutcome<MilkOption>) {
  return vi.fn<(patch: MilkOptionPatch) => Promise<AdminOutcome<MilkOption>>>(async () => outcome);
}

describe("milk option list", () => {
  it("shows Normal süt as Ücretsiz with no input, no form and no removal control", () => {
    const html = renderToStaticMarkup(<MilkOptionList options={[NORMAL_MILK, OAT]} />);
    const normal = html.slice(html.indexOf("<h3>Normal süt</h3>"), html.indexOf("</li>"));
    expect(normal).toContain('<p class="product-price">Ücretsiz</p>');
    for (const forbidden of ["<input", "<form", "<button", "Satıştan kaldır", "Satışa aç"]) {
      expect(normal).not.toContain(forbidden);
    }
    expect(html.match(/<li class="admin-milk-option">/g)).toHaveLength(2);
  });

  it("shows every other option with its surcharge as TRY text, its state and the opposite availability action", () => {
    const html = renderToStaticMarkup(<MilkOptionList options={[NORMAL_MILK, OAT, ALMOND]} />);
    const oat = html.slice(html.indexOf("<h3>Yulaf sütü</h3>"), html.indexOf("<h3>Badem sütü</h3>"));
    expect(oat).toContain('<p class="product-price">+₺25,50</p>');
    expect(oat).toContain('<p class="admin-status">Satışta</p>');
    expect(oat).toContain('<label for="milk-surcharge-yulaf">Ek ücret (TL)</label>');
    expect(oat).toMatch(/<input id="milk-surcharge-yulaf" type="text" inputMode="decimal"[^>]*name="surcharge" value="25,50"\/>/);
    expect(oat).toContain('aria-label="Yulaf sütü: satıştan kaldır">Satıştan kaldır</button>');

    const almond = html.slice(html.indexOf("<h3>Badem sütü</h3>"));
    expect(almond).toContain('<p class="admin-status admin-status-closed">Satıştan kaldırıldı</p>');
    expect(almond).toContain('aria-label="Badem sütü: satışa aç">Satışa aç</button>');
  });
});

describe("milk option row", () => {
  function viewProps(overrides: Partial<MilkOptionRowViewProps> = {}): MilkOptionRowViewProps {
    return {
      option: OAT,
      surchargeText: "25,50",
      pending: false,
      message: null,
      onSurchargeTextChange: noop,
      onSaveSurcharge: noop,
      onToggleAvailability: noop,
      ...overrides,
    };
  }

  it("disables the input and both buttons while a request is pending and shows an error as an alert", () => {
    const html = renderToStaticMarkup(<MilkOptionRowView {...viewProps({ pending: true, message: "Hata" })} />);
    expect(html).toMatch(/<input id="milk-surcharge-yulaf"[^>]*disabled=""/);
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(2);
    expect(html).toContain('<p class="form-error" role="alert">Hata</p>');

    const idle = renderToStaticMarkup(<MilkOptionRowView {...viewProps()} />);
    expect(idle).not.toContain("disabled");
    expect(idle).not.toContain('role="alert"');
  });

  it("wires the typed text, the surcharge submit and the availability button to their callbacks", () => {
    const onSurchargeTextChange = vi.fn();
    const onSaveSurcharge = vi.fn();
    const onToggleAvailability = vi.fn();
    const tree = MilkOptionRowView(viewProps({ onSurchargeTextChange, onSaveSurcharge, onToggleAvailability }));

    const input = findElement(tree, (element) => element.props.name === "surcharge");
    (input?.props.onChange as (event: unknown) => void)({ target: { value: "30" } });
    expect(onSurchargeTextChange).toHaveBeenCalledWith("30");

    const preventDefault = vi.fn();
    const form = findElement(tree, (element) => element.type === "form");
    (form?.props.onSubmit as (event: unknown) => void)({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onSaveSurcharge).toHaveBeenCalledOnce();

    const toggle = findElement(tree, (element) => element.type === "button" && element.props.type === "button");
    (toggle?.props.onClick as () => void)();
    expect(onToggleAvailability).toHaveBeenCalledOnce();
  });

  it("turns 25,50 into surchargeKurus 2550 and refuses text that is not TRY", () => {
    expect(buildSurchargePatch("25,50")).toEqual({ ok: true, value: { surchargeKurus: 2550 } });
    expect(buildSurchargePatch(" 7 ")).toEqual({ ok: true, value: { surchargeKurus: 700 } });
    for (const text of ["", "abc", "25.50", "1.000,00", "-5", "25,505", "₺25"]) {
      expect(buildSurchargePatch(text), text).toEqual({ ok: false, message: TRY_PRICE_FORMAT_MESSAGE });
    }
  });

  it("sends surchargeKurus 2550 for 25,50 and shows the option the server stored", async () => {
    const stored = { ...OAT, surchargeKurus: 2550 };
    const send = answer({ kind: "ok", value: stored });
    const handlers = changeHandlers();
    await sendMilkOptionChange(buildSurchargePatch("25,50"), send, handlers);
    expect(send).toHaveBeenCalledExactlyOnceWith({ surchargeKurus: 2550 });
    expect(handlers.start).toHaveBeenCalledOnce();
    expect(handlers.showOption).toHaveBeenCalledWith(stored);
    expect(handlers.showError).not.toHaveBeenCalled();
  });

  it("shows the TRY format message for an invalid surcharge without sending a request", async () => {
    const send = answer({ kind: "ok", value: OAT });
    const handlers = changeHandlers();
    await sendMilkOptionChange(buildSurchargePatch("yirmi beş"), send, handlers);
    expect(send).not.toHaveBeenCalled();
    expect(handlers.start).not.toHaveBeenCalled();
    expect(handlers.showError).toHaveBeenCalledWith(TRY_PRICE_FORMAT_MESSAGE);
  });

  it("shows the server's Turkish message from a 400 as an alert and leaves the shown option alone", async () => {
    const handlers = changeHandlers();
    await sendMilkOptionChange(
      buildSurchargePatch("20000"),
      answer({ kind: "failed", message: MILK_OPTION_INPUT_ERRORS.invalid_surcharge }),
      handlers,
    );
    expect(handlers.showError).toHaveBeenCalledWith(MILK_OPTION_INPUT_ERRORS.invalid_surcharge);
    expect(handlers.showOption).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(<MilkOptionRowView {...viewProps({ message: MILK_OPTION_INPUT_ERRORS.invalid_surcharge })} />)).toContain(
      `<p class="form-error" role="alert">${MILK_OPTION_INPUT_ERRORS.invalid_surcharge}</p>`,
    );
  });

  it("sends isAvailable false for Satıştan kaldır and then shows the removed state the server answered", async () => {
    const removed = { ...OAT, isAvailable: false };
    const send = answer({ kind: "ok", value: removed });
    const handlers = changeHandlers();
    await sendMilkOptionChange({ ok: true, value: { isAvailable: false } }, send, handlers);
    expect(send).toHaveBeenCalledExactlyOnceWith({ isAvailable: false });
    expect(handlers.showOption).toHaveBeenCalledWith(removed);

    const html = renderToStaticMarkup(<MilkOptionRowView {...viewProps({ option: removed })} />);
    expect(html).toContain('<p class="admin-status admin-status-closed">Satıştan kaldırıldı</p>');
    expect(html).toContain(">Satışa aç</button>");
  });

  it("goes to the login page on 401 and reports a lost answer without resending", async () => {
    const unauthorized = changeHandlers();
    await sendMilkOptionChange(
      { ok: true, value: { isAvailable: false } },
      answer({ kind: "unauthorized", message: ADMIN_ERRORS.unauthorized }),
      unauthorized,
    );
    expect(unauthorized.goToLogin).toHaveBeenCalledOnce();
    expect(unauthorized.showOption).not.toHaveBeenCalled();
    expect(unauthorized.showError).not.toHaveBeenCalled();

    const lost = changeHandlers();
    const send = answer({ kind: "unknown", message: "Sunucuya ulaşılamadı." });
    await sendMilkOptionChange({ ok: true, value: { isAvailable: false } }, send, lost);
    expect(send).toHaveBeenCalledOnce();
    expect(lost.showError).toHaveBeenCalledWith("Sunucuya ulaşılamadı.");
    expect(lost.showOption).not.toHaveBeenCalled();
  });
});

describe("milk option add form", () => {
  function viewProps(overrides: Partial<MilkOptionCreateFormViewProps> = {}): MilkOptionCreateFormViewProps {
    return { draft: EMPTY_MILK_OPTION_DRAFT, phase: "editing", message: null, onChange: noop, onSubmit: noop, ...overrides };
  }

  it("has a name and a surcharge field and a submit button, and no error before a submit", () => {
    const html = renderToStaticMarkup(<MilkOptionCreateFormView {...viewProps()} />);
    expect(html).toContain('<h2 id="milk-option-new-title">Yeni süt seçeneği</h2>');
    expect(html).toMatch(/<input id="milk-option-name" type="text" required="" maxLength="60" name="name" value=""\/>/);
    expect(html).toMatch(/<input id="milk-option-surcharge" type="text" inputMode="decimal"[^>]*name="surcharge" value=""\/>/);
    expect(html).toContain('<button type="submit" class="button">Süt seçeneğini ekle</button>');
    expect(html).not.toContain('role="alert"');
  });

  it("reports every field change as a new draft and submits without a page post", () => {
    const onChange = vi.fn<(draft: MilkOptionDraft) => void>();
    const onSubmit = vi.fn();
    const tree = MilkOptionCreateFormView(viewProps({ onChange, onSubmit }));
    const name = findElement(tree, (element) => element.props.id === "milk-option-name");
    (name?.props.onChange as (event: unknown) => void)({ target: { value: "Yulaf sütü" } });
    const surcharge = findElement(tree, (element) => element.props.id === "milk-option-surcharge");
    (surcharge?.props.onChange as (event: unknown) => void)({ target: { value: "15" } });
    expect(onChange.mock.calls.map(([draft]) => draft)).toEqual([
      { name: "Yulaf sütü", surcharge: "" },
      { name: "", surcharge: "15" },
    ]);
    const preventDefault = vi.fn();
    (findElement(tree, (element) => element.type === "form")?.props.onSubmit as (event: unknown) => void)({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("builds {name, surchargeKurus} with a trimmed name and refuses a surcharge that is not TRY", () => {
    expect(buildNewMilkOption({ name: "  Yulaf sütü ", surcharge: "25,5" })).toEqual({
      ok: true,
      value: { name: "Yulaf sütü", surchargeKurus: 2550 },
    });
    expect(buildNewMilkOption({ name: "Yulaf sütü", surcharge: "25.50" })).toEqual({
      ok: false,
      message: TRY_PRICE_FORMAT_MESSAGE,
    });
  });

  it("reloads the list after a create so the new option shows up, and goes to login on 401", () => {
    const ok = { reloadList: vi.fn(), goToLogin: vi.fn(), showError: vi.fn() };
    applyMilkOptionCreateOutcome({ kind: "ok", value: OAT }, ok);
    expect(ok.reloadList).toHaveBeenCalledOnce();
    expect(ok.showError).not.toHaveBeenCalled();

    const unauthorized = { reloadList: vi.fn(), goToLogin: vi.fn(), showError: vi.fn() };
    applyMilkOptionCreateOutcome({ kind: "unauthorized", message: "Oturum yok" }, unauthorized);
    expect(unauthorized.goToLogin).toHaveBeenCalledOnce();
    expect(unauthorized.reloadList).not.toHaveBeenCalled();
  });

  it.each([
    ["failed", "editing"],
    ["unknown", "unknown"],
  ] as const)("after a %s create the form is %s", (kind, phase) => {
    const handlers = { reloadList: vi.fn(), goToLogin: vi.fn(), showError: vi.fn() };
    applyMilkOptionCreateOutcome({ kind, message: "Mesaj" }, handlers);
    expect(handlers.showError).toHaveBeenCalledWith("Mesaj", phase);
    expect(handlers.reloadList).not.toHaveBeenCalled();
  });

  it("disables the submit button while sending and, after a lost create, stays locked and offers only a full reload", () => {
    const sending = renderToStaticMarkup(<MilkOptionCreateFormView {...viewProps({ phase: "sending" })} />);
    expect(sending).toContain('<fieldset disabled="">');
    expect(sending).toContain('<button type="submit" class="button" disabled="">Kaydediliyor…</button>');

    const unknown = renderToStaticMarkup(<MilkOptionCreateFormView {...viewProps({ phase: "unknown", message: "Doğrulanamadı" })} />);
    expect(unknown).toContain('<fieldset disabled="">');
    expect(unknown).not.toContain('type="submit"');
    expect(unknown).toContain('<a href="/yonetim/sut-secenekleri" class="button">Listeyi yenile</a>');
    expect(unknown).toContain('<p class="form-error" role="alert">Doğrulanamadı</p>');
  });
});
