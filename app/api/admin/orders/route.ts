import { adminError, describeError, json } from "../../../../src/admin/http.ts";
import { requireAdminRequest } from "../../../../src/admin/session.ts";
import { readOrders } from "../../../../src/db/admin-orders.ts";

export const dynamic = "force-dynamic";

// Every order, newest first, without the customer's tracking token.
export function GET(request: Request) {
  const denied = requireAdminRequest(request, { mutation: false });
  if (denied !== null) {
    return denied;
  }
  try {
    return json({ orders: readOrders() }, 200);
  } catch (error) {
    console.error(`Admin order list failed: ${describeError(error)}`);
    return adminError("server_error", 500);
  }
}
