import { NextResponse } from "next/server";
import { isDatabaseReady } from "../../../src/db/health.ts";

export const dynamic = "force-dynamic";

export function GET() {
  const ready = isDatabaseReady();
  return NextResponse.json(
    ready ? { status: "ok", database: "ok" } : { status: "error", database: "unavailable" },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
