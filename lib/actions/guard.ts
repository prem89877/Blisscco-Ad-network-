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

  const run = async (prev: S, formData: FormData): Promise<S> => {
    // onSubmit se lock pehle hi le liya gaya ho sakta hai; direct call par yahan lete hain.
    if (busySince === null) busySince = now();
    try {
      const result = await withTimeout(options.action(prev, formData), timeoutMs);
      // Server redirect() par Next.js navigate karta hai aur yahan kuch nahi aata: purani state rakho (UI tootta nahi).
      if (result === undefined || result === null) return prev;
      return result;
    } catch (error) {
      if (isNextControlFlowError(error)) throw error;
      if (error instanceof ActionTimeoutError) {
        safeRefresh();
        return buildError(prev, TIMEOUT_MESSAGE, formData);
      }
      safeRefresh();
      return buildError(prev, FAILURE_MESSAGE, formData);
    } finally {
      release();
    }
  };

  return { run, tryBegin, isBusy };
}
