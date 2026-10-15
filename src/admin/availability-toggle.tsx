"use client";

import { useRef, useState } from "react";
import type { MenuProduct } from "../db/menu.ts";
import { type AdminOutcome, submitProductPatch } from "./admin-api.ts";
import { ADMIN_LOGIN_PATH } from "./paths.ts";

export interface AvailabilityToggleViewProps {
  productName: string;
  isAvailable: boolean;
  pending: boolean;
  message: string | null;
  onToggle: () => void;
}

export function AvailabilityToggleView({ productName, isAvailable, pending, message, onToggle }: AvailabilityToggleViewProps) {
  return (
    <div className="availability-toggle">
      <p className={isAvailable ? "admin-status" : "admin-status admin-status-closed"}>
        {isAvailable ? "Satışta" : "Kapalı"}
      </p>
      <button
        type="button"
        className="button button-secondary"
        disabled={pending}
        aria-label={`${productName}: ${isAvailable ? "satışı kapat" : "satışa aç"}`}
        onClick={onToggle}
      >
        {isAvailable ? "Satışı kapat" : "Satışa aç"}
      </button>
      {message !== null && (
        <p className="form-error" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}

export interface ToggleOutcomeHandlers {
  showProduct: (product: MenuProduct) => void;
  goToLogin: () => void;
  showError: (message: string) => void;
}

// The shown state comes from the server's answer, never from the click, so
// it always matches what is stored. A 401 (session ended, e.g. logged out in
// another tab) leaves for the login page without changing anything.
export function applyToggleOutcome(outcome: AdminOutcome<MenuProduct>, handlers: ToggleOutcomeHandlers): void {
  switch (outcome.kind) {
    case "ok":
      handlers.showProduct(outcome.value);
      return;
    case "unauthorized":
      handlers.goToLogin();
      return;
    default:
      handlers.showError(outcome.message);
  }
}

// Sends the target value, not "flip it": the request means the same thing
// whatever the stored state is by the time it arrives. The button is
// disabled while a request is pending, so two clicks cannot race.
export function AvailabilityToggle({ productId, productName, initialAvailable }: {
  productId: string;
  productName: string;
  initialAvailable: boolean;
}) {
  const [isAvailable, setIsAvailable] = useState(initialAvailable);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function toggle() {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setPending(true);
    setMessage(null);
    const outcome = await submitProductPatch(productId, { isAvailable: !isAvailable });
    const release = () => {
      inFlight.current = false;
      setPending(false);
    };
    applyToggleOutcome(outcome, {
      showProduct: (product) => {
        setIsAvailable(product.isAvailable);
        release();
      },
      // The button stays disabled while the page leaves.
      goToLogin: () => window.location.replace(ADMIN_LOGIN_PATH),
      showError: (nextMessage) => {
        setMessage(nextMessage);
        release();
      },
    });
  }

  return (
    <AvailabilityToggleView
      productName={productName}
      isAvailable={isAvailable}
      pending={pending}
      message={message}
      onToggle={() => void toggle()}
    />
  );
}
