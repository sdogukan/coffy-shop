"use client";

import { useRef, useState } from "react";
import { type AdminOutcome, submitLogin } from "./admin-api.ts";
import { ADMIN_PRODUCTS_PATH } from "./paths.ts";

export interface LoginFormViewProps {
  username: string;
  password: string;
  sending: boolean;
  message: string | null;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
}

export function LoginFormView({
  username,
  password,
  sending,
  message,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
}: LoginFormViewProps) {
  return (
    <form
      className="admin-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <fieldset disabled={sending}>
        <label htmlFor="admin-username">Kullanıcı adı</label>
        <input
          id="admin-username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          required
          value={username}
          onChange={(event) => onUsernameChange(event.target.value)}
        />
        <label htmlFor="admin-password">Şifre</label>
        <input
          id="admin-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
        />
      </fieldset>
      {message !== null && (
        <p className="form-error" role="alert">
          {message}
        </p>
      )}
      <button type="submit" className="button" disabled={sending}>
        {sending ? "Giriş yapılıyor…" : "Giriş yap"}
      </button>
    </form>
  );
}

export interface LoginOutcomeHandlers {
  goToProducts: () => void;
  showError: (message: string) => void;
}

// Wrong credentials, a lockout (429) and a disabled admin area (503) all
// show the server's own message; the password is never echoed back.
export function applyLoginOutcome(outcome: AdminOutcome<true>, handlers: LoginOutcomeHandlers): void {
  if (outcome.kind === "ok") {
    handlers.goToProducts();
    return;
  }
  handlers.showError(outcome.message);
}

export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function submit() {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setSending(true);
    setMessage(null);
    const outcome = await submitLogin(username, password);
    applyLoginOutcome(outcome, {
      // A full navigation, so the products page is rendered with the new cookie.
      goToProducts: () => window.location.replace(ADMIN_PRODUCTS_PATH),
      showError: (nextMessage) => {
        inFlight.current = false;
        setSending(false);
        setPassword("");
        setMessage(nextMessage);
      },
    });
  }

  return (
    <LoginFormView
      username={username}
      password={password}
      sending={sending}
      message={message}
      onUsernameChange={setUsername}
      onPasswordChange={setPassword}
      onSubmit={() => void submit()}
    />
  );
}
