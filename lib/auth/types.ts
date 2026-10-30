// Auth form ka shared state. Password kabhi state me wapas nahi bheja jata.
export type AuthFormState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<"email" | "password" | "confirmPassword", string>>;
  email?: string;
  needsVerification?: boolean;
};

export const initialAuthState: AuthFormState = { status: "idle" };
