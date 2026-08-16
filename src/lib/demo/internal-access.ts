import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

const INTERNAL_DEMO_TOKEN_ENV = "FINNOR_INTERNAL_DEMO_TOKEN";

/**
 * Demo-generation code remains available for explicitly authorized internal use,
 * but the retired public experience must fail closed. A missing server token is
 * therefore equivalent to disabled internal demo access.
 */
export function requireInternalDemoAccess(request: Request) {
  const expected = process.env[INTERNAL_DEMO_TOKEN_ENV]?.trim() || "";
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  const provided = request.headers.get("x-finnor-internal-demo-token")?.trim() || bearer;

  if (expected && provided && tokensMatch(expected, provided)) return null;

  return NextResponse.json(
    { error: "Not found." },
    {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    },
  );
}

function tokensMatch(expected: string, provided: string) {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length
    && timingSafeEqual(expectedBuffer, providedBuffer);
}
