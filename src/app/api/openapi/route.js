import { NextResponse } from "next/server";
import { OPENAPI_SPEC } from "@/lib/openapiSpec";

export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json(OPENAPI_SPEC, { headers: { "Cache-Control": "public, max-age=300" } });
}
