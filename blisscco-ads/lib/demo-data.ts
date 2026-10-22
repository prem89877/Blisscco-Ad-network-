import type { Campaign, CampaignStatus, DailyMetric, Publisher } from "./types";

/** All numbers here are made-up demo data. No real advertisers, platforms or revenue. */

export const DEMO_ADVERTISER = "Lumen Learning";
export const PAYOUT_SHARE = 0.7; // demo: publisher share of advertiser spend

export const CAMPAIGNS: Campaign[] = [
  { id: "cmp_8f3a21", name: "Exam Prep Spring Push", advertiser: "Lumen Learning", topic: "Education", status: "Active", budget: 6000, spend: 4120, impressions: 612000, clicks: 11260, relevance: 92, startDate: "2026-09-02" },
  { id: "cmp_2c7d90", name: "Coding Bootcamp Intro", advertiser: "Lumen Learning", topic: "Developer tools", status: "Active", budget: 4500, spend: 2310, impressions: 338000, clicks: 5410, relevance: 88, startDate: "2026-09-15" },
  { id: "cmp_5b1e44", name: "Language Course Trial", advertiser: "Lumen Learning", topic: "Education", status: "Draft", budget: 3000, spend: 0, impressions: 0, clicks: 0, relevance: 81, startDate: "2026-11-01" },
  { id: "cmp_91ad07", name: "Home Workout Plans", advertiser: "Northwind Fitness", topic: "Fitness", status: "Active", budget: 5200, spend: 3890, impressions: 548000, clicks: 8770, relevance: 85, startDate: "2026-08-24" },
  { id: "cmp_d40f6b", name: "Protein Snacks Launch", advertiser: "Northwind Fitness", topic: "Fitness", status: "Paused", budget: 2500, spend: 1475, impressions: 201000, clicks: 2620, relevance: 74, startDate: "2026-09-08" },
  { id: "cmp_67e2c3", name: "Budget Tracker App", advertiser: "PocketLedger", topic: "Finance", status: "Active", budget: 7000, spend: 5260, impressions: 702000, clicks: 13480, relevance: 90, startDate: "2026-08-17" },
  { id: "cmp_a8905e", name: "Weekly Meal Boxes", advertiser: "Verde Meals", topic: "Food", status: "Completed", budget: 3500, spend: 3498, impressions: 487000, clicks: 7120, relevance: 83, startDate: "2026-07-20" },
  { id: "cmp_3e6b18", name: "Weekend Getaway Deals", advertiser: "TravelNest", topic: "Travel", status: "Paused", budget: 4000, spend: 1960, impressions: 276000, clicks: 3640, relevance: 77, startDate: "2026-09-10" },
];

export const PUBLISHERS: Publisher[] = [
  { id: "pub_01", name: "StudyBuddy AI", category: "Education", adRequests: 905000, impressions: 742000, clicks: 13950, revenue: 5120 },
  { id: "pub_02", name: "CodePilot Assistant", category: "Developer tools", adRequests: 688000, impressions: 531000, clicks: 9020, revenue: 3870 },
  { id: "pub_03", name: "FinWise Assistant", category: "Finance", adRequests: 612000, impressions: 498000, clicks: 9610, revenue: 3640 },
  { id: "pub_04", name: "ChefMate Chat", category: "Food", adRequests: 455000, impressions: 336000, clicks: 4860, revenue: 2210 },
  { id: "pub_05", name: "WanderBot", category: "Travel", adRequests: 390000, impressions: 262000, clicks: 3340, revenue: 1780 },
  { id: "pub_06", name: "FitCoach Chat", category: "Fitness", adRequests: 341000, impressions: 247000, clicks: 3810, revenue: 1690 },
];

/** 30 days ending 22 Oct 2026, generated deterministically (no Math.random) so server and client match. */
function buildDaily(): DailyMetric[] {
  const end = Date.UTC(2026, 9, 22);
  const out: DailyMetric[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(end - i * 86400000);
    const idx = 29 - i;
    const dow = d.getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const base = 38000 + idx * 520 + Math.sin(idx * 1.7) * 2600;
    const impressions = Math.round(base * (weekend ? 0.82 : 1));
    const ctr = 0.0165 + Math.cos(idx * 0.9) * 0.0018;
    out.push({
      date: d.toISOString().slice(0, 10),
      impressions,
      clicks: Math.round(impressions * ctr),
      spend: Math.round((impressions / 1000) * 6.4 * 100) / 100,
    });
  }
  return out;
}
export const DAILY: DailyMetric[] = buildDaily();

/* ---------- helpers ---------- */

export const ctrOf = (clicks: number, impressions: number) => (impressions > 0 ? (clicks / impressions) * 100 : 0);

export function sumMetrics(days: DailyMetric[]) {
  const impressions = days.reduce((a, d) => a + d.impressions, 0);
  const clicks = days.reduce((a, d) => a + d.clicks, 0);
  const spend = days.reduce((a, d) => a + d.spend, 0);
  return { impressions, clicks, spend, ctr: ctrOf(clicks, impressions) };
}

/** Last 7 days vs the 7 days before, in percent. */
export function weekDelta(key: "impressions" | "clicks" | "spend" | "ctr"): number {
  const cur = sumMetrics(DAILY.slice(-7));
  const prev = sumMetrics(DAILY.slice(-14, -7));
  return prev[key] === 0 ? 0 : ((cur[key] - prev[key]) / prev[key]) * 100;
}

export function spendByTopic(list: Campaign[]): { label: string; value: number }[] {
  const map = new Map<string, number>();
  for (const c of list) map.set(c.topic, (map.get(c.topic) ?? 0) + c.spend);
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

export const STATUSES: CampaignStatus[] = ["Active", "Paused", "Draft", "Completed"];
