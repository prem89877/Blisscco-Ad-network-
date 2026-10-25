import type { MetadataRoute } from "next";
import { siteBaseUrl } from "@/lib/site";

// Search engines ko sirf public pages. Dashboard, login aur API band.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/dashboard", "/api/", "/auth/", "/login", "/signup"] },
    sitemap: `${siteBaseUrl()}/sitemap.xml`,
  };
}
