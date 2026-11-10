import type { NextRequest } from "next/server";
import { buildDiagLine, cleanDiagId, cleanDiagMs, cleanDiagPath, cleanDiagText, isDiagEvent } from "@/lib/diagnostics/log";

export const dynamic = "force-dynamic";

// Browser se aane wali diagnostic report (button bohot der laga / error screen dikhi) ko Vercel project logs me "[diag]" line bana deta hai.
// Koi login nahi chahiye (error screen logged-out user ko bhi aa sakti hai), isliye: sirf same-site, chhoti body, whitelisted event aur fields,
// aur ek instance par ek minute me limited lines (spam / log flood nahi). Jawab hamesha khali 204: bahar koi detail nahi jaati.
const HEADERS = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 2048;
const MAX_PER_MINUTE = 60;

let windowStart = 0;
let windowCount = 0;
function allowNow(now: number): boolean {
  if (now - windowStart >= 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  windowCount += 1;
  return windowCount <= MAX_PER_MINUTE;
}

function sameSite(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin request par browser Origin nahi bhi bhej sakta
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const quiet = () => new Response(null, { status: 204, headers: HEADERS });
  try {
    if (!sameSite(request) || !allowNow(Date.now())) return quiet();
    const text = await request.text();
    if (text.length === 0 || text.length > MAX_BODY_BYTES) return quiet();
    const body: unknown = JSON.parse(text);
    if (typeof body !== "object" || body === null || Array.isArray(body)) return quiet();
    const b = body as Record<string, unknown>;
    const event = b.event;
    if (!isDiagEvent(event)) return quiet();

    console.error(
      buildDiagLine(event, {
        source: "browser",
        path: cleanDiagPath(b.path),
        label: cleanDiagText(b.label, 60),
        boundary: cleanDiagText(b.boundary, 40),
        outcome: cleanDiagText(b.outcome, 20),
        ms: cleanDiagMs(b.ms),
        digest: cleanDiagId(b.digest),
        errName: cleanDiagText(b.errName, 60),
        errMsg: cleanDiagText(b.errMsg, 100),
        online: typeof b.online === "boolean" ? b.online : undefined,
        // Vercel ki request id: Vercel > Logs me isi id se poori request milti hai.
        vercelId: cleanDiagId((request.headers.get("x-vercel-id") ?? "").split("::").pop()),
      }),
    );
  } catch {
    // kharab body: chup-chaap 204
  }
  return quiet();
}
