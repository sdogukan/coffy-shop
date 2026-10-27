import { adminError, describeError, errorResponse, json, readJsonBody } from "../../../../src/admin/http.ts";
import { parseMilkOptionCreate } from "../../../../src/admin/milk-option-input.ts";
import { requireAdminRequest } from "../../../../src/admin/session.ts";
import { addMilkOption } from "../../../../src/db/milk-options.ts";

export const dynamic = "force-dynamic";

// A milk option body is well under a hundred characters; this only stops
// oversized bodies before JSON.parse.
const MAX_BODY_LENGTH = 1024;

// Adds an available milk option at the end of the list. The list itself is
// read through GET /api/admin/products.
export async function POST(request: Request) {
  const denied = requireAdminRequest(request, { mutation: true });
  if (denied !== null) {
    return denied;
  }
  const read = await readJsonBody(request, MAX_BODY_LENGTH);
  if (!read.ok) {
    return adminError("invalid_request", 400);
  }
  const parsed = parseMilkOptionCreate(read.body);
  if (!parsed.ok) {
    return errorResponse(parsed.code, parsed.error, 400);
  }

  try {
    return json({ milkOption: addMilkOption(parsed.value) }, 201);
  } catch (error) {
    console.error(`Admin milk option creation failed: ${describeError(error)}`);
    return adminError("server_error", 500);
  }
}
