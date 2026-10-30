// Day 14 Part 5: STATEFUL nakla paisa-ka-khata (sirf tests ke liye). Asli Supabase / production kabhi nahi chhuta.
//
// Ye NODE me un SQL functions ka behaviour dohrata hai jo Day 13 me likhe gaye (SQL files padhkar):
//   day-13-1  private.ledger_append / ledger_reverse + constraints + unique indexes (key, ek serve = ek type, ek entry = ek reversal)
//   day-13-4  private.ledger_record_serve (record_ad_serve ke andar, spend ke BAAD) + ledger_reverse_entry / ledger_add_adjustment (service_role only)
//   day-13-9  request_my_payout / admin_review_payout_request / admin_mark_payout_paid / get_my_payout_summary / get_my_payout_requests / admin_list_payout_requests
//   day-13-12 guard: requester = publisher ka apna profile, review trail frozen, self-review nahi
//   day-13-15 reversal / adjustment publisher row lock (yahan serial execution se mil jata hai)
// Grants bhi modelled hain: ledger admin functions SIRF service_role ko; payout functions SIRF authenticated (login session) ko.
//
// LIMIT (saaf): ye SQL ka MODEL hai, SQL khud nahi. Postgres ka asli lock / race / trigger behaviour yahan SAABIT NAHI hota.
// Uske liye SQL tests (day-13-3/6/8/11/14) denim TEST project par chalte hain. Yahan jo saabit hota hai wo hai:
//   asli TypeScript code (serve route, ledger service, payout actions, data helpers) is SQL-niyam ke saath sahi baat karta hai aur sahi nateeja dikhata hai.
//
// Ye file SABSE PEHLE import honi chahiye: `next/cache`, `@/lib/auth/session`, `@/lib/supabase/server` ke nakli modules yahin lagte hain.
// Saari ids nakli hain; koi asli credential nahi.

import { formatMoney, parseMoney } from "@/lib/ledger/decimal";
import { FakeAdDb, FakeSqlError, makeKey, uuid, type ServeRecordedEvent } from "../ads/fake-ad-db";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module") as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };

type Reply = { data: unknown; error: { code?: string; message?: string } | null };
const ok = (data: unknown): Reply => ({ data, error: null });
const fail = (code: string, message: string): Reply => ({ data: null, error: { code, message } });

const KEY_RE = /^[A-Za-z0-9_.:-]{8,200}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERVE_REF_RE = /^bsr_[0-9a-f]{40}$/;
const MAX_UNITS = 99_999_999_999_999n;

export type Role = "advertiser" | "publisher" | "admin";
export type EntryType = "advertiser_charge" | "publisher_earning" | "platform_revenue" | "adjustment" | "reversal";
export type Account = "advertiser" | "publisher" | "platform";

export type LedgerEntry = {
  id: number;
  entryId: string;
  type: EntryType;
  account: Account;
  amount: bigint; // units (1 unit = 0.0001 USD)
  advertiserId: string | null;
  publisherId: string | null;
  campaignId: string | null;
  sourceType: "serve" | "manual";
  sourceRef: string | null;
  key: string;
  reversesEntryId: number | null;
  reason: string | null;
  createdBy: string | null;
};

export type PayoutStatus = "requested" | "approved" | "rejected" | "paid";
export type PayoutRow = {
  id: string;
  publisherId: string;
  amount: bigint;
  status: PayoutStatus;
  requestKey: string;
  requestedBy: string;
  reviewedBy: string | null;
  rejectionReason: string | null;
  paidBy: string | null;
  seq: number;
};
export type PayoutEvent = { payoutId: string; from: PayoutStatus | null; to: PayoutStatus; actor: string; actorRole: "publisher" | "admin"; reason: string | null };

type Profile = { role: Role; status: "active" | "suspended" };
type PublisherRow = { profileId: string; status: "pending" | "active" | "suspended"; name: string };

