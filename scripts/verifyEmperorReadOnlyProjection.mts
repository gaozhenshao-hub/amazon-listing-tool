import { emperorRunRouter } from "../server/domains/ai_os/routers/run";
import { emperorObservabilityRouter } from "../server/domains/ai_os/routers/observability";

const user = { id: 1, role: "super_admin", defaultWorkspaceId: 1, organizationId: null } as any;

function context(requestId: string) {
  return {
    user,
    workspaceId: user.defaultWorkspaceId,
    requestId,
    req: { headers: {}, header: () => undefined } as any,
    res: { locals: { requestId } } as any,
  };
}

async function main() {
  const runCaller = emperorRunRouter.createCaller(context(`readonly-projection-run-${Date.now()}`));
  const observabilityCaller = emperorObservabilityRouter.createCaller(context(`readonly-projection-observability-${Date.now()}`));
  const history = await runCaller.history({ page: 1, pageSize: 50 });
  const firstRun = history.runs[0] as any;
  const detail = firstRun ? await runCaller.getDetail({ runId: String(firstRun.runId) }) as any : null;
  const slo = await observabilityCaller.slo({ days: 30 }) as any;
  const sloTrend = await observabilityCaller.sloTrend({ days: 30 }) as any;
  const projection = detail?.traceId
    ? await observabilityCaller.runProjection({ traceId: String(detail.traceId), afterId: 0, limit: 100 }) as any
    : null;
  if (!Array.isArray(slo.signals) || slo.signals.some((signal: any) => !signal.key || !signal.status)) {
    throw new Error("SLO summary did not return structured real signals");
  }
  if (!Array.isArray(sloTrend.points) || sloTrend.points.some((point: any) => !point.day)) {
    throw new Error("SLO trend did not return structured real time points");
  }
  if (detail?.traceId && !projection) throw new Error("Verified trace did not return a ledger projection");
  console.log(JSON.stringify({
    selectedRunId: detail?.runId || null,
    verifiedTraceId: detail?.traceId || null,
    traceCandidateCount: Array.isArray(detail?.traceCandidates) ? detail.traceCandidates.length : 0,
    projectionEventCount: projection?.events?.length || 0,
    provenanceCount: projection?.provenance?.length || 0,
    nextCursor: projection?.nextCursor ?? null,
    slo: slo.signals.map((signal: any) => ({ key: signal.key, status: signal.status, samples: signal.samples, observed: signal.observed })),
    sloTrendPointCount: sloTrend.points.length,
    sloTrendSource: sloTrend.source,
    verification: "read-only-router-projection-no-model-skill-agent-tool-mcp-executed",
  }));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : "readonly_projection_verification_failed");
  process.exit(1);
});
