"use client";

import { useEffect } from "react";

const VISITOR_KEY = "tsd-visitor";

export function StudioTracker({
  companySlug,
  pageKey,
  event,
  pixelId,
  ctaSelector,
}: {
  companySlug: string;
  pageKey: string;
  event: "vsl_view" | "lead_in";
  pixelId: string | null;
  ctaSelector: string;
}) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let visitor = "";
    try {
      visitor = localStorage.getItem(VISITOR_KEY) || "";
      if (!visitor) {
        visitor = crypto.randomUUID();
        localStorage.setItem(VISITOR_KEY, visitor);
      }
    } catch { /* ignore */ }

    const payload = {
      company: companySlug,
      event,
      page_key: pageKey,
      visitor_id: visitor,
      utm_source: params.get("utm_source"),
      utm_medium: params.get("utm_medium"),
      utm_campaign: params.get("utm_campaign"),
      utm_content: params.get("utm_content"),
      fbclid: params.get("fbclid"),
      gclid: params.get("gclid"),
      campaign_id: params.get("campaign_id"),
      adset_id: params.get("adset_id"),
      ad_id: params.get("ad_id"),
      source: params.get("utm_source") || (params.get("fbclid") ? "facebook" : null),
    };

    const onceKey = `tsd-px:${companySlug}:${pageKey}:${event}`;
    let alreadySent = false;
    try { alreadySent = sessionStorage.getItem(onceKey) === "1"; } catch { /* ignore */ }
    if (!alreadySent) {
      try { sessionStorage.setItem(onceKey, "1"); } catch { /* ignore */ }
      void fetch("/api/conversion/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      });
    }

    if (pixelId && typeof window !== "undefined") {
      loadMetaPixel(pixelId);
    }

    const onCta = () => {
      void fetch("/api/conversion/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, event: "vsl_complete" }),
        keepalive: true,
      });
      if (pixelId && "fbq" in window) {
        (window as unknown as { fbq: (...a: unknown[]) => void }).fbq("trackCustom", "VslComplete", { page: pageKey });
      }
    };
    const el = document.querySelector(ctaSelector);
    el?.addEventListener("click", onCta);
    return () => el?.removeEventListener("click", onCta);
  }, [companySlug, pageKey, event, pixelId, ctaSelector]);

  return null;
}

function loadMetaPixel(pixelId: string) {
  const w = window as unknown as { fbq?: (...a: unknown[]) => void; _fbq?: unknown };
  if (w.fbq) {
    w.fbq("init", pixelId);
    w.fbq("track", "PageView");
    return;
  }
  const n: ((...a: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean; version?: string } = function (...args: unknown[]) {
    (n.queue = n.queue || []).push(args);
  };
  n.queue = [];
  n.loaded = true;
  n.version = "2.0";
  w.fbq = n;
  w._fbq = n;
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(s);
  n("init", pixelId);
  n("track", "PageView");
}
