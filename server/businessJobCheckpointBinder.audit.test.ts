import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROFILE_IMPORT_JOB_KIND } from "../shared/profileImportJob";
import { COMPETITOR_RESEARCH_JOB_KIND } from "../shared/competitorResearchJob";
import { COMPETITOR_DEEP_EXECUTION_JOB_KIND } from "../shared/competitorDeepExecutionJob";
import { PRIVATE_IMAGE_TAGGING_JOB_KIND } from "./repositories/ai_os/dedicatedJobPolicy";

const io = vi.hoisted(() => ({ read: vi.fn(), running: vi.fn(), progress: vi.fn(), waiting: vi.fn(),
  confirmed: vi.fn(), failed: vi.fn(), canceled: vi.fn(), metric: vi.fn() }));
vi.mock("./domains/ai_os/services/agentRunner/runtimeCore", () => ({
  rawExecute: io.read,
  parseJson: (value: unknown, fallback: unknown) => {
    if (typeof value !== "string") return value ?? fallback;
    try { return JSON.parse(value); } catch { return fallback; }
  },
}));
vi.mock("./domains/ai_os/services/businessManagedAgent", () => ({
  markBusinessManagedNodeCanceled: io.canceled, markBusinessManagedNodeConfirmed: io.confirmed,
  markBusinessManagedNodeFailed: io.failed, markBusinessManagedNodeProgress: io.progress,
  markBusinessManagedNodeRunning: io.running, markBusinessManagedNodeWaitingHuman: io.waiting,
}));
vi.mock("./domains/ai_os/services/observability", () => ({ recordAiOsMetric: io.metric }));
import { auditBusinessJobCheckpointBindings, businessJobCheckpointBinder } from "./domains/ai_os/services/businessJobCheckpointBinder";
import { BUSINESS_AI_JOB_MODULES } from "./domains/ai_os/services/businessJobBindingPolicy";

function row(runId: string, kind = "legacy.listing", patch = {}) {
  return { runId, kind, userId: 7, projectId: 1, module: "listing", jobStatus: "running", input: { agentRunId: "agent-legacy", agentNodeId: "G1" },
    agentRunId: "agent-legacy", nodeId: "G1", checkpointStatus: "running", metadata: {}, aiJobRunId: runId, ...patch };
}
type Row = ReturnType<typeof row>;
/** Offline query transport: it interprets the actual SQL-bound exclusions before
 * applying LIMIT. No real repository, database, worker or model is called. */
function database(rows: Row[]) {
  io.read.mockImplementation(async (sql: string, params: unknown[]) => {
    expect(sql).toContain("WHERE j.userId=? AND j.kind NOT IN (?,?,?,?) AND");
    expect(sql.indexOf("j.kind NOT IN (?,?,?,?)")).toBeLessThan(sql.indexOf("ORDER BY j.id DESC LIMIT ?"));
    expect(params.slice(1, 5)).toEqual([PROFILE_IMPORT_JOB_KIND, COMPETITOR_RESEARCH_JOB_KIND, COMPETITOR_DEEP_EXECUTION_JOB_KIND, PRIVATE_IMAGE_TAGGING_JOB_KIND]);
    let index = 5;
    const modules = sql.includes("j.module=?") ? [params[index++]] : params.slice(index, index += BUSINESS_AI_JOB_MODULES.length);
    const projectId = sql.includes("j.projectId=?") ? params[index++] : undefined;
    const limit = params[index];
    expect(index).toBe(params.length - 1); expect(typeof limit).toBe("number");
    return rows.filter(item => item.userId === params[0] && !params.slice(1, 5).includes(item.kind)
      && modules.includes(item.module) && (projectId === undefined || item.projectId === projectId)).slice(0, limit as number);
  });
}
beforeEach(() => {
  vi.clearAllMocks(); io.running.mockResolvedValue(undefined); io.progress.mockResolvedValue(true); io.metric.mockResolvedValue(undefined);
});

