"use client";

import { startTransition, useActionState, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_ACTION_TIMEOUT_MS, createActionGuard, sendDiagReport, type GuardState } from "./guard";

type Options<S extends GuardState> = {
  timeoutMs?: number;
  /** Diagnostics me button ka naam (optional). Na do toh dabaye gaye submit button ka text use hota hai. */
  label?: string;
  errorState?: (prev: S, message: string, formData: FormData) => S;
};

/**
 * useActionState + shared guard (lib/actions/guard.ts). Form par `action={formAction}` aur `onSubmit={onSubmit}` dono lagao.
 *  - pending: server ka jawab aane (ya had / error) tak true; uske baad hamesha false.
 *  - onSubmit: tezi se do tap par doosra submit rok deta hai (disabled button ke render hone se pehle ka gap).
 *  - had / network error par router.refresh() server ki asli state dikha deta hai (manual reload nahi).
 */
export function useGuardedAction<S extends GuardState>(
  action: (prev: S, formData: FormData) => Promise<S>,
  initialState: S,
  options: Options<S> = {},
) {
  const router = useRouter();
  // Diagnostics: kaun sa button dabaya gaya (submit button ka text, chhota). Sirf log label ke liye; kuch aur nahi.
  const labelRef = useRef(options.label ?? "");
  // Props (jaise Pause / Resume) badal sakte hain: guard hamesha sabse naya action bulata hai.
  const actionRef = useRef(action);
  useEffect(() => {
    actionRef.current = action;
  }, [action]);
  const [guard] = useState(() =>
    createActionGuard<S>({
      action: (prev, formData) => actionRef.current(prev, formData),
      refresh: () => router.refresh(),
      timeoutMs: options.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS,
      errorState: options.errorState,
      // Slow (5s+) / timeout / network fail par /api/diag ko beacon: Vercel logs me "[diag] event=action_slow ..." aata hai.
      report: (event, d) => sendDiagReport(event, { label: labelRef.current, ms: d.ms, outcome: d.outcome, errName: d.errName, errMsg: d.errMsg }),
    }),
  );
  // React ke type `Awaited<S>` maangte hain; S ek generic hai, isliye yahan ek jagah cast (runtime me S aur Awaited<S> same hain).
  const [rawState, formAction, pending] = useActionState<S, FormData>(
    guard.run as unknown as (state: Awaited<S>, payload: FormData) => Promise<S>,
    initialState as unknown as Awaited<S>,
  );
  const state = rawState as unknown as S;
  const rememberButton = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      if (options.label) return;
      const submitter = (event.nativeEvent as SubmitEvent | undefined)?.submitter;
      const text = submitter?.textContent?.trim();
      if (text) labelRef.current = text.slice(0, 60);
    },
    [options.label],
  );
  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      rememberButton(event);
      if (!guard.tryBegin()) event.preventDefault();
    },
    [guard, rememberButton],
  );
  // Forms jahan galti par bhari hui cheezein (file, select, text) khali nahi honi chahiye.
  // React 19 `<form action={fn}>` ke baad poora form reset kar deta hai; file inputs wapas bhare nahi ja sakte.
  // Yahan hum khud FormData bana ke action chalate hain (reset nahi hota). Lock pehle jaisa: tryBegin().
  const onSubmitKeepFields = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      rememberButton(event);
      if (!guard.tryBegin()) return;
      const formData = new FormData(event.currentTarget);
      startTransition(() => {
        formAction(formData);
      });
    },
    [guard, formAction, rememberButton],
  );
  return { state, formAction, pending, onSubmit, onSubmitKeepFields };
}
