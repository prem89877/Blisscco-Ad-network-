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

/** Categories an advertiser can pick in the demo "Create campaign" form. */
export const CAMPAIGN_CATEGORIES = ["Gaming", "Technology", "Education", "Developer Tools"] as const;
export type CampaignCategory = (typeof CAMPAIGN_CATEGORIES)[number];

/** Sample campaign shown on the Advertiser dashboard. Demo data only. */
export type AdvertiserCampaign = {
  id: string;
  name: string;
  category: CampaignCategory;
  budget: number;
  spend: number;
  impressions: number;
  status: CampaignStatus;
  createdThisSession?: boolean;
};