describe("generic business binding audit excludes domain-owned task metadata", () => {
  it.each([PROFILE_IMPORT_JOB_KIND, COMPETITOR_RESEARCH_JOB_KIND, COMPETITOR_DEEP_EXECUTION_JOB_KIND, PRIVATE_IMAGE_TAGGING_JOB_KIND])("%s never contributes to totals or violations", async kind => {
    database([row("private-task", kind, { input: {}, agentRunId: null, checkpointStatus: null }), row("legacy-bound")]);
    expect(await auditBusinessJobCheckpointBindings({ userId: 7 })).toEqual({ total: 1, bound: 1, mismatched: 0, healthy: true, issues: [] });
    expect(io.read).toHaveBeenCalledOnce();
  });

  it("excludes all dedicated kinds before LIMIT so newest private jobs cannot crowd out the legacy audit", async () => {
    database([row("private-profile", PROFILE_IMPORT_JOB_KIND), row("private-research", COMPETITOR_RESEARCH_JOB_KIND),
      row("private-deep", COMPETITOR_DEEP_EXECUTION_JOB_KIND), row("legacy-bound")]);
    expect(await auditBusinessJobCheckpointBindings({ userId: 7, limit: 1 })).toMatchObject({ total: 1, bound: 1, mismatched: 0, healthy: true });
    expect(io.read.mock.calls[0][1]).toEqual([7, PROFILE_IMPORT_JOB_KIND, COMPETITOR_RESEARCH_JOB_KIND, COMPETITOR_DEEP_EXECUTION_JOB_KIND, PRIVATE_IMAGE_TAGGING_JOB_KIND, ...BUSINESS_AI_JOB_MODULES, 1]);
  });

  it("retains existing user/module/project filters and reports genuine legacy binding violations", async () => {
    database([row("private-profile", PROFILE_IMPORT_JOB_KIND), row("private-research", COMPETITOR_RESEARCH_JOB_KIND),
      row("private-deep", COMPETITOR_DEEP_EXECUTION_JOB_KIND), row("foreign-user", "legacy", { userId: 8 }),
      row("foreign-project", "legacy", { projectId: 2 }), row("video", "legacy.video", { module: "videoScript" }),
      row("legacy-bound"), row("legacy-mismatch", "legacy", { checkpointStatus: "failed" })]);
    const result = await auditBusinessJobCheckpointBindings({ userId: 7, module: "listing", projectId: 1, limit: 20 });
    expect(result).toMatchObject({ total: 2, bound: 1, mismatched: 1, healthy: false });
    expect(result.issues).toEqual([expect.objectContaining({ aiJobRunId: "legacy-mismatch", module: "listing", reason: "状态映射不一致" })]);
    expect(JSON.stringify(result)).not.toContain("private-");
    expect(io.read.mock.calls[0][1]).toEqual([7, PROFILE_IMPORT_JOB_KIND, COMPETITOR_RESEARCH_JOB_KIND, COMPETITOR_DEEP_EXECUTION_JOB_KIND, PRIVATE_IMAGE_TAGGING_JOB_KIND, "listing", 1, 20]);
  });

  it("a result set containing only dedicated jobs is empty, not a fabricated missing-binding violation", async () => {
    database([row("private-profile", PROFILE_IMPORT_JOB_KIND, { input: {} }), row("private-research", COMPETITOR_RESEARCH_JOB_KIND, { input: {} }),
      row("private-deep", COMPETITOR_DEEP_EXECUTION_JOB_KIND, { input: {} })]);
    expect(await auditBusinessJobCheckpointBindings({ userId: 7 })).toEqual({ total: 0, bound: 0, mismatched: 0, healthy: true, issues: [] });
  });

  it("does not alter the real worker binding protocol used by other lanes", async () => {
    io.read.mockResolvedValue([{ kind: "video.generate" }]);
    const binding = { runId: "video-agent", nodeId: "shots", aiJobRunId: "video-job", aiJobAttempt: 2, userId: 7,
      dag: { nodes: [], edges: [] }, progress: 35 };
    expect(await businessJobCheckpointBinder.sync("running", binding)).toBe(true);
    expect(io.running).toHaveBeenCalledWith(expect.objectContaining({ ...binding, allowJobReplacement: false }));
    expect(io.progress).toHaveBeenCalledWith(expect.objectContaining({ ...binding, errorMessage: null,
      metadata: expect.objectContaining({ businessJobStatus: "running", aiJobAttempt: 2 }) }));
    expect(io.read).toHaveBeenCalledWith("SELECT kind FROM ai_jobs WHERE runId=? LIMIT 1", ["video-job"]);
    expect(io.metric).toHaveBeenCalledOnce();
  });

  it.each(["queued", "running", "retrying", "succeeded", "confirmed", "failed", "canceled"] as const)("does not bind a private tagging job to a generic %s checkpoint", async status => {
    io.read.mockResolvedValue([{ kind: PRIVATE_IMAGE_TAGGING_JOB_KIND }]);
    await expect(businessJobCheckpointBinder.sync(status, { runId: "spoofed-agent", nodeId: "N1", aiJobRunId: "private-job", dag: { nodes: [], edges: [] } }))
      .rejects.toThrow("IMAGE_TAGGING_USE_DEDICATED_ENDPOINT");
    for (const call of [io.running, io.progress, io.waiting, io.confirmed, io.failed, io.canceled, io.metric]) expect(call).not.toHaveBeenCalled();
  });
});
