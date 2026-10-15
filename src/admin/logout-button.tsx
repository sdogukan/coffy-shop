"use client";

import { useRef, useState } from "react";
import { type AdminOutcome, submitLogout } from "./admin-api.ts";
import { ADMIN_LOGIN_PATH } from "./paths.ts";

export interface LogoutOutcomeHandlers {
  goToLogin: () => void;
  showError: (message: string) => void;
}

// 204 means the session is revoked and the cookie cleared. Anything else
// leaves the admin where they are, with the reason, so they can try again.
export function applyLogoutOutcome(outcome: AdminOutcome<true>, handlers: LogoutOutcomeHandlers): void {
  if (outcome.kind === "ok") {
    handlers.goToLogin();
    return;
  }
  handlers.showError(outcome.message);
}

// A POST from a button, never a GET link: a link could be followed from
// another site. location.replace swaps this history entry for the login
// page, so the back button does not return to the admin page.
export function LogoutButton() {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function logout() {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setSending(true);
    setMessage(null);
    applyLogoutOutcome(await submitLogout(), {
      goToLogin: () => window.location.replace(ADMIN_LOGIN_PATH),
      showError: (nextMessage) => {
        inFlight.current = false;
        setSending(false);
        setMessage(nextMessage);
      },
    });
  }

  return (
    <>
      <button type="button" className="admin-bar-logout" disabled={sending} onClick={() => void logout()}>
        Çıkış
      </button>
      {message !== null && (
        <p className="admin-bar-error" role="alert">
          {message}
        </p>
      )}
    </>
  );
}
