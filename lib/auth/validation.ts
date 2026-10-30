// Server-side validation (asli check yahi hai; browser ki checking sirf suvidha ke liye).
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX_BYTES = 72; // bcrypt limit

export function normalizeEmail(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

// Password trim NAHI karte (spaces valid ho sakte hain).
export function readPassword(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

export function validateEmail(email: string): string | undefined {
  if (!email) return "Enter your email address.";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Enter a valid email address.";
  }
  return undefined;
}

export function validateNewPassword(password: string): string | undefined {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return `Use at most ${PASSWORD_MAX_BYTES} bytes. Letters with accents and emoji take more than one byte, so try a shorter password.`;
  }
  return undefined;
}
