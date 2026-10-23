// Database error ko friendly message me badalte hain. Raw message/details kabhi user ko nahi bhejte.
type DbError = { code?: string | null; hint?: string | null } | null | undefined;

const HINT_MESSAGES: Record<string, string> = {
  resume_needs_approved_creative: "This campaign cannot be resumed until it has at least one approved creative.",
  resume_campaign_ended: "This campaign's end date has passed. Change the end date before resuming.",
  campaign_limit_reached: "You have reached the limit of 50 campaigns. Archive an old campaign first.",
};

export function mapDbError(error: DbError): string {
  if (error?.hint && HINT_MESSAGES[error.hint]) return HINT_MESSAGES[error.hint];
  switch (error?.code) {
    case "42501":
      return "That change is not allowed for this campaign right now.";
    case "23514":
    case "22P02":
    case "22007":
    case "22008":
      return "One of the values is not allowed. Please check the form and try again.";
    case "23505":
      return "That already exists.";
    default:
      return "Something went wrong. Please try again.";
  }
}

/** Server log me sirf error code (message/details nahi). */
export function logDbError(action: string, error: DbError): void {
  console.error(`[campaigns] ${action} failed`, { code: error?.code ?? null, hint: error?.hint ?? null });
}
