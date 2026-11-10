import { getPaymentProvider } from "@/lib/payments/provider";
import { httpStatusFor, processPaymentWebhook } from "@/lib/payments/process-event";
import { paymentsStore } from "@/lib/payments/payments-db";

// POST /api/payments/webhook  (payment provider ka server-to-server webhook; browser yahan kuch nahi bhejta)
// Phase 5 Step 6: yeh file Step 5 report me likhi thi (files list) par ZIP me nahi thi, jabki tests/payments isse import karte hain.
// Step 5 ke design se dobara likhi gayi (lib/payments/* ko jodne wali patli parat). Owner apni repo ki copy se milaye (PENDING OWNER CONFIRMATION).
//
// Fail-closed:
//  * PAYMENT_PROVIDER set nahi / adapter ki sandbox config poori nahi / production => 503 {error:"not_configured"}. Database ko chhoota bhi nahi.
//  * Body ki seema 64 KB (raw body par signature check hota hai, isliye body pehle poori padhi jaati hai, par seema ke andar).
//  * Signature galat => 400. Status provider API se dobara padha jaata hai (lib/payments/process-event.ts), webhook ka dava nahi maana jaata.
//  * Koi secret, signature, amount ya reference yahan se log nahi hota.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Provider API ka apna time-out 8 second hai, database ka bhi. Atke toh jaldi 503, provider baad me retry karega.
export const maxDuration = 15;

const MAX_BODY_BYTES = 64 * 1024;

function reply(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const provider = getPaymentProvider();
  if (!provider) return reply({ error: "not_configured" }, 503);

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return reply({ error: "payload_too_large" }, 413);

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return reply({ error: "invalid_payload" }, 400);
  }
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) return reply({ error: "payload_too_large" }, 413);

  try {
    const result = await processPaymentWebhook(provider, paymentsStore, rawBody, request.headers);
    return reply({ status: result.kind === "applied" ? result.outcome : result.kind }, httpStatusFor(result));
  } catch {
    console.error("[payments] webhook unexpected failure");
    return reply({ error: "unavailable" }, 503);
  }
}
