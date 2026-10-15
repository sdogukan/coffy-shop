import { adminError, describeError, errorResponse, json, readJsonBody } from "../../../../src/admin/http.ts";
import { PRODUCT_INPUT_ERRORS, parseProductCreate } from "../../../../src/admin/product-input.ts";
import { requireAdminRequest } from "../../../../src/admin/session.ts";
import { addProduct } from "../../../../src/db/admin-products.ts";
import { readMenu } from "../../../../src/db/menu.ts";

export const dynamic = "force-dynamic";

// A product body is a few hundred characters; this only stops oversized
// bodies before JSON.parse.
const MAX_BODY_LENGTH = 8192;

// Every category with every product, the unavailable ones included.
export function GET(request: Request) {
  const denied = requireAdminRequest(request, { mutation: false });
  if (denied !== null) {
    return denied;
  }
  try {
    return json({ categories: readMenu() }, 200);
  } catch (error) {
    console.error(`Admin product list failed: ${describeError(error)}`);
    return adminError("server_error", 500);
  }
}

export async function POST(request: Request) {
  const denied = requireAdminRequest(request, { mutation: true });
  if (denied !== null) {
    return denied;
  }
  const read = await readJsonBody(request, MAX_BODY_LENGTH);
  if (!read.ok) {
    return adminError("invalid_request", 400);
  }
  const parsed = parseProductCreate(read.body);
  if (!parsed.ok) {
    return errorResponse(parsed.code, parsed.error, 400);
  }

  let result: ReturnType<typeof addProduct>;
  try {
    result = addProduct(parsed.value);
  } catch (error) {
    console.error(`Admin product creation failed: ${describeError(error)}`);
    return adminError("server_error", 500);
  }
  if (result.status === "unknown_category") {
    return errorResponse("invalid_product", PRODUCT_INPUT_ERRORS.unknown_category, 400);
  }
  return json({ product: result.product }, 201);
}
