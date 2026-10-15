import { ADMIN_ERRORS, adminError, describeError, errorResponse, json } from "../../../../../src/admin/http.ts";
import { requireAdminRequest } from "../../../../../src/admin/session.ts";
import { parseOrderId, readOrderById } from "../../../../../src/db/admin-orders.ts";

export const dynamic = "force-dynamic";

// One order with its item snapshots and note. A malformed id answers 404
// without a query.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAdminRequest(request, { mutation: false });
  if (denied !== null) {
    return denied;
  }
  const id = parseOrderId((await params).id);
  if (id === null) {
    return errorResponse("not_found", ADMIN_ERRORS.order_not_found, 404);
  }
  let order: ReturnType<typeof readOrderById>;
  try {
    order = readOrderById(id);
  } catch (error) {
    console.error(`Admin order read failed: ${describeError(error)}`);
    return adminError("server_error", 500);
  }
  return order === null ? errorResponse("not_found", ADMIN_ERRORS.order_not_found, 404) : json({ order }, 200);
}