/** Login session ka nakli roop. role / status HAMESHA model ke profiles se aate hain (asli getCurrentAccount ki tarah database se). */
export const session: { model: FinancialModel | null; userId: string | null; redirects: string[]; revalidated: string[] } = {
  model: null,
  userId: null,
  redirects: [],
  revalidated: [],
};

export class FinancialModel {
  ledgerEnabled = true;
  /** null = batwara tay nahi (project me abhi koi percentage defined nahi). */
  shareBps: number | null = 7000;
  /** true => ledger write fail (database error): record_ad_serve poora rollback hona chahiye. */
  failLedgerWrites = false;

  entries: LedgerEntry[] = [];
  payouts: PayoutRow[] = [];
  events: PayoutEvent[] = [];
  /** Sab rpc calls jo (service ya session) client se aayi. */
  calls: { client: "service" | "session"; name: string; args: Record<string, unknown> }[] = [];

  private profiles = new Map<string, Profile>();
  private publishers = new Map<string, PublisherRow>(); // publisher id -> row
  private nextEntryId = 1;
  private nextPayoutSeq = 1;

  constructor(readonly db: FakeAdDb) {
    db.onServeRecorded = (e) => this.ledgerRecordServe(e);
  }

  // ----- setup -----
  addAdmin(status: Profile["status"] = "active"): string {
    const id = uuid("f");
    this.profiles.set(id, { role: "admin", status });
    return id;
  }
  addAdvertiserProfile(): string {
    const id = uuid("f");
    this.profiles.set(id, { role: "advertiser", status: "active" });
    return id;
  }
  /** Ek publisher: FakeAdDb me publisher + api key, aur yahan profile + publishers row (payout ke liye). */
  addPublisher(keyChar: string, name = `Publisher ${keyChar}`): { publisherId: string; profileId: string; key: string } {
    const dbPub = this.db.addPublisher();
    const key = makeKey(keyChar);
    this.db.addKey(dbPub.id, key);
    const profileId = uuid("f");
    this.profiles.set(profileId, { role: "publisher", status: "active" });
    this.publishers.set(dbPub.id, { profileId, status: "active", name });
    return { publisherId: dbPub.id, profileId, key };
  }
  setProfileStatus(profileId: string, status: Profile["status"]): void {
    const p = this.profiles.get(profileId);
    if (!p) throw new Error("test: unknown profile");
    p.status = status;
  }
  setRole(profileId: string, role: Role): void {
    const p = this.profiles.get(profileId);
    if (!p) throw new Error("test: unknown profile");
    p.role = role;
  }
  setPublisherStatus(publisherId: string, status: PublisherRow["status"]): void {
    const p = this.publishers.get(publisherId);
    if (!p) throw new Error("test: unknown publisher");
    p.status = status;
  }
  signIn(profileId: string | null): void {
    session.model = this;
    session.userId = profileId;
  }
  profileOf(userId: string | null): Profile | null {
    return userId === null ? null : (this.profiles.get(userId) ?? null);
  }

  // ----- ledger: reads for tests -----
  entriesOf(type?: EntryType): LedgerEntry[] {
    return type ? this.entries.filter((e) => e.type === type) : [...this.entries];
  }
  sum(pred: (e: LedgerEntry) => boolean): bigint {
    return this.entries.filter(pred).reduce((a, e) => a + e.amount, 0n);
  }
  publisherBalance(publisherId: string): bigint {
    return this.sum((e) => e.account === "publisher" && e.publisherId === publisherId);
  }
  /** Serve se bani entries (adjustment / reversal nahi). */
  serveEntries(serveRef?: string): LedgerEntry[] {
    return this.entries.filter((e) => e.sourceType === "serve" && (serveRef === undefined || e.sourceRef === serveRef));
  }

