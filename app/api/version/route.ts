import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SHA_PATTERN = /^[0-9a-f]{40}$/;

// COFFY_BUILD_SHA is inlined at build time by next.config.ts, so a runtime
// environment variable cannot change the reported commit.
export function GET() {
  const sha = process.env.COFFY_BUILD_SHA;
  if (sha === undefined || !SHA_PATTERN.test(sha)) {
    console.error("Build SHA stamp is missing or malformed");
    return NextResponse.json(
      { error: "Version unavailable" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json({ sha }, { headers: { "Cache-Control": "no-store" } });
}
