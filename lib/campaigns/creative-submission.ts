import { isUuid } from "@/lib/campaigns/constants";
import { parseCreativeForm, isCreativeStatus, type CreativeStatus } from "@/lib/campaigns/creative-validation";

// Phase 4 Step 3: advertiser ka "Submit an ad" form (naya page /dashboard/advertiser/creatives).
// PURA module: koi database/env nahi. Headline / description / CTA / URL ki jaanch purane creative-validation se ZYADA se ZYADA wahi
// (database CHECK jaisi seema), isliye purana "Add an ad" form aur uske tests waise ke waise rehte hain.
// Category campaign se aati hai (read-only), creative ki alag category nahi: matching ka exact-match rule nahi tootta.

export const BRAND_MAX = 80;
export const KEYWORDS_MAX_COUNT = 10;
export const KEYWORD_MIN = 2;
export const KEYWORD_MAX = 30;
export const KEYWORDS_MAX_CHARS = 200;

export const CTA_OPTIONS = ["Learn more", "Shop now", "Sign up", "Get started", "Book now", "Download", "Contact us", "Apply now"] as const;
export function isCtaOption(v: string): boolean {
  return (CTA_OPTIONS as readonly string[]).includes(v);
}

export type SubmissionTextField = "campaignId" | "brandName" | "headline" | "body" | "ctaText" | "destinationUrl" | "keywords";
export type SubmissionField = SubmissionTextField | "logo" | "banner";
export type SubmissionValues = Record<SubmissionTextField, string>;

export type SubmissionFormState = {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Partial<Record<SubmissionField, string>>;
  values?: SubmissionValues;
};
export const initialSubmissionState: SubmissionFormState = { status: "idle" };

