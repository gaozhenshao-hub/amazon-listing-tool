import { useEffect, useRef } from "react";

export const PERFORMANCE_METRIC_NAMES = ["LCP", "INP", "CLS", "TTFB", "FCP"] as const;
export type PerformanceMetricName = (typeof PERFORMANCE_METRIC_NAMES)[number];
export type PerformanceRating = "good" | "needs-improvement" | "poor";

export type PerformanceVital = {
  metricName: PerformanceMetricName;
  value: number;
  rating: PerformanceRating;
  routeKey: string;
  releaseId: string;
};

const METRIC_THRESHOLDS: Record<PerformanceMetricName, readonly [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  TTFB: [800, 1800],
  FCP: [1800, 3000],
};

const ROUTE_SEGMENT_ID = /^\d+$/;
const ROUTE_SEGMENT_ASIN = /^[A-Z0-9]{10}$/i;
const ROUTE_SEGMENT_UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function normalizePerformanceRoute(pathname: string) {
  const path = pathname.split("?")[0].split("#")[0] || "/";
  const normalized = path
    .split("/")
    .map((segment) => {
      if (!segment) return "";
      if (ROUTE_SEGMENT_ID.test(segment)) return ":id";
      if (ROUTE_SEGMENT_ASIN.test(segment)) return ":asin";
      if (ROUTE_SEGMENT_UUID.test(segment)) return ":id";
      return segment.toLowerCase();
    })
    .join("/");
  return normalized.startsWith("/") ? normalized.slice(0, 96) || "/" : `/${normalized.slice(0, 95)}`;
}

export function ratePerformanceMetric(metricName: PerformanceMetricName, value: number): PerformanceRating {
  const [good, poor] = METRIC_THRESHOLDS[metricName];
  if (value <= good) return "good";
  if (value <= poor) return "needs-improvement";
  return "poor";
}

function getReleaseId() {
  const entrySource = Array.from(document.scripts)
    .map((script) => script.src)
    .find((src) => /\/assets\/index-[A-Za-z0-9_-]{8,}\.js(?:\?|$)/.test(src));
  const hash = entrySource?.match(/\/assets\/index-([A-Za-z0-9_-]{8,})\.js/)?.[1];
  return hash || document.documentElement.dataset.buildId || "web";
}

function listenForRouteChange(callback: () => void) {
  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;
  const eventName = "amz-performance-route-change";
  const notify = () => window.dispatchEvent(new Event(eventName));
  window.history.pushState = function pushState(...args) {
    originalPushState.apply(this, args);
    notify();
  };
  window.history.replaceState = function replaceState(...args) {
    originalReplaceState.apply(this, args);
    notify();
  };
  window.addEventListener("popstate", notify);
  window.addEventListener(eventName, callback);
  return () => {
    window.history.pushState = originalPushState;
    window.history.replaceState = originalReplaceState;
    window.removeEventListener("popstate", notify);
    window.removeEventListener(eventName, callback);
  };
}

function isSampledSession() {
  const key = "performance-vitals-sampled";
  const existing = window.sessionStorage.getItem(key);
  if (existing !== null) return existing === "1";
  // 25% session sampling bounds write load while still giving a representative 14-day baseline.
  const sampled = Math.random() < 0.25;
  window.sessionStorage.setItem(key, sampled ? "1" : "0");
  return sampled;
}

export function usePerformanceVitals(
  enabled: boolean,
  report: (events: PerformanceVital[]) => void,
) {
  const reportRef = useRef(report);
  reportRef.current = report;

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || !isSampledSession()) return;

    const buffered = new Map<PerformanceMetricName, number>();
    let flushTimer: number | undefined;
    let routeKey = normalizePerformanceRoute(window.location.pathname);

    const queue = (metricName: PerformanceMetricName, value: number) => {
      if (!Number.isFinite(value) || value < 0) return;
      const previous = buffered.get(metricName);
      // CLS/LCP/INP keep the most meaningful final value; timing metrics are recorded once.
      if (previous === undefined || value > previous) buffered.set(metricName, value);
      if (flushTimer === undefined) {
        flushTimer = window.setTimeout(flush, 1_500);
      }
    };

    const flush = () => {
      if (flushTimer !== undefined) {
        window.clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      if (buffered.size === 0) return;
      const releaseId = getReleaseId();
      const events = Array.from(buffered, ([metricName, value]) => ({
        metricName,
        value: Math.round(value * 100) / 100,
        rating: ratePerformanceMetric(metricName, value),
        routeKey,
        releaseId,
      }));
      buffered.clear();
      reportRef.current(events);
    };

    const onRouteChange = () => {
      flush();
      routeKey = normalizePerformanceRoute(window.location.pathname);
    };
    const removeRouteListener = listenForRouteChange(onRouteChange);
    const observers: PerformanceObserver[] = [];
    const observe = (type: string, callback: (entries: PerformanceEntryList) => void) => {
      try {
        const observer = new PerformanceObserver((list) => callback(list.getEntries()));
        observer.observe({ type, buffered: true } as PerformanceObserverInit);
        observers.push(observer);
      } catch {
        // A browser may not implement every Web Vitals entry type. Reporting is optional.
      }
    };

    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (navigation?.responseStart) queue("TTFB", navigation.responseStart - navigation.requestStart);
    const paint = performance.getEntriesByName("first-contentful-paint")[0];
    if (paint) queue("FCP", paint.startTime);

    observe("largest-contentful-paint", (entries) => {
      const last = entries.at(-1);
      if (last) queue("LCP", last.startTime);
    });
    observe("layout-shift", (entries) => {
      const shift = entries.reduce((sum, entry: any) => sum + (entry.hadRecentInput ? 0 : Number(entry.value || 0)), 0);
      if (shift > 0) queue("CLS", (buffered.get("CLS") || 0) + shift);
    });
    observe("event", (entries) => {
      const durations = entries.map((entry: any) => Number(entry.duration || 0)).filter(Number.isFinite);
      if (durations.length) queue("INP", Math.max(...durations));
    });

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      flush();
      removeRouteListener();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      observers.forEach((observer) => observer.disconnect());
    };
  }, [enabled]);
}
