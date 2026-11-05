// Google se aane wale user ka "intent" aur "naya user" ki pehchaan. Sirf pure functions (database / network nahi).
// Intent sirf advertiser ya publisher chunne ka hai; admin kabhi nahi. Cookie ke bharose koi ijazat nahi milti:
// asli rok database function (set_initial_account_role) me hai.

export const OAUTH_INTENT_COOKIE = "blc_oauth_intent";
export const CHOOSE_ROLE_PATH = "/auth/choose-role";

export type ChosenRole = "advertiser" | "publisher";
export type OAuthIntent = { kind: "login" } | { kind: "signup"; role: ChosenRole };

/** Cookie ki value. Login = "login"; signup = "signup:advertiser" ya "signup:publisher". */
export function encodeIntent(intent: OAuthIntent): string {
  return intent.kind === "signup" ? `signup:${intent.role}` : "login";
}

/** Kuch bhi ajeeb ya missing ho toh "login" (yaani user se pooch lo): kabhi chup-chaap advertiser nahi. */
export function parseIntent(raw: unknown): OAuthIntent {
  if (raw === "signup:advertiser") return { kind: "signup", role: "advertiser" };
  if (raw === "signup:publisher") return { kind: "signup", role: "publisher" };
  return { kind: "login" };
}

type UserLike = {
  created_at?: string;
  last_sign_in_at?: string;
  identities?: { provider?: string }[] | null;
};

const NEW_USER_WINDOW_MS = 120_000;
const FIRST_SIGN_IN_GAP_MS = 60_000;

/**
 * Abhi-abhi bana Google user? (Google identity + 2 minute ke andar bana + pehla hi sign-in.)
 * Purane users aur email se bane users ke liye false: unka role kabhi nahi chhua jata.
 */
export function isFreshGoogleSignup(user: UserLike | null | undefined, now: number = Date.now()): boolean {
  if (!user || !user.created_at || !user.last_sign_in_at) return false;
  if (!user.identities?.some((i) => i.provider === "google")) return false;
  const created = Date.parse(user.created_at);
  const lastIn = Date.parse(user.last_sign_in_at);
  if (!Number.isFinite(created) || !Number.isFinite(lastIn)) return false;
  if (now - created > NEW_USER_WINDOW_MS || now - created < -FIRST_SIGN_IN_GAP_MS) return false;
  return Math.abs(lastIn - created) <= FIRST_SIGN_IN_GAP_MS;
}