  // ===========================================================================================================================
  // private.ledger_append (day-13-1 + day-13-4 amount fix)
  private append(a: {
    type: Exclude<EntryType, "reversal">;
    account: Account;
    amount: bigint | null;
    key: string;
    sourceType: "serve" | "manual";
    sourceRef?: string | null;
    advertiserId?: string | null;
    publisherId?: string | null;
    campaignId?: string | null;
    reason?: string | null;
    createdBy?: string | null;
  }): { outcome: "recorded" | "duplicate"; id: number; entryId: string } {
    if (a.amount === null || a.amount > MAX_UNITS || a.amount < -MAX_UNITS) throw new FakeSqlError("22023", "ledger_invalid_amount");
    const row = {
      advertiserId: a.advertiserId ?? null,
      publisherId: a.publisherId ?? null,
      campaignId: a.campaignId ?? null,
      sourceRef: a.sourceRef ?? null,
      reason: a.reason ?? null,
      createdBy: a.createdBy ?? null,
    };
    // CHECK constraints
    const bad =
      !KEY_RE.test(a.key) ||
      a.amount === 0n ||
      (["advertiser_charge", "publisher_earning", "platform_revenue"].includes(a.type) && a.amount < 0n) ||
      (a.type === "advertiser_charge" && a.account !== "advertiser") ||
      (a.type === "publisher_earning" && a.account !== "publisher") ||
      (a.type === "platform_revenue" && a.account !== "platform") ||
      (a.account === "advertiser" && row.advertiserId === null) ||
      (a.account === "publisher" && row.publisherId === null) ||
      (a.type === "advertiser_charge" && row.campaignId === null) ||
      (a.sourceType === "serve" && !SERVE_REF_RE.test(row.sourceRef ?? "")) ||
      (a.sourceType === "manual" && row.sourceRef !== null) ||
      (a.type === "adjustment" && (a.sourceType !== "manual" || row.createdBy === null || row.reason === null || row.reason.trim().length < 3 || row.reason.trim().length > 500));
    if (bad) throw new FakeSqlError("23514", "ledger check constraint");

    // on conflict do nothing: key UNIQUE, ya (source_ref, entry_type) where serve
    let existing = this.entries.find((e) => e.key === a.key);
    if (!existing && a.sourceType === "serve") existing = this.entries.find((e) => e.sourceType === "serve" && e.sourceRef === row.sourceRef && e.type === a.type);
    if (!existing) {
      const entry: LedgerEntry = {
        id: this.nextEntryId++,
        entryId: "",
        type: a.type,
        account: a.account,
        amount: a.amount,
        sourceType: a.sourceType,
        key: a.key,
        reversesEntryId: null,
        ...row,
      };
      entry.entryId = `00000000-0000-4000-8000-${String(entry.id).padStart(12, "0")}`;
      this.entries.push(entry);
      return { outcome: "recorded", id: entry.id, entryId: entry.entryId };
    }
    const same =
      existing.key === a.key &&
      existing.type === a.type &&
      existing.account === a.account &&
      existing.amount === a.amount &&
      existing.sourceType === a.sourceType &&
      existing.sourceRef === row.sourceRef &&
      existing.advertiserId === row.advertiserId &&
      existing.publisherId === row.publisherId &&
      existing.campaignId === row.campaignId;
    if (!same) throw new FakeSqlError("23505", "ledger_idempotency_conflict");
    return { outcome: "duplicate", id: existing.id, entryId: existing.entryId };
  }

