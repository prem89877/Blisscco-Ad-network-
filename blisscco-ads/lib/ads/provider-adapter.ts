// Day 12 Prompt 5 Part 4: future external ad-serving provider ke liye CHHOTI, alag SERVER-SIDE seema (boundary).
//
// Abhi koi provider connected NAHI hai: koi install/connection nahi, koi credential/env var nahi, current ad-serving provider nahi badla.
// Default = koi adapter nahi (noop). Is file me provider ka koi code, URL, import ya config nahi (pure module: DB/env/server-only/logging nahi).
//
// Niyam (boundary ke):
//   1. Blisscco ka apna click event (record_ad_click, DB) PEHLE aur akela source of truth hai. Adapter sirf uske BAAD, "recorded" par, ek copy sunta hai.
//   2. Destination / creative kabhi adapter se nahi aate. Adapter ka return value ignore hota hai (type bhi Promise<void>). Redirect hamesha DB ki destination par.
//   3. Adapter fail ho, throw kare, ya atak jaye => click aur redirect par KOI asar nahi (error swallow, timeout ke baad aage badhte hain).
//   4. Adapter ko sirf Blisscco ke apne (internal) ids milte hain. Destination URL, signed ref, IP, user-agent, secret: kuch nahi.

/** Adapter ko jaane wala click event. Frozen copy; sirf Blisscco internal ids + samay. */
export type AdProviderClickEvent = Readonly<{
  serveRef: string;
  publisherId: string;
  creativeId: string;
  occurredAtMs: number;
}>;

/** Future provider isko implement karega. Abhi koi implementation nahi. Sab methods optional: na ho toh skip. */
export interface AdProviderAdapter {
  /** Sirf label (logs/tests ke liye). Koi logic is par nahi. */
  readonly name: string;
  /** Blisscco ne is serve ka PEHLA click gin liya. Return value ignore hota hai. */
  onClickRecorded?(event: AdProviderClickEvent): Promise<void>;
}

/** Default: kuch nahi karta. */
export const noopAdProviderAdapter: AdProviderAdapter = Object.freeze({ name: "none" });

export const ADAPTER_TIMEOUT_MS = 1000;

/** delivered = adapter ne bina error finish kiya | skipped = adapter/method nahi | failed = throw/reject | timeout = samay me finish nahi hua */
export type AdapterDelivery = "delivered" | "skipped" | "failed" | "timeout";

/** Kabhi throw nahi karta. Timer hamesha saaf hota hai. Adapter ka return value kabhi nahi padha jaata. */
export async function deliverClickToAdapter(
  adapter: AdProviderAdapter | null | undefined,
  event: { serveRef: string; publisherId: string; creativeId: string; occurredAtMs: number },
  timeoutMs: number = ADAPTER_TIMEOUT_MS,
): Promise<AdapterDelivery> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const handler = adapter?.onClickRecorded;
    if (typeof handler !== "function") return "skipped";
    const frozen: AdProviderClickEvent = Object.freeze({
      serveRef: event.serveRef,
      publisherId: event.publisherId,
      creativeId: event.creativeId,
      occurredAtMs: event.occurredAtMs,
    });
    const call = Promise.resolve().then(() => handler.call(adapter, frozen));
    call.catch(() => undefined); // timeout ke baad late reject ho toh unhandled rejection na bane
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), Math.max(1, timeoutMs));
    });
    const winner = await Promise.race([call.then(() => "delivered" as const), timeout]);
    return winner;
  } catch {
    return "failed";
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
