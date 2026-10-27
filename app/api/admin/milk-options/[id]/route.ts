import { ADMIN_ERRORS, adminError, describeError, errorResponse, json, readJsonBody } from "../../../../../src/admin/http.ts";
import { parseMilkOptionPatch } from "../../../../../src/admin/milk-option-input.ts";
import { requireAdminRequest } from "../../../../../src/admin/session.ts";
import { editMilkOption } from "../../../../../src/db/milk-options.ts";

export const dynamic = "force-dynamic";

// {"surchargeKurus": 1000000, "isAvailable": false} is under 50 characters;
// this only stops oversized bodies before JSON.parse.
const MAX_BODY_LENGTH = 1024;
// Same bound as the milk_options.id column; a longer id never reaches SQLite.
const MAX_MILK_OPTION_ID_LENGTH = 64;

// Updates only the fields present in the body. There is no DELETE: an option
// is removed from the list by setting isAvailable to false. The default
// option (Normal süt) is refused and stays 0 kuruş and available.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAdminRequest(request, { mutation: true });
  if (denied !== null) {
    return denied;
  }
  const { id } = await params;
  if (id.length < 1 || id.length > MAX_MILK_OPTION_ID_LENGTH) {
    return errorResponse("not_found", ADMIN_ERRORS.milk_option_not_found, 404);
  }
  const read = await readJsonBody(request, MAX_BODY_LENGTH);
  if (!read.ok) {
    return adminError("invalid_request", 400);
  }
  const parsed = parseMilkOptionPatch(read.body);
  if (!parsed.ok) {
    return errorResponse(parsed.code, parsed.error, 400);
  }

  let result: ReturnType<typeof editMilkOption>;
  try {
    result = editMilkOption(id, parsed.value);
  } catch (error) {
    console.error(`Admin milk option update failed: ${describeError(error)}`);
    return adminError("server_error", 500);
  }
  switch (result.status) {
    case "updated":
      return json({ milkOption: result.milkOption }, 200);
    case "not_found":
      return errorResponse("not_found", ADMIN_ERRORS.milk_option_not_found, 404);
    case "default_option":
      return adminError("default_milk_option", 400);
  }
}
