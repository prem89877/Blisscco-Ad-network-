// Phase 2: ek jagah ki shared "action guard" logic (React / Next.js se alag, isliye Node tests me seedha chalti hai).
// Problem: button dabane par pending state tab tak chalti rehti thi jab tak server ka poora jawab (auth + database + naye page ka render)
// na aaye. Jawab dheema ya toota ho toh button atak jata tha aur result sirf reload par dikhta tha. Ab:
//  * jawab ka intezaar hota hai, par ek HAD (timeout) ke saath; had par loading saaf hoti hai aur saaf message dikhta hai,
//  * network / unexpected error par bhi loading saaf hoti hai aur error dikhta hai (kabhi "atka hua" nahi),
//  * ek tap ke dauran doosra tap (double tap) action ko dobara nahi chalata,
//  * had / network error par server ki asli state dobara padhi jaati hai (refresh), kyunki kaam server par poora ho chuka ho sakta hai,
//  * koi nakli success kabhi nahi dikhta, aur failed action ko apne aap dobara nahi chalaya jata (paisa wale kaam blind retry nahi).

export type GuardState = { status: "idle" | "success" | "error" | string; message?: string };

/** Client ki taraf se intezaar ki had. Server ka kaam isse pehle bhi poora ho sakta hai; tab refresh asli state dikha deta hai. */
export const DEFAULT_ACTION_TIMEOUT_MS = 20_000;

export const TIMEOUT_MESSAGE =
  "This is taking longer than expected. Your request may still be processing. Please check the page for the latest status before trying again.";
export const FAILURE_MESSAGE =
  "We could not reach the server. Please check your connection and the page for the latest status before trying again.";

/** Diagnostics: itne ms se zyada lage toh (chahe kaam ho gaya ho) Vercel logs me "action_slow" jata hai. */
export const SLOW_ACTION_MS = 5_000;

export type GuardDiagEvent = "action_slow" | "action_timeout" | "action_failed";
export type GuardDiagDetails = { ms: number; outcome: "success" | "redirect" | "error" | "timeout" | "network"; errName?: string; errMsg?: string };

// Browser se /api/diag par ek chhoti report (server use "[diag]" line bana kar Vercel logs me likhta hai). Is file me koi import nahi (test niyam),
// isliye report bhejne wala function yahin hai. Sirf event ka naam, path (bina query), ms, aur chhota error naam / msg jaata hai. Form ki koi value kabhi nahi.
// fetch + keepalive: page badalte / error screen aate waqt bhi request poori jaati hai. Ek page load me adhiktam 5 report (spam nahi).
// Fail hone par bhi UI par koi asar nahi.
let diagSent = 0;
export function sendDiagReport(event: string, fields: Record<string, string | number | boolean | null | undefined>): void {
  try {
    if (typeof window === "undefined" || diagSent >= 5) return;
    diagSent += 1;
    const body = JSON.stringify({
      event,
      path: window.location.pathname,
      online: typeof navigator !== "undefined" ? navigator.onLine : undefined,
      ...fields,
    });
    void fetch("/api/diag", { method: "POST", body, keepalive: true, headers: { "Content-Type": "text/plain" } }).catch(() => undefined);
  } catch {
    // diagnostics se kabhi button ya page nahi tootna chahiye
  }
}

export class ActionTimeoutError extends Error {
  constructor() {
    super("action timed out");
    this.name = "ActionTimeoutError";
  }
}

/** Next.js redirect() / notFound() ek khaas error se kaam karte hain. Unhe nigalna nahi chahiye: navigation rukegi. */
export function isNextControlFlowError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND");
}

export type GuardOptions<S extends GuardState> = {
  /** Asli (server) action. */
  action: (prev: S, formData: FormData) => Promise<S>;
  /** Had ke baad / network error par server ki asli state dobara padhne ke liye (router.refresh). */
  refresh?: () => void;
  timeoutMs?: number;
  /** Error state banane ka tareeka (form me bhare values waapas chahiye ho toh). Default: purani state + status "error" + message. */
  errorState?: (prev: S, message: string, formData: FormData) => S;
  now?: () => number;
  /** Diagnostics: slow / timeout / failed action ki report. Default: kuch nahi (UI hook /api/diag wala beacon deta hai). Kabhi throw nahi karna chahiye. */
  report?: (event: GuardDiagEvent, details: GuardDiagDetails) => void;
  /** Is se zyada lage toh "action_slow" report hota hai. Default SLOW_ACTION_MS. */
  slowMs?: number;
};

export type Guard<S extends GuardState> = {
  /** useActionState ko ye do. */
  run: (prev: S, formData: FormData) => Promise<S>;
  /** Form onSubmit me bulao: false matlab pehla tap abhi chal raha hai (event.preventDefault() karo). */
  tryBegin: () => boolean;
  isBusy: () => boolean;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ActionTimeoutError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export function createActionGuard<S extends GuardState>(options: GuardOptions<S>): Guard<S> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const buildError = options.errorState ?? ((prev: S, message: string) => ({ ...prev, status: "error", message }) as S);
  // Lock kabhi hamesha ke liye nahi atakta: had + thoda extra ke baad apne aap khul jata hai.
  const lockMs = timeoutMs + 1_000;
  const slowMs = options.slowMs ?? SLOW_ACTION_MS;
  let busySince: number | null = null;

  const isBusy = () => busySince !== null && now() - busySince < lockMs;
  const tryBegin = () => {
    if (isBusy()) return false;
    busySince = now();
    return true;
  };
  const release = () => {
    busySince = null;
  };

  const safeRefresh = () => {
    try {
      options.refresh?.();
    } catch {
      // refresh fail hone se action ka natija nahi badalta
    }
  };

  const safeReport = (event: GuardDiagEvent, details: GuardDiagDetails) => {
    try {
      options.report?.(event, details);
    } catch {
      // report fail hone se action ka natija nahi badalta
    }
  };

  const run = async (prev: S, formData: FormData): Promise<S> => {
    // onSubmit se lock pehle hi le liya gaya ho sakta hai; direct call par yahan lete hain.
    if (busySince === null) busySince = now();
    const startedAt = busySince;
    try {
      const result = await withTimeout(options.action(prev, formData), timeoutMs);
      const ms = now() - startedAt;
      // Server redirect() par Next.js navigate karta hai aur yahan kuch nahi aata: purani state rakho (UI tootta nahi).
      if (result === undefined || result === null) {
        if (ms >= slowMs) safeReport("action_slow", { ms, outcome: "redirect" });
        return prev;
      }
      if (ms >= slowMs) safeReport("action_slow", { ms, outcome: result.status === "error" ? "error" : "success" });
      return result;
    } catch (error) {
      const ms = now() - startedAt;
      if (isNextControlFlowError(error)) {
        if (ms >= slowMs) safeReport("action_slow", { ms, outcome: "redirect" });
        throw error;
      }
      if (error instanceof ActionTimeoutError) {
        safeReport("action_timeout", { ms, outcome: "timeout" });
        safeRefresh();
        return buildError(prev, TIMEOUT_MESSAGE, formData);
      }
      const e = error as { name?: unknown; message?: unknown } | null;
      safeReport("action_failed", {
        ms,
        outcome: "network",
        errName: typeof e?.name === "string" ? e.name : undefined,
        errMsg: typeof e?.message === "string" ? e.message : undefined,
      });
      safeRefresh();
      return buildError(prev, FAILURE_MESSAGE, formData);
    } finally {
      release();
    }
  };

  return { run, tryBegin, isBusy };
}
