// Limits login attempts per time window, counted globally: the server is a
// single process with a single admin account, and a key taken from the
// request (username, password or a client header) could be varied by an
// attacker to get a fresh budget. The cost is that wrong attempts from anyone
// also lock the admin out until the window passes.
//
// The state lives in memory, so a restart (every deploy) clears it; that is
// accepted for this single-process server.

export const LOGIN_MAX_ATTEMPTS = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export type LoginAttempt = { ok: true } | { ok: false; retryAfterSeconds: number };

export interface LoginLimiter {
  // Records the attempt synchronously, before any await, so parallel
  // requests cannot all pass the check before one of them is counted.
  reserve(now?: number): LoginAttempt;
  // Called after a successful login.
  reset(): void;
}

export function createLoginLimiter(maxAttempts: number, windowMs: number): LoginLimiter {
  // Timestamps of the attempts still inside the window, oldest first; never
  // longer than maxAttempts.
  let attempts: number[] = [];
  return {
    reserve(now = Date.now()) {
      attempts = attempts.filter((time) => time > now - windowMs);
      if (attempts.length >= maxAttempts) {
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(((attempts[0] as number) + windowMs - now) / 1000)) };
      }
      attempts.push(now);
      return { ok: true };
    },
    reset() {
      attempts = [];
    },
  };
}

export const loginLimiter = createLoginLimiter(LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
