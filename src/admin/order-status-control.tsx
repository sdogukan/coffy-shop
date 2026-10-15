"use client";

import { useRef, useState } from "react";
import type { AdminOrderDetails } from "../db/admin-orders.ts";
import { nextOrderStatus, ORDER_STATUS_LABELS, type OrderStatus } from "../orders/order-status.ts";
import { type AdminOutcome, submitOrderStatus } from "./admin-api.ts";
import { ADMIN_LOGIN_PATH } from "./paths.ts";

// A lost answer may hide an applied change: a resend of the same target would
// come back 409 and read as a failure, so the admin is sent to check first.
export const ORDER_STATUS_UNKNOWN_MESSAGE =
  "Durum değişikliğinin kaydedilip kaydedilmediği doğrulanamadı. Tekrar denemeden önce sayfayı yenileyip güncel durumu kontrol edin.";

export interface OrderStatusControlViewProps {
  status: OrderStatus;
  pending: boolean;
  message: string | null;
  onAdvance: () => void;
}

// The stored status and the one button the transition rules allow from it;
// a completed order has none.
export function OrderStatusControlView({ status, pending, message, onAdvance }: OrderStatusControlViewProps) {
  const next = nextOrderStatus(status);
  return (
    <div className="order-status-control">
      <p className="order-status">Durum: {ORDER_STATUS_LABELS[status]}</p>
      {next !== null && (
        <button type="button" className="button" disabled={pending} onClick={onAdvance}>
          {`${ORDER_STATUS_LABELS[next]} olarak işaretle`}
        </button>
      )}
      {message !== null && (
        <p className="form-error" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}

export interface StatusOutcomeHandlers {
  showStatus: (status: OrderStatus) => void;
  goToLogin: () => void;
  showError: (message: string) => void;
}

// Only a 200 changes the shown status, and only to the status the server
// stored. A 409 (another tab or staff member moved the order first) and every
// other refusal show the server's message and leave the shown status alone.
export function applyStatusOutcome(outcome: AdminOutcome<AdminOrderDetails>, handlers: StatusOutcomeHandlers): void {
  switch (outcome.kind) {
    case "ok":
      handlers.showStatus(outcome.value.status);
      return;
    case "unauthorized":
      handlers.goToLogin();
      return;
    case "failed":
      handlers.showError(outcome.message);
      return;
    case "unknown":
      handlers.showError(ORDER_STATUS_UNKNOWN_MESSAGE);
  }
}

// Sends the target status, not "advance": the request means the same thing
// whatever the stored status is by the time it arrives. The button is
// disabled while a request is pending, so two clicks cannot send two PATCHes.
export function OrderStatusControl({ orderId, initialStatus }: { orderId: number; initialStatus: OrderStatus }) {
  const [status, setStatus] = useState(initialStatus);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function advance() {
    const to = nextOrderStatus(status);
    if (inFlight.current || to === null) {
      return;
    }
    inFlight.current = true;
    setPending(true);
    setMessage(null);
    const outcome = await submitOrderStatus(orderId, to);
    const release = () => {
      inFlight.current = false;
      setPending(false);
    };
    applyStatusOutcome(outcome, {
      showStatus: (stored) => {
        setStatus(stored);
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

  return <OrderStatusControlView status={status} pending={pending} message={message} onAdvance={() => void advance()} />;
}