export type ParsedSubmission = {
  campaignId: string;
  brandName: string;
  headline: string;
  body: string;
  ctaText: string;
  destinationUrl: string;
  keywords: string | null;
};
export type SubmissionParse =
  | { ok: true; value: ParsedSubmission }
  | { ok: false; errors: Partial<Record<SubmissionField, string>> };

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const HIDDEN_CHARS = /[\u00ad\u200b\u202a-\u202e\u2060-\u2064\u2066-\u2069]/;
const KEYWORD_SHAPE = /^[\p{L}\p{N}][\p{L}\p{N} '&+.\-]*$/u;

export function readSubmissionValues(fd: FormData): SubmissionValues {
  const get = (k: string, max: number): string => {
    const v = fd.get(k);
    return typeof v === "string" ? v.slice(0, max) : "";
  };
  // +1: limit se lamba text chupke se kaatne ki jagah error dikhana hai.
  return {
    campaignId: get("campaignId", 64),
    brandName: get("brandName", BRAND_MAX + 1),
    headline: get("headline", 91),
    body: get("body", 301),
    ctaText: get("ctaText", 31),
    destinationUrl: get("destinationUrl", 2100),
    keywords: get("keywords", KEYWORDS_MAX_CHARS * 2),
  };
}

/** "a, B ,a\nc" -> "a, b, c". Galat keyword par error. Khali = koi keyword nahi (optional). */
export function parseKeywords(raw: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const parts = raw
    .split(/[,\n]/)
    .map((p) => p.replace(/\s+/g, " ").trim().toLowerCase())
    .filter((p) => p.length > 0);
  const unique = [...new Set(parts)];
  if (unique.length === 0) return { ok: true, value: null };
  if (unique.length > KEYWORDS_MAX_COUNT) return { ok: false, error: `Use at most ${KEYWORDS_MAX_COUNT} keywords.` };
  for (const k of unique) {
    if (k.length < KEYWORD_MIN || k.length > KEYWORD_MAX) {
      return { ok: false, error: `Each keyword must be ${KEYWORD_MIN} to ${KEYWORD_MAX} characters.` };
    }
    if (CONTROL_CHARS.test(k) || HIDDEN_CHARS.test(k) || !KEYWORD_SHAPE.test(k)) {
      return { ok: false, error: "Keywords can use letters, numbers, spaces and - . & + ' only." };
    }
  }
  const joined = unique.join(", ");
  if (joined.length > KEYWORDS_MAX_CHARS) return { ok: false, error: `Keywords are too long (at most ${KEYWORDS_MAX_CHARS} characters in total).` };
  return { ok: true, value: joined };
}

export function parseSubmission(values: SubmissionValues): SubmissionParse {
  const errors: Partial<Record<SubmissionField, string>> = {};

  if (!isUuid(values.campaignId)) errors.campaignId = "Choose one of your campaigns.";

  const brandName = values.brandName.replace(/\s+/g, " ").trim();
  if (brandName.length === 0) errors.brandName = "Enter your brand or business name.";
  else if (brandName.length > BRAND_MAX) errors.brandName = `Use at most ${BRAND_MAX} characters.`;
  else if (CONTROL_CHARS.test(brandName) || HIDDEN_CHARS.test(brandName)) errors.brandName = "Remove special control characters.";

  // headline / description (body) / URL: purane form wale hi niyam.
  const core = parseCreativeForm({
    headline: values.headline,
    body: values.body,
    ctaText: values.ctaText,
    destinationUrl: values.destinationUrl,
  });
  if (!core.ok) {
    if (core.errors.headline) errors.headline = core.errors.headline;
    if (core.errors.body) errors.body = core.errors.body.replace("Enter the ad text.", "Enter the ad description.");
    if (core.errors.ctaText) errors.ctaText = core.errors.ctaText;
    if (core.errors.destinationUrl) errors.destinationUrl = core.errors.destinationUrl;
  }

  // Is form me CTA zaroori hai aur list me se (purane form me optional tha).
  const cta = values.ctaText.replace(/\s+/g, " ").trim();
  if (!errors.ctaText) {
    if (cta.length === 0) errors.ctaText = "Choose a button text.";
    else if (!isCtaOption(cta)) errors.ctaText = "Choose a button text from the list.";
  }

  const kw = parseKeywords(values.keywords);
  if (!kw.ok) errors.keywords = kw.error;

  if (Object.keys(errors).length > 0 || !core.ok || !kw.ok) return { ok: false, errors };
  return {
    ok: true,
    value: {
      campaignId: values.campaignId,
      brandName,
      headline: core.value.headline,
      body: core.value.body,
      ctaText: cta,
      destinationUrl: core.value.destinationUrl,
      keywords: kw.value,
    },
  };
}

/* ---------------- Advertiser ke creatives ki list (naye columns ke saath) ---------------- */

export type SubmittedCreative = {
  id: string;
  campaignId: string;
  headline: string;
  body: string;
  ctaText: string | null;
  destinationUrl: string;
  status: CreativeStatus;
  rejectionReason: string | null;
  brandName: string | null;
  logoPath: string | null;
  bannerPath: string | null;
  keywords: string | null;
};

export const SUBMITTED_CREATIVE_COLUMNS =
  "id, campaign_id, headline, body, cta_text, destination_url, status, rejection_reason, brand_name, logo_path, banner_path, keywords";

/** Database row (unknown) -> SubmittedCreative. Shape galat ho toh null (kabhi crash nahi). */
export function toSubmittedCreative(row: unknown): SubmittedCreative | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  const s = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const id = s(r.id);
  const campaignId = s(r.campaign_id);
  const headline = s(r.headline);
  const body = s(r.body);
  const destinationUrl = s(r.destination_url);
  if (!id || !campaignId || !headline || !body || !destinationUrl || !isCreativeStatus(r.status)) return null;
  return {
    id,
    campaignId,
    headline,
    body,
    ctaText: s(r.cta_text),
    destinationUrl,
    status: r.status,
    rejectionReason: s(r.rejection_reason),
    brandName: s(r.brand_name),
    logoPath: s(r.logo_path),
    bannerPath: s(r.banner_path),
    keywords: s(r.keywords),
  };
}

/** Sirf host (preview me dikhane ke liye; link nahi banta). */
export function displayHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** Kaun se status par advertiser content edit + dobara bhej sakta hai (database trigger bhi yahi maanta hai). */
export const EDITABLE_STATUSES: readonly CreativeStatus[] = ["draft", "rejected"];
export function canEditAndResubmit(status: CreativeStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}
