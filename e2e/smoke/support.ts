import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { SMOKE_ADMIN_PASSWORD_ENV, SMOKE_ADMIN_USERNAME_ENV } from "../../scripts/smoke/smoke-env.ts";

// The random test admin the orchestrator configured for this run.
export function smokeAdminCredentials(): { username: string; password: string } {
  const username = process.env[SMOKE_ADMIN_USERNAME_ENV];
  const password = process.env[SMOKE_ADMIN_PASSWORD_ENV];
  if (username === undefined || username === "" || password === undefined || password === "") {
    throw new Error(`${SMOKE_ADMIN_USERNAME_ENV} and ${SMOKE_ADMIN_PASSWORD_ENV} are set by npm run smoke:run`);
  }
  return { username, password };
}

// The cart badge in the root layout renders only in the browser
// (src/cart/cart-badge.tsx), so once it shows, the page has hydrated and its
// buttons and forms are handled by React rather than by a native submit.
export async function expectHydrated(page: Page): Promise<void> {
  await expect(page.getByLabel(/^\d+ ürün$/)).toBeVisible();
}

export interface OrderItem {
  productId: string;
  quantity: number;
}

// A POST /api/orders body with a fresh idempotency key.
export function orderBody(items: readonly OrderItem[], idempotencyKey: string = randomUUID()) {
  return { customerName: "Smoke Test", note: "", items, idempotencyKey };
}
