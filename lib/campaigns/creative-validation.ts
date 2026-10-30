import { checkHttpsUrl } from "@/lib/accounts/validation";

// Ad (creative) ka form. Database ke CHECK jaisi hi seema: headline 1-90, body 1-300, button text 1-30, https URL <= 2048.
// PURA module: koi database/env nahi.

export const HEADLINE_MAX = 90;
export const BODY_MAX = 300;
export const CTA_MAX = 30;
export const MAX_CREATIVES_PER_CAMPAIGN = 20;

export type CreativeFieldName = "headline" | "body" | "ctaText" | "destinationUrl";
export type CreativeFormValues = Record<CreativeFieldName, string>;

export type CreativeFormState = {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Partial<Record<CreativeFieldName, string>>;
  values?: CreativeFormValues;
};
export const initialCreativeState: CreativeFormState = { status: "idle" };

export type ParsedCreative = { headline: string; body: string; ctaText: string | null; destinationUrl: string };
export type CreativeParse =
  | { ok: true; value: ParsedCreative }
  | { ok: false; errors: Partial<Record<CreativeFieldName, string>> };

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0009\u000b-\u001f\u007f]/; // new line allowed (body)

export function readCreativeValues(fd: FormData): CreativeFormValues {
  const get = (k: string, max: number): string => {
    const v = fd.get(k);
    return typeof v === "string" ? v.slice(0, max) : "";
  };
  // +1: limit se lamba text ko chupke se kaatne ki jagah error dikhana hai.
  return {
    headline: get("headline", HEADLINE_MAX + 1),
    body: get("body", BODY_MAX + 1),
    ctaText: get("ctaText", CTA_MAX + 1),
    destinationUrl: get("destinationUrl", 2100),
  };
}

export function parseCreativeForm(values: CreativeFormValues): CreativeParse {
  const errors: Partial<Record<CreativeFieldName, string>> = {};
  const headline = values.headline.replace(/\s+/g, " ").trim();
  const body = values.body.replace(/\r\n/g, "\n").trim();
  const ctaText = values.ctaText.replace(/\s+/g, " ").trim();
  const destinationUrl = values.destinationUrl.trim();

  if (headline.length === 0) errors.headline = "Enter a headline.";
  else if (headline.length > HEADLINE_MAX) errors.headline = `Use at most ${HEADLINE_MAX} characters.`;
  else if (CONTROL_CHARS.test(headline)) errors.headline = "Remove special control characters.";

  if (body.length === 0) errors.body = "Enter the ad text.";
  else if (body.length > BODY_MAX) errors.body = `Use at most ${BODY_MAX} characters.`;
  else if (CONTROL_CHARS.test(body)) errors.body = "Remove special control characters.";

  if (ctaText.length > CTA_MAX) errors.ctaText = `Use at most ${CTA_MAX} characters.`;
  else if (CONTROL_CHARS.test(ctaText)) errors.ctaText = "Remove special control characters.";

  const urlError = checkHttpsUrl(destinationUrl);
  if (urlError) errors.destinationUrl = urlError;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { headline, body, ctaText: ctaText.length > 0 ? ctaText : null, destinationUrl } };
}

/* ---------------- Creative status ---------------- */
export const CREATIVE_STATUSES = ["draft", "pending_review", "approved", "rejected", "paused", "archived"] as const;
export type CreativeStatus = (typeof CREATIVE_STATUSES)[number];

export function isCreativeStatus(v: unknown): v is CreativeStatus {
  return typeof v === "string" && (CREATIVE_STATUSES as readonly string[]).includes(v);
}

export const CREATIVE_STATUS_LABELS: Record<CreativeStatus, string> = {
  draft: "Draft",
  pending_review: "Waiting for review",
  approved: "Approved",
  rejected: "Rejected",
  paused: "Paused",
  archived: "Archived",
};

export type CreativeAction = "submit" | "withdraw" | "reopen" | "archive";

// Database trigger (day-3-5) ke allowed badlav: draft->pending_review, pending_review->draft, rejected->draft, ... ->archived
export const CREATIVE_ACTIONS: Record<CreativeAction, { from: readonly CreativeStatus[]; to: CreativeStatus; label: string }> = {
  submit: { from: ["draft"], to: "pending_review", label: "Send for review" },
  withdraw: { from: ["pending_review"], to: "draft", label: "Take back to draft" },
  reopen: { from: ["rejected"], to: "draft", label: "Move back to draft" },
  archive: { from: ["draft", "rejected", "approved", "paused"], to: "archived", label: "Archive" },
};

export function isCreativeAction(v: unknown): v is CreativeAction {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(CREATIVE_ACTIONS, v);
}

export function availableCreativeActions(status: CreativeStatus): CreativeAction[] {
  return (Object.keys(CREATIVE_ACTIONS) as CreativeAction[]).filter((a) => CREATIVE_ACTIONS[a].from.includes(status));
}

export type Creative = {
  id: string;
  campaignId: string;
  headline: string;
  body: string;
  ctaText: string | null;
  destinationUrl: string;
  status: CreativeStatus;
  rejectionReason: string | null;
};

/** Database row (unknown) -> Creative. Shape galat ho toh null (kabhi crash nahi). */
export function toCreative(row: unknown): Creative | null {
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
  };
}
