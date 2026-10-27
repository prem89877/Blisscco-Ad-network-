import { isCategory } from "@/lib/campaigns/constants";

// Naya account (advertiser / publisher) ka form + web address ki jaanch. PURA module: koi database/env nahi.
// Asli check yahi hai (server par); browser ki checking sirf suvidha ke liye. Database CHECK alag se rokta hai.

export const COMPANY_MAX = 150;
export const NAME_MAX = 150;
export const URL_MAX = 2048;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
// Dikhne me khali / chhupe characters (zero-width space, soft hyphen, text-direction override). Inse naam khali ya dhokha dene wala ban sakta hai.
// ZWJ/ZWNJ (200C/200D) jaan-boojh kar allowed hain: Hindi, Persian jaise naamo me asli use hota hai.
const HIDDEN_CHARS = /[\u00ad\u200b\u202a-\u202e\u2060-\u2064\u2066-\u2069]/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Naam me control ya chhupe hue characters hain? */
function hasBadNameChars(name: string): boolean {
  return CONTROL_CHARS.test(name) || HIDDEN_CHARS.test(name);
}

/** Web address ki jaanch (https sirf). Theek hai toh undefined, warna user ko dikhane layak message. */
export function checkHttpsUrl(raw: string): string | undefined {
  const url = raw.trim();
  if (url.length === 0) return "Enter a web address.";
  if (url.length > URL_MAX) return `Use at most ${URL_MAX} characters.`;
  if (/\s/.test(url) || CONTROL_CHARS.test(url)) return "The web address cannot contain spaces.";
  if (!url.toLowerCase().startsWith("https://")) return "Start the web address with https://";

  // "https://trusted.com@evil.example" jaisa address (phishing): host se pehle koi '@' nahi chalega.
  const beforePath = url.slice("https://".length).split(/[/?#]/)[0];
  if (beforePath.includes("@")) return "The web address cannot contain a username or '@' before the site name.";

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Enter a valid web address, like https://example.com";
  }
  if (parsed.protocol !== "https:") return "Start the web address with https://";
  if (parsed.username || parsed.password) return "The web address cannot contain a username or password.";

  const host = parsed.hostname;
  if (host.startsWith("[") || IPV4.test(host)) return "Use a website name, not an IP number.";
  if (!host.includes(".") || host.startsWith(".") || host.endsWith(".") || host === "localhost") {
    return "Enter a real website address, like https://example.com";
  }
  return undefined;
}

export type SetupState<K extends string> = {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Partial<Record<K, string>>;
  values?: Partial<Record<K, string>>;
};

/* ---------------- Advertiser ---------------- */
export type AdvertiserFields = "companyName" | "websiteUrl";
export type ParsedAdvertiser = { companyName: string; websiteUrl: string | null };
export type AdvertiserParse =
  | { ok: true; value: ParsedAdvertiser }
  | { ok: false; errors: Partial<Record<AdvertiserFields, string>> };

export function parseAdvertiserSetup(input: { companyName: string; websiteUrl: string }): AdvertiserParse {
  const errors: Partial<Record<AdvertiserFields, string>> = {};
  const companyName = input.companyName.replace(/\s+/g, " ").trim();
  const websiteUrl = input.websiteUrl.trim();

  if (companyName.length === 0) errors.companyName = "Enter your business name.";
  else if (companyName.length > COMPANY_MAX) errors.companyName = `Use at most ${COMPANY_MAX} characters.`;
  else if (hasBadNameChars(companyName)) errors.companyName = "Remove special control characters.";

  if (websiteUrl.length > 0) {
    const urlError = checkHttpsUrl(websiteUrl);
    if (urlError) errors.websiteUrl = urlError;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { companyName, websiteUrl: websiteUrl.length > 0 ? websiteUrl : null } };
}

/* ---------------- Publisher ---------------- */
export type PublisherFields = "name" | "websiteUrl" | "category";
export type ParsedPublisher = { name: string; websiteUrl: string | null; category: string | null };
export type PublisherParse =
  | { ok: true; value: ParsedPublisher }
  | { ok: false; errors: Partial<Record<PublisherFields, string>> };

export function parsePublisherSetup(input: { name: string; websiteUrl: string; category: string }): PublisherParse {
  const errors: Partial<Record<PublisherFields, string>> = {};
  const name = input.name.replace(/\s+/g, " ").trim();
  const websiteUrl = input.websiteUrl.trim();
  const category = input.category.trim();

  if (name.length === 0) errors.name = "Enter the name of your chatbot or platform.";
  else if (name.length > NAME_MAX) errors.name = `Use at most ${NAME_MAX} characters.`;
  else if (hasBadNameChars(name)) errors.name = "Remove special control characters.";

  if (websiteUrl.length > 0) {
    const urlError = checkHttpsUrl(websiteUrl);
    if (urlError) errors.websiteUrl = urlError;
  }
  if (category.length > 0 && !isCategory(category)) errors.category = "Choose a category from the list.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { name, websiteUrl: websiteUrl.length > 0 ? websiteUrl : null, category: category.length > 0 ? category : null },
  };
}

/* ---------------- Publisher setup: database error -> user message ---------------- */
type SetupDbError = { code?: string | null; message?: string | null } | null | undefined;
export type PublisherSetupFailure = { message: string; fieldErrors?: Partial<Record<PublisherFields, string>> };

/**
 * Publisher row insert fail hone par user ko dikhne wala message. Raw database message kabhi nahi dikhta.
 * 23505 (row pehle se hai) yahan nahi aata: server action use alag sambhalta hai.
 */
export function mapPublisherSetupError(error: SetupDbError): PublisherSetupFailure {
  switch (error?.code) {
    case "23503":
      // Foreign key: category list me nahi (ya band ho chuki). Baaki FK (role) me generic message.
      if (typeof error.message === "string" && /category/i.test(error.message)) {
        return {
          message: "Please fix the highlighted fields.",
          fieldErrors: { category: "That topic is not available. Choose another one from the list." },
        };
      }
      return { message: "We could not save your details. Please try again." };
    case "23514":
      return { message: "One of the details was not accepted. Check the name and website, then try again." };
    case "42501":
      return { message: "Your account cannot save these details right now. If you think this is a mistake, please contact support." };
    default:
      return { message: "We could not save your details. Please try again." };
  }
}
