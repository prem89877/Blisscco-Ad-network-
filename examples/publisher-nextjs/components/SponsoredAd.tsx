"use client";

import { useEffect, useRef, useState } from "react";
import { safeHref } from "../lib/safe-url";

// Runs in the browser, so it holds NO credentials. It only calls this site's own /api/blisscco-ad route.
// Shows nothing for no-fill, errors or an unsafe link. An impression is reported only for an ad that is really on screen.
// A click sends only the public click ref to this site's own route (which asks Blisscco to validate and count it),
// then opens the already-validated https destination in a new tab. The browser never supplies a destination.

type ShownAd = { id: string; headline: string; body: string; ctaText: string; href: string; token: string | null; clickRef: string | null };

// Shape checks only (same as the server). Blisscco verifies signature, expiry, serve and destination.
const TRACKING_TOKEN_RE = /^bt1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const CLICK_REF_RE = /^bc1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Reads only the 5 public fields + the impression token + the click ref, and re-checks the link, whatever the response contains. */
function toShownAd(data: unknown): ShownAd | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as { fill?: unknown; sponsored?: unknown; ad?: Record<string, unknown>; tracking?: { token?: unknown; click_ref?: unknown } | null };
  if (d.fill !== true || d.sponsored !== true || typeof d.ad !== "object" || d.ad === null) return null;
  const { id, headline, body, cta_text, destination_url } = d.ad;
  const href = safeHref(destination_url);
  if (typeof id !== "string" || typeof headline !== "string" || typeof body !== "string" || !href) return null;
  const t: { token?: unknown; click_ref?: unknown } = typeof d.tracking === "object" && d.tracking !== null ? d.tracking : {};
  const token = typeof t.token === "string" && t.token.length <= 512 && TRACKING_TOKEN_RE.test(t.token) ? t.token : null;
  const clickRef = typeof t.click_ref === "string" && t.click_ref.length <= 512 && CLICK_REF_RE.test(t.click_ref) ? t.click_ref : null;
  return { id, headline, body, ctaText: typeof cta_text === "string" && cta_text ? cta_text : "Learn more", href, token, clickRef };
}

export default function SponsoredAd({ topic }: { topic: string }) {
  const [ad, setAd] = useState<ShownAd | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);
  const reportedToken = useRef<string | null>(null);
  const reportedClickRef = useRef<string | null>(null);

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

  // Impression: once per token, only when the ad is on screen (at least half visible) in a visible tab.
  useEffect(() => {
    const token = ad?.token;
    const el = asideRef.current;
    if (!token || !el || reportedToken.current === token) return;

    let inView = false;
    const send = () => {
      if (reportedToken.current === token) return;
      reportedToken.current = token;
      cleanup();
      // Exact Blisscco impression body, via our own server route. No topic, ad id, cookies or user data.
      fetch("/api/blisscco-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, event: "impression" }),
        credentials: "omit",
        keepalive: true,
      }).catch(() => {}); // a missed impression is harmless; never retried from the browser
    };
    const maybeSend = () => {
      if (inView && document.visibilityState === "visible") send();
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            inView = entries.some((e) => e.isIntersecting);
            maybeSend();
          }, { threshold: 0.5 });
    function cleanup() {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", maybeSend);
    }

    document.addEventListener("visibilitychange", maybeSend);
    if (observer) observer.observe(el);
    else {
      inView = true; // very old browser: the ad is rendered, count it once the tab is visible
      maybeSend();
    }
    return cleanup;
  }, [ad]);

  // Click: report the click ref first (once per ad; Blisscco dedupes anyway), then open the validated destination.
  // The request is started before the tab opens and uses keepalive, so it survives the navigation. The tab is opened
  // synchronously inside the click handler so popup blockers allow it, and always with noopener + noreferrer.
  function onAdClick() {
    if (!ad) return;
    const target = safeHref(ad.href); // re-check right before opening
    if (!target) return;
    const ref = ad.clickRef;
    if (ref && reportedClickRef.current !== ref) {
      reportedClickRef.current = ref;
      fetch("/api/blisscco-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ click_ref: ref, event: "click" }), // click ref only: no URL, topic, ad id or user data
        credentials: "omit",
        keepalive: true,
      }).catch(() => {}); // a missed click report never blocks the user
    }
    window.open(target, "_blank", "noopener,noreferrer");
  }

  if (!ad) return null;
  return (
    <aside ref={asideRef} aria-label="Sponsored" style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, maxWidth: 420 }}>
      <p style={{ margin: 0, fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>Sponsored</p>
      <h3 style={{ margin: "4px 0" }}>{ad.headline}</h3>
      <p style={{ margin: "0 0 8px" }}>{ad.body}</p>
      <button type="button" onClick={onAdClick} style={{ padding: 0, border: 0, background: "none", color: "#06c", textDecoration: "underline", cursor: "pointer", font: "inherit" }}>
        {ad.ctaText}
      </button>
    </aside>
  );
}