  // private.ledger_reverse (day-13-1) + guard_ledger_entry (reversal ka reversal nahi, poora ulta)
  private reverse(entryId: number, key: string, reason: string, actor: string): { outcome: "recorded" | "duplicate"; id: number; entryId: string } {
    const o = this.entries.find((e) => e.id === entryId);
    if (!o) throw new FakeSqlError("23503", "ledger_reversal_target_missing");
    // guard_ledger_entry (BEFORE INSERT) conflict check se PEHLE chalta hai: reversal ka reversal nahi.
    if (o.type === "reversal") throw new FakeSqlError("23514", "ledger_reversal_of_reversal");
    const sameKey = this.entries.find((e) => e.key === key);
    const already = this.entries.find((e) => e.reversesEntryId === o.id);
    if (sameKey || already) {
      if (!already || already.key !== key) throw new FakeSqlError("23505", "ledger_idempotency_conflict");
      return { outcome: "duplicate", id: already.id, entryId: already.entryId };
    }
    const entry: LedgerEntry = {
      id: this.nextEntryId++,
      entryId: "",
      type: "reversal",
      account: o.account,
      amount: -o.amount,
      advertiserId: o.advertiserId,
      publisherId: o.publisherId,
      campaignId: o.campaignId,
      sourceType: "manual",
      sourceRef: null,
      key,
      reversesEntryId: o.id,
      reason,
      createdBy: actor,
    };
    entry.entryId = `00000000-0000-4000-8000-${String(entry.id).padStart(12, "0")}`;
    this.entries.push(entry);
    return { outcome: "recorded", id: entry.id, entryId: entry.entryId };
  }

  // private.ledger_record_serve (day-13-4): record_ad_serve ke andar, spend ke baad. Koi error => poora serve rollback (FakeAdDb hook).
  ledgerRecordServe(e: ServeRecordedEvent): void {
    if (!this.ledgerEnabled) return;
    if (this.failLedgerWrites) throw new FakeSqlError("XX000", "test: ledger write failed");
    if (!SERVE_REF_RE.test(e.serveRef)) throw new FakeSqlError("22023", "ledger_serve_ref_missing");
    const adv = this.advertiserOfCampaign(e.campaignId);
    if (adv === null) throw new FakeSqlError("23503", "ledger_campaign_missing");
    const amount = BigInt(Math.round(e.unitUsd * 10_000));
    this.append({ type: "advertiser_charge", account: "advertiser", amount, key: `serve:${e.serveRef}:advertiser_charge`, sourceType: "serve", sourceRef: e.serveRef, advertiserId: adv, publisherId: e.publisherId, campaignId: e.campaignId });
    if (this.shareBps !== null) {
      const pub = (amount * BigInt(this.shareBps)) / 10_000n; // positive: floor = trunc(.., 4)
      const plat = amount - pub;
      if (pub > 0n) this.append({ type: "publisher_earning", account: "publisher", amount: pub, key: `serve:${e.serveRef}:publisher_earning`, sourceType: "serve", sourceRef: e.serveRef, publisherId: e.publisherId, campaignId: e.campaignId });
      if (plat > 0n) this.append({ type: "platform_revenue", account: "platform", amount: plat, key: `serve:${e.serveRef}:platform_revenue`, sourceType: "serve", sourceRef: e.serveRef, campaignId: e.campaignId });
    }
  }
  private advertiserOfCampaign(campaignId: string): string | null {
    const camps = (this.db as unknown as { campaigns: Map<string, { advertiserId: string }> }).campaigns;
    return camps.get(campaignId)?.advertiserId ?? null;
  }

