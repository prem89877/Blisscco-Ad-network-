import type { MetadataRoute } from "next";
import { siteBaseUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteBaseUrl();
  return ["", "/privacy", "/terms"].map((path) => ({ url: `${base}${path}` }));
}
