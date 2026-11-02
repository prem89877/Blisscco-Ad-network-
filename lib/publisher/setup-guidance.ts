// Day 29 Part 2: publisher setup guidance. PURE module: no database, no clock (now comes from outside), no secrets.
// It only reads what the publisher page already loads: the publisher row (status, saved details) and the key LIST
// (prefix / hint / status / dates, never a full key). A step is "done" only when that data proves it. Nothing is invented.

import { keyIsUsable, type PublisherKey } from "@/lib/publisher/keys";
import type { MyPublisher } from "@/lib/publisher/publisher";
import type { IntegrationStatus } from "@/lib/types";

export const GUIDE_HREF = "/dashboard/publisher/guide";

/** done = proven by saved data. next = the step to do now. waiting = needs someone else. blocked = cannot continue. locked = an earlier step comes first. unknown = data could not be loaded. */
export type SetupState = "done" | "next" | "waiting" | "blocked" | "locked" | "unknown";

export type SetupStepId = "platform" | "approval" | "key" | "first-use";

export type SetupStep = {
  id: SetupStepId;
  title: string;
  state: SetupState;
  /** Visible text label for the state (never colour alone). */
  label: string;
  detail: string;
  /** What the person should do now, or null when there is nothing to do. */
  action: string | null;
  /** Optional link for the action (an existing route). */
  href: string | null;
};

export const SETUP_STEP_ORDER: readonly SetupStepId[] = ["platform", "approval", "key", "first-use"];

/**
 * Setup status from existing data only.
 * `keys` is null when the page did not load keys (account not active/suspended) or the load failed.
 */
export function buildSetupSteps(pub: MyPublisher | null, keys: PublisherKey[] | null, now: Date): SetupStep[] {
  const platform: SetupStep = pub
    ? { id: "platform", title: "Platform details", state: "done", label: "Saved", detail: "Your platform details are saved.", action: null, href: null }
    : {
        id: "platform",
        title: "Platform details",
        state: "next",
        label: "Not saved yet",
        detail: "Blisscco does not have your platform details yet.",
        action: "Fill in the Set up your platform form on this page.",
        href: null,
      };

  let approval: SetupStep;
  if (!pub) {
    approval = { id: "approval", title: "Account approval", state: "locked", label: "Not started", detail: "Approval starts after you save your platform details.", action: null, href: null };
  } else if (pub.status === "pending") {
    approval = {
      id: "approval",
      title: "Account approval",
      state: "waiting",
      label: "Waiting for approval",
      detail: "Our team approves accounts by hand. No review time is promised.",
      action: "Nothing to do yet. You can create keys once the account is approved.",
      href: null,
    };
  } else if (pub.status === "active") {
    approval = { id: "approval", title: "Account approval", state: "done", label: "Approved", detail: "Your account is approved.", action: null, href: null };
  } else {
    approval = {
      id: "approval",
      title: "Account approval",
      state: "blocked",
      label: "Suspended",
      detail: "Your account is suspended, so your keys do not work.",
      action: "Please contact support. You can still revoke keys.",
      href: null,
    };
  }

  let key: SetupStep;
  if (!pub || pub.status === "pending") {
    key = { id: "key", title: "API key", state: "locked", label: "After approval", detail: "Keys can be created once your account is approved.", action: null, href: null };
  } else if (pub.status === "suspended") {
    key = { id: "key", title: "API key", state: "blocked", label: "Not available", detail: "New keys cannot be created while the account is suspended.", action: null, href: null };
  } else if (keys === null) {
    key = { id: "key", title: "API key", state: "unknown", label: "Could not be loaded", detail: "Your keys could not be loaded, so their status is not shown.", action: "Refresh the page.", href: null };
  } else {
    const usable = keys.filter((k) => keyIsUsable(k, now)).length;
    if (usable > 0) {
      key = {
        id: "key",
        title: "API key",
        state: "done",
        label: usable === 1 ? "1 active key" : `${usable} active keys`,
        detail: "You have a key that can call the API. The full key is never shown again, only its start and last 4 characters.",
        action: null,
        href: null,
      };
    } else {
      key = {
        id: "key",
        title: "API key",
        state: "next",
        label: "No active key",
        detail: keys.length > 0 ? "Your earlier keys are revoked or expired." : "You have not created a key yet.",
        action: "Create a key in the API keys panel, then copy it into your server settings. It is shown only once.",
        href: null,
      };
    }
  }

  let firstUse: SetupStep;
  if (key.state !== "done" || keys === null) {
    firstUse = { id: "first-use", title: "First request", state: "locked", label: "After you have a key", detail: "This step starts once you have an active key.", action: null, href: null };
  } else if (keys.some((k) => k.lastUsedAt !== null)) {
    firstUse = {
      id: "first-use",
      title: "First request",
      state: "done",
      label: "Key used",
      detail: "Blisscco has seen a request made with one of your keys (see Last used in your key list). This does not show that an ad was displayed.",
      action: null,
      href: null,
    };
  } else {
    firstUse = {
      id: "first-use",
      title: "First request",
      state: "next",
      label: "Not used yet",
      detail: "None of your keys has been used yet.",
      action: "Put the key on your server and request an ad as in the integration guide.",
      href: GUIDE_HREF,
    };
  }

  return [platform, approval, key, firstUse];
}

export type PropertyGuidance = {
  /** Short plain-language label for the badge (title / screen reader text). */
  short: string;
  /** What the status means. */
  meaning: string;
  /** The next action when the status is incomplete, otherwise null. */
  nextAction: string | null;
};

const PROPERTY_GUIDANCE: Record<IntegrationStatus, PropertyGuidance> = {
  Demo: {
    short: "Sample data",
    meaning: "Sample metrics for illustration only. Not a live integration.",
    nextAction: null,
  },
  "Pending Integration": {
    short: "Waiting for integration",
    meaning: "Waiting for the publisher to integrate. No ad requests yet, so there are no numbers to show.",
    nextAction: "Put your publisher key on your server, then request an ad as described in the integration guide.",
  },
  "Not Connected": {
    short: "Not connected",
    meaning: "Not connected. No data to show.",
    nextAction: "Create a publisher key on the Publisher page, then follow the integration guide.",
  },
};

export function propertyGuidance(status: IntegrationStatus): PropertyGuidance {
  return PROPERTY_GUIDANCE[status];
}

/** Only a real or sample-complete status needs no action. Pending and Not Connected are incomplete. */
export function propertyIsIncomplete(status: IntegrationStatus): boolean {
  return PROPERTY_GUIDANCE[status].nextAction !== null;
}
