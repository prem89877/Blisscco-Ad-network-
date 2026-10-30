"use client";

import { useActionState, useState } from "react";
import { createKey, revokeKey, rotateKey } from "@/app/dashboard/publisher/actions";
import { EXPIRY_CHOICES, KEY_LABEL_MAX, initialKeyState, keyIsUsable, type KeyActionState, type PublisherKey } from "@/lib/publisher/keys";
import { formatDate } from "@/lib/format";

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";

// Create aur Rotate ek hi form-state se chalte hain: nayi key (secret) ek hi jagah ek baar dikhti hai.
async function issueAction(prev: KeyActionState, formData: FormData): Promise<KeyActionState> {
  return formData.has("rotateKeyId") ? rotateKey(prev, formData) : createKey(prev, formData);
}

function RotateButton({ keyId, formAction, pending }: { keyId: string; formAction: (fd: FormData) => void; pending: boolean }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${btn} border-line text-mist/80 hover:bg-white/5`}>
        Rotate
      </button>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="rotateKeyId" value={keyId} />
      <p className="max-w-xs text-xs text-mist/70">
        Creates a new key with the same name. The old key keeps working until you revoke it, so you can switch your server first.
      </p>
      <select name="expiry" defaultValue="90" aria-label="New key expires" className="min-h-11 rounded-lg border border-line bg-ink px-3 py-2 text-sm text-mist">
        {EXPIRY_CHOICES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} aria-busy={pending} className={`${btn} border-aqua/60 text-aqua hover:bg-aqua/10`}>
          {pending ? "Creating…" : "Create new key"}
        </button>
        <button type="button" disabled={pending} onClick={() => setOpen(false)} className={`${btn} border-line text-mist/80`}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function RevokeButton({ keyId }: { keyId: string }) {
  const [state, formAction, pending] = useActionState(revokeKey, initialKeyState);
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className={`${btn} border-red-400/60 text-red-300 hover:bg-red-500/10`}>
        Revoke
      </button>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="keyId" value={keyId} />
      <p className="text-xs text-mist/70">Apps using this key will stop working. Revoke it?</p>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} aria-busy={pending} className={`${btn} border-red-400/60 text-red-300 hover:bg-red-500/10`}>
          {pending ? "Revoking…" : "Yes, revoke"}
        </button>
        <button type="button" autoFocus disabled={pending} onClick={() => setConfirming(false)} className={`${btn} border-line text-mist/80`}>
          Cancel
        </button>
      </div>
      {state.status === "error" && state.message && (
        <p role="alert" className="text-sm text-red-300">
          {state.message}
        </p>
      )}
    </form>
  );
}

function KeyStatus({ k, now }: { k: PublisherKey; now: Date }) {
  if (k.status === "revoked") return <span className="text-red-300">Revoked</span>;
  if (!keyIsUsable(k, now)) return <span className="text-amber-300">Expired</span>;
  return <span className="text-aqua">Active</span>;
}

/** Publisher ki keys: nayi banao (ek baar dikhti hai), list dekho, band karo. */
export default function PublisherKeyManager({ keys, nowIso, canCreate = true }: { keys: PublisherKey[]; nowIso: string; canCreate?: boolean }) {
  const [state, formAction, pending] = useActionState(issueAction, initialKeyState);
  // "Hide" dabane par secret screen se hat jata hai (sirf is page ki memory me tha, kahin save nahi).
  const [hiddenKey, setHiddenKey] = useState<string | null>(null);
  // Kaunsi key copy hui (text se), taaki nayi key banne par "Copied" apne aap hat jaye.
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyFailedKey, setCopyFailedKey] = useState<string | null>(null);
  const now = new Date(nowIso);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(text);
      setCopyFailedKey(null);
    } catch {
      setCopiedKey(null);
      setCopyFailedKey(text);
    }
  }

  return (
    <div className="space-y-6">
      {state.status === "success" && state.newKey && state.newKey !== hiddenKey && (
        <div role="status" className="rounded-xl border border-aqua/50 bg-aqua/5 p-4">
          <p className="text-sm font-medium text-aqua">{state.message}</p>
          <code translate="no" className="mt-3 block break-all rounded-lg bg-ink px-3 py-3 text-sm text-mist">{state.newKey}</code>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => copy(state.newKey ?? "")} className={`${btn} border-aqua/60 text-aqua hover:bg-aqua/10`}>
              {copiedKey === state.newKey ? "Copied" : "Copy key"}
            </button>
            <button type="button" onClick={() => setHiddenKey(state.newKey ?? null)} className={`${btn} border-line text-mist/80`}>
              I have saved it, hide
            </button>
            <span className="text-xs text-mist/60">Keep it on your server only. Never put it in a website or app that users can open.</span>
            {copyFailedKey === state.newKey && (
              <span role="alert" className="w-full text-sm text-red-300">
                Could not copy automatically. Select the key above and copy it by hand. It will not be shown again.
              </span>
            )}
          </div>
        </div>
      )}
      {state.status === "error" && state.message && (
        <p role="alert" className="rounded-lg border border-red-400/60 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {state.message}
        </p>
      )}

      {canCreate ? (
      <form action={formAction} autoComplete="off" className="grid max-w-xl gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="key-label" className="mb-1.5 block text-sm font-medium text-mist">
            Name for this key (optional)
          </label>
          <input
            id="key-label"
            name="label"
            maxLength={KEY_LABEL_MAX}
            placeholder="e.g. Production server"
            className="min-h-11 w-full rounded-lg border border-line bg-ink px-3.5 py-2 text-base text-mist placeholder:text-mist/40"
          />
        </div>
        <div>
          <label htmlFor="key-expiry" className="mb-1.5 block text-sm font-medium text-mist">
            Expires
          </label>
          <select id="key-expiry" name="expiry" defaultValue="90" className="min-h-11 w-full rounded-lg border border-line bg-ink px-3.5 py-2 text-base text-mist">
            {EXPIRY_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <button type="submit" disabled={pending} aria-busy={pending} className={`${btn} border-transparent bg-violet px-5 text-base text-white hover:bg-[#6444F0]`}>
            {pending ? "Creating…" : "Create new key"}
          </button>
        </div>
      </form>
      ) : (
        <p className="text-sm text-mist/70">New keys cannot be created right now. You can still revoke the keys below.</p>
      )}

      <div>
        <h3 className="font-display text-base font-semibold">Your keys</h3>
        <p className="mt-1 text-xs text-mist/60">
          Only the start and the last 4 characters of each key are shown. They identify a key but cannot be used to call the API, and the full key can never be shown again.
        </p>
        {keys.length === 0 ? (
          <p className="mt-2 text-sm text-mist/70">No keys yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {keys.map((k) => (
              <li key={k.id} className="rounded-xl border border-line p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium text-mist">{k.label ?? "Unnamed key"}</p>
                    <p className="mt-1 break-all font-mono text-xs text-mist/70">
                      {k.prefix}…{k.hint ?? ""}
                    </p>
                    <p className="mt-1 text-xs text-mist/60">
                      <KeyStatus k={k} now={now} /> · Created {formatDate(k.createdAt.slice(0, 10))}
                      {k.expiresAt ? ` · Expires ${formatDate(k.expiresAt.slice(0, 10))}` : " · No expiry"}
                      {k.lastUsedAt ? ` · Last used ${formatDate(k.lastUsedAt.slice(0, 10))}` : " · Never used"}
                    </p>
                  </div>
                  {k.status === "active" && (
                    <div className="flex flex-wrap gap-2">
                      {canCreate && keyIsUsable(k, now) && <RotateButton keyId={k.id} formAction={formAction} pending={pending} />}
                      <RevokeButton keyId={k.id} />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