  // ===========================================================================================================================
  // public.ledger_reverse_entry / ledger_add_adjustment (service_role only)
  private isActiveAdmin(id: unknown): boolean {
    const p = typeof id === "string" ? this.profiles.get(id) : undefined;
    return !!p && p.role === "admin" && p.status === "active";
  }
  private wrapLedger(fn: () => { outcome: string; id: number; entryId: string }): Record<string, unknown> {
    try {
      const r = fn();
      return { outcome: r.outcome, id: r.id, entry_id: r.entryId };
    } catch (e) {
      if (!(e instanceof FakeSqlError)) throw e;
      if (["40001", "40P01", "55P03", "57014"].includes(e.code)) throw e;
      const hint = e.message;
      return { outcome: hint === "ledger_idempotency_conflict" ? "conflict" : hint === "ledger_reversal_target_missing" ? "not_found" : hint === "ledger_invalid_amount" ? "invalid" : "rejected" };
    }
  }
  private ledgerReverseEntry(a: Record<string, unknown>): Record<string, unknown> {
    if (!this.isActiveAdmin(a.p_actor)) return { outcome: "forbidden" };
    const reason = String(a.p_reason ?? "").trim();
    const entryId = a.p_entry_id;
    if (typeof entryId !== "number" || !Number.isInteger(entryId) || entryId <= 0 || typeof a.p_idempotency_key !== "string" || !KEY_RE.test(a.p_idempotency_key) || reason.length < 3 || reason.length > 500) {
      return { outcome: "invalid" };
    }
    return this.wrapLedger(() => this.reverse(entryId, a.p_idempotency_key as string, reason, a.p_actor as string));
  }
  private ledgerAddAdjustment(a: Record<string, unknown>): Record<string, unknown> {
    if (!this.isActiveAdmin(a.p_actor)) return { outcome: "forbidden" };
    const reason = String(a.p_reason ?? "").trim();
    const amount = typeof a.p_amount === "string" ? parseMoney(a.p_amount) : null;
    if (
      typeof a.p_account !== "string" ||
      !["advertiser", "publisher", "platform"].includes(a.p_account) ||
      amount === null ||
      (amount.ok && amount.units === 0n) ||
      typeof a.p_idempotency_key !== "string" ||
      !KEY_RE.test(a.p_idempotency_key) ||
      reason.length < 3 ||
      reason.length > 500
    ) {
      return { outcome: "invalid" };
    }
    if (!amount.ok) return { outcome: "invalid" }; // 4 se zyada decimal / badi: ledger_invalid_amount => invalid
    return this.wrapLedger(() =>
      this.append({
        type: "adjustment",
        account: a.p_account as Account,
        amount: amount.units,
        key: a.p_idempotency_key as string,
        sourceType: "manual",
        advertiserId: (a.p_advertiser_id as string | null) ?? null,
        publisherId: (a.p_publisher_id as string | null) ?? null,
        campaignId: (a.p_campaign_id as string | null) ?? null,
        reason,
        createdBy: a.p_actor as string,
      }),
    );
  }

  // ===========================================================================================================================
  // Payout (day-13-9 + day-13-12): saare functions SECURITY DEFINER; ownership auth.uid() se.
  private position(publisherId: string): { ledger: bigint; reserved: bigint; paid: bigint } {
    const ledger = this.publisherBalance(publisherId);
    const mine = this.payouts.filter((p) => p.publisherId === publisherId);
    return {
      ledger,
      reserved: mine.filter((p) => p.status === "requested" || p.status === "approved").reduce((a, p) => a + p.amount, 0n),
      paid: mine.filter((p) => p.status === "paid").reduce((a, p) => a + p.amount, 0n),
    };
  }
  /** available = ledger - reserved - paid, 0 se neeche nahi (get_my_payout_summary jaisa). */
  availableOf(publisherId: string): bigint {
    const p = this.position(publisherId);
    const v = p.ledger - p.reserved - p.paid;
    return v > 0n ? v : 0n;
  }
  private publisherOfProfile(uid: string): [string, PublisherRow] | null {
    for (const [id, row] of this.publishers) if (row.profileId === uid) return [id, row];
    return null;
  }
  private pushEvent(r: PayoutRow, from: PayoutStatus | null, to: PayoutStatus, actor: string, role: "publisher" | "admin", reason: string | null): void {
    this.events.push({ payoutId: r.id, from, to, actor, actorRole: role, reason });
  }
  /** guard_payout_request (BEFORE UPDATE) ka model: galat badlav => exception (rpc error), kuch nahi badalta. */
  private guardedUpdate(r: PayoutRow, next: Partial<PayoutRow> & { status: PayoutStatus }, actor: string): void {
    const ok1 = (r.status === "requested" && (next.status === "approved" || next.status === "rejected")) || (r.status === "approved" && (next.status === "paid" || next.status === "rejected"));
    if (!ok1) throw new FakeSqlError("23514", "payout_invalid_transition");
    if (next.status === "paid" && next.reviewedBy !== undefined && next.reviewedBy !== r.reviewedBy) throw new FakeSqlError("23514", "payout_review_trail_frozen");
    const reviewer = next.reviewedBy ?? r.reviewedBy;
    const payer = next.paidBy ?? r.paidBy;
    if ((reviewer !== null && reviewer === r.requestedBy) || (payer !== null && payer === r.requestedBy)) throw new FakeSqlError("23514", "payout_self_review");
    const from = r.status;
    Object.assign(r, next);
    const reason = next.status === "rejected" ? (next.rejectionReason ?? null) : null;
    this.pushEvent(r, from, next.status, (next.status === "paid" ? r.paidBy : r.reviewedBy) ?? actor, "admin", reason);
  }

