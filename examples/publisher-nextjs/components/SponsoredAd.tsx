"use client";

import { useEffect, useState } from "react";
import { safeHref } from "../lib/safe-url";

// Runs in the browser, so it holds NO credentials. It only calls this site's own /api/blisscco-ad route.
// Shows nothing for no-fill, errors or an unsafe link.

type ShownAd = { id: string; headline: string; body: string; ctaText: string; href: string };

/** Reads only the 5 public fields and re-checks the link, whatever the response contains. */
function toShownAd(data: unknown): ShownAd | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as { fill?: unknown; sponsored?: unknown; ad?: Record<string, unknown> };
  if (d.fill !== true || d.sponsored !== true || typeof d.ad !== "object" || d.ad === null) return null;
  const { id, headline, body, cta_text, destination_url } = d.ad;
  const href = safeHref(destination_url);
  if (typeof id !== "string" || typeof headline !== "string" || typeof body !== "string" || !href) return null;
  return { id, headline, body, ctaText: typeof cta_text === "string" && cta_text ? cta_text : "Learn more", href };
}

export default function SponsoredAd({ topic }: { topic: string }) {
  const [ad, setAd] = useState<ShownAd | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/blisscco-ad", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic }), // topic only: never send chat text or user data
      credentials: "omit",
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setAd(toShownAd(data)))
      .catch(() => setAd(null));
    return () => controller.abort();
  }, [topic]);

  if (!ad) return null;
  return (
    <aside aria-label="Sponsored" style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, maxWidth: 420 }}>
      <p style={{ margin: 0, fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>Sponsored</p>
      <h3 style={{ margin: "4px 0" }}>{ad.headline}</h3>
      <p style={{ margin: "0 0 8px" }}>{ad.body}</p>
      <a href={ad.href} target="_blank" rel="sponsored noopener noreferrer">
        {ad.ctaText}
      </a>
    </aside>
  );
}
