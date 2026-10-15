import { adminError, describeError, errorResponse, json, readJsonBody } from "../../../../../src/admin/http.ts";
import { PRODUCT_INPUT_ERRORS, parseProductPatch } from "../../../../../src/admin/product-input.ts";
import { requireAdminRequest } from "../../../../../src/admin/session.ts";
import { editProduct } from "../../../../../src/db/admin-products.ts";

export const dynamic = "force-dynamic";

const MAX_BODY_LENGTH = 8192;
// Same bound as the products.id column; a longer id never reaches SQLite.
const MAX_PRODUCT_ID_LENGTH = 64;

// Updates only the fields present in the body. There is no DELETE: a product
// is taken off the menu by setting isAvailable to false.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAdminRequest(request, { mutation: true });
  if (denied !== null) {
    return denied;
  }
  const { id } = await params;
  if (id.length < 1 || id.length > MAX_PRODUCT_ID_LENGTH) {
    return adminError("not_found", 404);
  }
  const read = await readJsonBody(request, MAX_BODY_LENGTH);
  if (!read.ok) {
    return adminError("invalid_request", 400);
  }
  const parsed = parseProductPatch(read.body);
  if (!parsed.ok) {
    return errorResponse(parsed.code, parsed.error, 400);
  }

  let result: ReturnType<typeof editProduct>;
  try {
    result = editProduct(id, parsed.value);
  } catch (error) {
    console.error(`Admin product update failed: ${describeError(error)}`);
    return adminError("server_error", 500);
  }
  switch (result.status) {
    case "updated":
      return json({ product: result.product }, 200);
    case "not_found":
      return adminError("not_found", 404);
    case "unknown_category":
      return errorResponse("invalid_product", PRODUCT_INPUT_ERRORS.unknown_category, 400);
  }
}