  private requestMyPayout(uid: string | null, a: Record<string, unknown>): Reply {
    // p_request_key uuid hai: galat text function chalne se pehle hi database error (22P02).
    if (typeof a.p_request_key !== "string" || !UUID_RE.test(a.p_request_key)) return fail("22P02", "invalid input syntax for type uuid");
    if (uid === null) return ok({ outcome: "forbidden" });
    const found = this.publisherOfProfile(uid);
    const prof = this.profiles.get(uid);
    if (!found || !prof) return ok({ outcome: "forbidden" });
    const [pubId, pub] = found;
    if (prof.status !== "active" || pub.status !== "active") return ok({ outcome: "not_eligible" });
    const parsed = typeof a.p_amount === "string" ? parseMoney(a.p_amount) : null;
    if (parsed === null || !parsed.ok || parsed.units <= 0n) return ok({ outcome: "invalid" });
    const amount = parsed.units;

    const existing = this.payouts.find((p) => p.publisherId === pubId && p.requestKey === a.p_request_key);
    if (existing) {
      return existing.amount === amount
        ? ok({ outcome: "duplicate", id: existing.id, status: existing.status, amount: formatMoney(existing.amount) })
        : ok({ outcome: "conflict" });
    }
    if (this.payouts.some((p) => p.publisherId === pubId && (p.status === "requested" || p.status === "approved"))) return ok({ outcome: "open_request_exists" });
    const pos = this.position(pubId);
    const avail = pos.ledger - pos.reserved - pos.paid;
    if (amount > avail) return ok({ outcome: "insufficient", available: formatMoney(avail > 0n ? avail : 0n) });

    const row: PayoutRow = {
      id: `00000000-0000-4000-9000-${String(this.nextPayoutSeq).padStart(12, "0")}`,
      publisherId: pubId,
      amount,
      status: "requested",
      requestKey: a.p_request_key,
      requestedBy: uid,
      reviewedBy: null,
      rejectionReason: null,
      paidBy: null,
      seq: this.nextPayoutSeq++,
    };
    this.payouts.push(row);
    this.pushEvent(row, null, "requested", uid, "publisher", null);
    return ok({ outcome: "requested", id: row.id, status: "requested", amount: formatMoney(amount) });
  }

