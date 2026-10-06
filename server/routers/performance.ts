import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { workspaceIdFromContext } from "../services/securityGovernance";
import { recordAiOsMetric } from "../domains/ai_os/services/observability";

const metricName = z.enum(["LCP", "INP", "CLS", "TTFB", "FCP"]);
const rating = z.enum(["good", "needs-improvement", "poor"]);
const routeKey = z.string().regex(/^\/[a-z0-9:_/-]{0,95}$/).max(96);
const releaseId = z.string().regex(/^[A-Za-z0-9._-]{1,80}$/).max(80);

const reportEventSchema = z.object({
  metricName,
  value: z.number().finite().min(0).max(120_000),
  rating,
  routeKey,
  releaseId,
});

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 120;
const rateWindows = new Map<string, { startedAt: number; count: number }>();

function acceptRateLimitedEvents(key: string, requested: number) {
  const now = Date.now();
  const current = rateWindows.get(key);
  const window = !current || now - current.startedAt >= RATE_WINDOW_MS
    ? { startedAt: now, count: 0 }
    : current;
  const accepted = Math.max(0, Math.min(requested, RATE_LIMIT - window.count));
  window.count += accepted;
  rateWindows.set(key, window);
  return accepted;
}

export function __resetPerformanceRateLimitForTests() {
  rateWindows.clear();
}

export const performanceRouter = router({
  recordVitals: protectedProcedure
    .input(z.object({ events: z.array(reportEventSchema).min(1).max(12) }))
    .mutation(async ({ ctx, input }) => {
      const workspaceId = workspaceIdFromContext(ctx);
      const accepted = acceptRateLimitedEvents(`${workspaceId}:${ctx.user.id}`, input.events.length);
      const events = input.events.slice(0, accepted);
      await Promise.all(events.map((event) => recordAiOsMetric({
        entityType: "frontend",
        entityId: event.routeKey,
        metricName: `frontend.${event.metricName.toLowerCase()}`,
        metricValue: event.value,
        status: event.rating,
        workspaceId,
        // The browser report is authenticated for rate control but deliberately has no user identifier in storage.
        metadata: { releaseId: event.releaseId, rating: event.rating },
      })));
      return { accepted: events.length, dropped: input.events.length - events.length };
    }),
});
