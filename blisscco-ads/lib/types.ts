export type CampaignStatus = "Active" | "Paused" | "Draft" | "Completed";

export type Campaign = {
  id: string;
  name: string;
  advertiser: string;
  topic: string;
  status: CampaignStatus;
  budget: number;
  spend: number;
  impressions: number;
  clicks: number;
  relevance: number; // contextual match score, 0-100 (demo)
  startDate: string; // ISO date
};

export type Publisher = {
  id: string;
  name: string;
  category: string;
  adRequests: number;
  impressions: number;
  clicks: number;
  revenue: number;
};

export type DailyMetric = {
  date: string; // ISO date
  impressions: number;
  clicks: number;
  spend: number;
};

/** A fictional event for the "Recent activity" list. Never a real log entry. */
export type ActivityEvent = {
  id: string;
  date: string; // ISO date
  text: string;
};