  private adminReview(uid: string | null, a: Record<string, unknown>): Reply {
    if (!this.isActiveAdmin(uid)) return fail("42501", "Admin only");
    const reason = String(a.p_reason ?? "").trim();
    if (typeof a.p_request_id !== "string" || (a.p_decision !== "approve" && a.p_decision !== "reject")) return ok({ outcome: "invalid" });
    if (a.p_decision === "reject" && (reason.length < 3 || reason.length > 500)) return ok({ outcome: "invalid" });
    const r = this.payouts.find((p) => p.id === a.p_request_id);
    if (!r) return ok({ outcome: "not_found" });
    const pub = this.publishers.get(r.publisherId);
    const prof = pub ? this.profiles.get(pub.profileId) : undefined;
    if (a.p_decision === "approve" && r.status !== "requested") return ok({ outcome: "invalid_transition", status: r.status });
    if (a.p_decision === "reject" && r.status !== "requested" && r.status !== "approved") return ok({ outcome: "invalid_transition", status: r.status });
    try {
      if (a.p_decision === "reject") {
        this.guardedUpdate(r, { status: "rejected", reviewedBy: uid as string, rejectionReason: reason }, uid as string);
        return ok({ outcome: "rejected", id: r.id, status: "rejected" });
      }
      if (!pub || !prof || prof.status !== "active" || pub.status !== "active") return ok({ outcome: "not_eligible" });
      const pos = this.position(r.publisherId);
      if (pos.ledger < pos.reserved + pos.paid) return ok({ outcome: "insufficient" });
      this.guardedUpdate(r, { status: "approved", reviewedBy: uid as string }, uid as string);
      return ok({ outcome: "approved", id: r.id, status: "approved" });
    } catch (e) {
      if (e instanceof FakeSqlError) return fail(e.code, e.message);
      throw e;
    }
  }

  private adminMarkPaid(uid: string | null, a: Record<string, unknown>): Reply {
    if (!this.isActiveAdmin(uid)) return fail("42501", "Admin only");
    if (typeof a.p_request_id !== "string") return ok({ outcome: "invalid" });
    const r = this.payouts.find((p) => p.id === a.p_request_id);
    if (!r) return ok({ outcome: "not_found" });
    const pub = this.publishers.get(r.publisherId);
    const prof = pub ? this.profiles.get(pub.profileId) : undefined;
    if (r.status !== "approved") return ok({ outcome: "invalid_transition", status: r.status });
    if (!pub || !prof || prof.status !== "active" || pub.status !== "active") return ok({ outcome: "not_eligible" });
    const pos = this.position(r.publisherId);
    if (pos.ledger < pos.reserved + pos.paid) return ok({ outcome: "insufficient" });
    try {
      this.guardedUpdate(r, { status: "paid", paidBy: uid as string }, uid as string);
      return ok({ outcome: "paid", id: r.id, status: "paid" });
    } catch (e) {
      if (e instanceof FakeSqlError) return fail(e.code, e.message);
      throw e;
    }
  }

  private summary(uid: string | null): Reply {
    const found = uid === null ? null : this.publisherOfProfile(uid);
    const prof = this.profileOf(uid);
    if (!found || !prof || prof.status !== "active") return ok([]);
    const [pubId, pub] = found;
    const pos = this.position(pubId);
    return ok([
      {
        currency_code: "USD",
        eligible: pub.status === "active",
        ledger_balance: formatMoney(pos.ledger),
        reserved: formatMoney(pos.reserved),
        paid_out: formatMoney(pos.paid),
        available: formatMoney(this.availableOf(pubId)),
        has_open_request: this.payouts.some((p) => p.publisherId === pubId && (p.status === "requested" || p.status === "approved")),
      },
    ]);
  }

  private rowOut(p: PayoutRow): Record<string, unknown> {
    const at = (n: number) => new Date(Date.UTC(2026, 9, 30, 10, 0, n)).toISOString();
    return {
      id: p.id,
      amount: formatMoney(p.amount),
      status: p.status,
      rejection_reason: p.rejectionReason,
      created_at: at(p.seq),
      reviewed_at: p.reviewedBy ? at(p.seq + 1) : null,
      paid_at: p.paidBy ? at(p.seq + 2) : null,
    };
  }
  private myRequests(uid: string | null, limit: unknown): Reply {
    const found = uid === null ? null : this.publisherOfProfile(uid);
    const prof = this.profileOf(uid);
    if (!found || !prof || prof.status !== "active") return ok([]);
    const n = Math.max(1, Math.min(typeof limit === "number" ? limit : 25, 100));
    return ok(
      this.payouts
        .filter((p) => p.publisherId === found[0])
        .sort((x, y) => y.seq - x.seq)
        .slice(0, n)
        .map((p) => this.rowOut(p)),
    );
  }
  private adminList(uid: string | null, limit: unknown): Reply {
    if (!this.isActiveAdmin(uid)) return ok([]); // admin nahi => 0 rows (kuch leak nahi)
    const n = Math.max(1, Math.min(typeof limit === "number" ? limit : 50, 200));
    return ok(
      [...this.payouts]
        .sort((x, y) => y.seq - x.seq)
        .slice(0, n)
        .map((p) => ({
          ...this.rowOut(p),
          publisher_id: p.publisherId,
          publisher_name: this.publishers.get(p.publisherId)?.name ?? "Publisher",
          ledger_covers: this.position(p.publisherId).ledger >= this.position(p.publisherId).reserved + this.position(p.publisherId).paid,
        })),
    );
  }

