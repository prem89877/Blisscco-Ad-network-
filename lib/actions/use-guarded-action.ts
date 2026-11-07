"use client";

import { startTransition, useActionState, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_ACTION_TIMEOUT_MS, createActionGuard, type GuardState } from "./guard";

type Options<S extends GuardState> = {
  timeoutMs?: number;
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
    }),
  );
  // React ke type `Awaited<S>` maangte hain; S ek generic hai, isliye yahan ek jagah cast (runtime me S aur Awaited<S> same hain).
  const [rawState, formAction, pending] = useActionState<S, FormData>(
    guard.run as unknown as (state: Awaited<S>, payload: FormData) => Promise<S>,
    initialState as unknown as Awaited<S>,
  );
  const state = rawState as unknown as S;
  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      if (!guard.tryBegin()) event.preventDefault();
    },
    [guard],
  );
  // Forms jahan galti par bhari hui cheezein (file, select, text) khali nahi honi chahiye.
  // React 19 `<form action={fn}>` ke baad poora form reset kar deta hai; file inputs wapas bhare nahi ja sakte.
  // Yahan hum khud FormData bana ke action chalate hain (reset nahi hota). Lock pehle jaisa: tryBegin().
  const onSubmitKeepFields = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!guard.tryBegin()) return;
      const formData = new FormData(event.currentTarget);
      startTransition(() => {
        formAction(formData);
      });
    },
    [guard, formAction],
  );
  return { state, formAction, pending, onSubmit, onSubmitKeepFields };
}
