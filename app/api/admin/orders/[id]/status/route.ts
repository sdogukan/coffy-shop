import { ADMIN_ERRORS, adminError, describeError, errorResponse, json, readJsonBody } from "../../../../../../src/admin/http.ts";
import { requireAdminRequest } from "../../../../../../src/admin/session.ts";
import { changeOrderStatus, parseOrderId } from "../../../../../../src/db/admin-orders.ts";
import { isOrderStatus } from "../../../../../../src/orders/order-status.ts";

export const dynamic = "force-dynamic";

// {"to": "completed"} is 19 characters; this only stops oversized bodies
// before JSON.parse.
const MAX_BODY_LENGTH = 256;

// The body is exactly {"to": "<string>"}; anything else is not a request.
function readTarget(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  const keys = Object.keys(body);
  const { to } = body as Record<string, unknown>;
  return keys.length === 1 && keys[0] === "to" && typeof to === "string" ? to : null;
}

// Moves an order exactly one step forward (new -> preparing -> ready ->
// completed). Skipping, going back, returning to new, changing a completed
// order and losing a race for the same step all answer 409 and change nothing.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAdminRequest(request, { mutation: true });
  if (denied !== null) {
    return denied;
  }
  const id = parseOrderId((await params).id);
  if (id === null) {
    return errorResponse("not_found", ADMIN_ERRORS.order_not_found, 404);
  }
  const read = await readJsonBody(request, MAX_BODY_LENGTH);
  if (!read.ok) {
    return adminError("invalid_request", 400);
  }
  const to = readTarget(read.body);
  if (to === null) {
    return adminError("invalid_request", 400);
  }
  if (!isOrderStatus(to)) {
    return adminError("invalid_status", 400);
  }

  let result: ReturnType<typeof changeOrderStatus>;
  try {
    result = changeOrderStatus(id, to);
  } catch (error) {
    console.error(`Admin order status change failed: ${describeError(error)}`);
    return adminError("server_error", 500);
  }
  switch (result.status) {
    case "updated":
      return json({ order: result.order }, 200);
    case "not_found":
      return errorResponse("not_found", ADMIN_ERRORS.order_not_found, 404);
    case "invalid_transition":
      return adminError("invalid_transition", 409);
  }
}