  // ===========================================================================================================================
  // Clients. Grants: service_role => serve + ledger admin functions; authenticated (login session) => payout functions. Baaki sab 42501.
  serviceClient() {
    return {
      rpc: async (name: string, args: Record<string, unknown> = {}): Promise<Reply> => {
        this.calls.push({ client: "service", name, args });
        switch (name) {
          case "ledger_reverse_entry":
            return ok(this.ledgerReverseEntry(args));
          case "ledger_add_adjustment":
            return ok(this.ledgerAddAdjustment(args));
          case "request_my_payout":
          case "admin_review_payout_request":
          case "admin_mark_payout_paid":
          case "get_my_payout_summary":
          case "get_my_payout_requests":
          case "admin_list_payout_requests":
            return fail("42501", "permission denied for function (service_role has no EXECUTE)");
          default:
            return this.db.client().rpc(name, args);
        }
      },
    };
  }

  /** Login-session client (createClient()). auth.uid() = abhi signed-in profile. */
  sessionClient(uid: string | null = session.userId) {
    return {
      rpc: async (name: string, args: Record<string, unknown> = {}): Promise<Reply> => {
        this.calls.push({ client: "session", name, args });
        switch (name) {
          case "request_my_payout":
            return this.requestMyPayout(uid, args);
          case "admin_review_payout_request":
            return this.adminReview(uid, args);
          case "admin_mark_payout_paid":
            return this.adminMarkPaid(uid, args);
          case "get_my_payout_summary":
            return this.summary(uid);
          case "get_my_payout_requests":
            return this.myRequests(uid, args.p_limit);
          case "admin_list_payout_requests":
            return this.adminList(uid, args.p_limit);
          default:
            return fail("42501", "permission denied for function (authenticated has no EXECUTE)");
        }
      },
    };
  }
}

// ===========================================================================================================================
// Nakli modules (actions se PEHLE lagte hain). requireRole / getCurrentAccount signed-in profile ko model ke profiles se padhte hain.
const stubs: Record<string, unknown> = {
  "next/cache": {
    revalidatePath(p: string) {
      session.revalidated.push(p);
    },
  },
  "@/lib/auth/session": {
    async getCurrentAccount() {
      const p = session.model?.profileOf(session.userId) ?? null;
      return p && session.userId ? { user: { id: session.userId }, role: p.role, status: p.status } : null;
    },
    async requireRole(allowed: string[]) {
      const p = session.model?.profileOf(session.userId) ?? null;
      if (!p || !session.userId || p.status !== "active" || !allowed.includes(p.role)) {
        session.redirects.push("/dashboard");
        throw new Error("REDIRECT:/dashboard");
      }
      return { user: { id: session.userId }, role: p.role, status: p.status };
    },
  },
  "@/lib/supabase/server": {
    async createClient() {
      if (!session.model) throw new Error("test: no financial model signed in");
      return session.model.sessionClient(session.userId);
    },
  },
};

const previous = Module._load;
Module._load = function patched(this: unknown, request: string, parent: unknown, isMain: boolean) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return previous.call(this, request, parent, isMain);
};

export function resetSession(): void {
  session.model = null;
  session.userId = null;
  session.redirects = [];
  session.revalidated = [];
}
