import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { PRIVATE_CONFIGURED_BUSINESS_ARTIFACT_KEYS } from "./repositories/ai_os/dedicatedJobPolicy";
const io = vi.hoisted(() => ({ execute: vi.fn(), getDb: vi.fn(), transaction: vi.fn(), storage: vi.fn(), http: vi.fn(), raw: vi.fn() }));
vi.mock("./repositories/dbClient", () => ({ getDb: io.getDb, withDbTransaction: io.transaction }));
vi.mock("./storage", () => ({ buildStorageUri: vi.fn(), parseStorageUri: vi.fn(), resolveStoredObjectUrl: io.storage, storageGet: io.storage, storagePut: io.storage }));
vi.mock("./infrastructure/http/safeHttpClient", () => ({ safeHttpRequest: io.http }));
vi.mock("./domains/ai_os/services/harnessCompletion", () => ({ recordHarnessFeedback: vi.fn() }));
vi.mock("./services/securityGovernance", () => ({ actorFromContext: (ctx: TrpcContext) => ctx.user,
  workspaceIdFromContext: (ctx: TrpcContext) => ctx.workspaceId, assertResourceAction: vi.fn(), recordSecurityAuditLog: vi.fn() }));
vi.mock("./domains/ai_os/routerContext", () => ({ rawExecute: io.raw }));
vi.mock("./domains/ai_os/services/businessArtifactRegistry", () => ({
  listBusinessArtifactVersions: vi.fn(), resolveCurrentBusinessArtifact: vi.fn(), rollbackBusinessArtifactVersion: vi.fn(), selectBusinessArtifactVersion: vi.fn(),
}));
import { emperorArtifactsRouter } from "./domains/ai_os/routers/artifacts";
import {
  buildUnifiedArtifactRef, buildUnifiedArtifactCurrentRef, resolveUnifiedArtifact, resolveUnifiedArtifactRef,
  listUnifiedArtifactVersions, resolveCurrentProjectArtifacts, selectUnifiedArtifactVersion,
  rollbackUnifiedArtifactVersion, recordUnifiedArtifactConsumption, registerUnifiedArtifact,
  DATA_LIFECYCLE_POLICIES, buildLifecycleCandidateSql,
} from "./domains/ai_os/services/artifactLifecycle";

const dialect = new MySqlDialect();
const scope = { workspaceId: 42, projectId: 3, domain: "image" as const, artifactKey: "knowledge.image_tagging.candidate.v1", sourceTable: "kb_images", sourceRowId: "20" };
const cases = [
  { artifactKey: "knowledge.image_tagging.source.v1", sourceTable: "kb_image_sets", sourceAiJobRunId: "private-job" },
  { artifactKey: "knowledge.image_tagging.candidate.v1", sourceTable: "kb_images", sourceAiJobRunId: "private-job" },
  { artifactKey: "ordinary-looking", sourceTable: "kb_images", sourceAiJobRunId: "missing-job" },
  { artifactKey: "ordinary-looking", sourceTable: "kb_image_sets", sourceAiJobRunId: "missing-job" },
  { artifactKey: "ordinary-looking", sourceTable: "other", sourceAiJobRunId: "private-job" },
  ...PRIVATE_CONFIGURED_BUSINESS_ARTIFACT_KEYS.map(artifactKey => ({ artifactKey, sourceTable: "image_workflow_sessions", sourceAiJobRunId: "missing-job" })),
  { artifactKey: "ordinary-looking", sourceTable: "other", sourceAiJobRunId: "private-outline-job" },
  { artifactKey: "ordinary-looking", sourceTable: "other", sourceAiJobRunId: "private-market-job" },
];
let target: Record<string, unknown>;
const calls: Array<{ sql: string; params: unknown[] }> = [];
function checkPredicate(query: string) {
  expect(query).toContain("artifactKey NOT IN ('knowledge.image_tagging.source.v1','knowledge.image_tagging.candidate.v1')");
  expect(query).toContain("sourceTable,'') IN ('kb_images','kb_image_sets')");
  expect(query).toContain("sourceAiJobRunId IS NOT NULL");
  expect(query).toContain("NOT EXISTS (SELECT 1 FROM ai_jobs private_job WHERE private_job.runId=");
  expect(query).toContain("private_job.kind='knowledge.image_tagging.v1'");
  expect(query).toContain("private_job.kind IN ('image.workflow.outline.v1','product.development.market_overview.v1')");
  for (const key of PRIVATE_CONFIGURED_BUSINESS_ARTIFACT_KEYS) expect(query).toContain(`'${key}'`);
  if (query.includes("LIMIT")) expect(query.indexOf("private_job.kind")).toBeLessThan(query.indexOf("LIMIT"));
}
beforeEach(() => {
  vi.clearAllMocks(); calls.length = 0;
  target = { artifactId: "known-private-id", workspaceId: 42, userId: 7, domain: "image", projectId: 3,
    sourceRowId: "20", version: 1, isCurrent: 0, status: "draft", contentJson: { private: "full-source-and-model-candidate" }, ...cases[0] };
  io.execute.mockImplementation(async (statement: Parameters<MySqlDialect["sqlToQuery"]>[0]) => {
    const query = dialect.sqlToQuery(statement); calls.push(query); checkPredicate(query.sql);
    expect(query.sql).toMatch(/^SELECT/u); // refusal precedes any UPDATE/INSERT
    const reserved = String(target.artifactKey).startsWith("knowledge.image_tagging.")
      || PRIVATE_CONFIGURED_BUSINESS_ARTIFACT_KEYS.some(key => key === target.artifactKey)
      || ["kb_images", "kb_image_sets"].includes(String(target.sourceTable)) && target.sourceAiJobRunId != null
      || ["private-job", "private-outline-job", "private-market-job"].includes(String(target.sourceAiJobRunId));
    return [reserved ? [] : [target]];
  });
  io.getDb.mockResolvedValue({ execute: io.execute });
  io.transaction.mockImplementation(async (_label: string, body: (tx: { execute: typeof io.execute }) => Promise<unknown>) => body({ execute: io.execute }));
});

describe("private business artifacts cannot be resolved/exported through workspace-only APIs", () => {
  it.each(cases)("blocks ID references, scope lists and project exports for $artifactKey / $sourceTable", async patch => {
    Object.assign(target, patch);
    expect(await resolveUnifiedArtifact({ ...scope, artifactId: "known-private-id", currentOnly: false, confirmedOnly: false })).toBeNull();
    expect(await resolveUnifiedArtifactRef(buildUnifiedArtifactRef("known-private-id", 1), { workspaceId: 42, confirmedOnly: false })).toBeNull();
    expect(await resolveUnifiedArtifactRef(buildUnifiedArtifactCurrentRef(scope), { workspaceId: 42, confirmedOnly: false })).toBeNull();
    expect(await listUnifiedArtifactVersions({ ...scope, includeContent: true })).toEqual([]);
    expect(await listUnifiedArtifactVersions({ ...scope, includeContent: false })).toEqual([]);
    expect(await resolveCurrentProjectArtifacts({ workspaceId: 42, projectId: 3 })).toEqual([]);
    expect(io.storage).not.toHaveBeenCalled(); expect(io.http).not.toHaveBeenCalled();
    expect(calls).toHaveLength(6);
  });

  it.each(cases)("denies generic selection/rollback even if $artifactKey was marked final/current", async patch => {
    Object.assign(target, patch, { isCurrent: 1, status: "final" });
    await expect(selectUnifiedArtifactVersion({ artifactId: "known-private-id", workspaceId: 42, userId: 7 })).rejects.toThrow("not found");
    await expect(rollbackUnifiedArtifactVersion({ scope, userId: 7, targetVersion: 1 })).rejects.toThrow("没有可回滚");
    expect(calls).toHaveLength(2);
  });

  it("does not trust a forged public key when recording consumption of a known private ID", async () => {
    await expect(recordUnifiedArtifactConsumption({ workspaceId: 42,
      artifact: { artifactId: "known-private-id", artifactKey: "public-looking", version: 1, ref: buildUnifiedArtifactRef("known-private-id", 1) },
      consumerDomain: "agent", consumerType: "agent_node", consumerId: "node" })).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it.each(cases.slice(0, 4))("refuses generic registration for reserved private identity $artifactKey/$sourceTable", async patch => {
    await expect(registerUnifiedArtifact({ workspaceId: 42, ...patch, content: "forged-current", isCurrent: true })).rejects.toThrow("DEDICATED_ENDPOINT");
    expect(calls).toEqual([]); expect(io.storage).not.toHaveBeenCalled();
  });

  it.each(PRIVATE_CONFIGURED_BUSINESS_ARTIFACT_KEYS)("refuses generic registration of %s even with no linked job", async artifactKey => {
    await expect(registerUnifiedArtifact({ workspaceId: 42, artifactKey, sourceTable: null, sourceAiJobRunId: null,
      content: "forged-current", isCurrent: true })).rejects.toThrow("DEDICATED_ENDPOINT");
    expect(calls).toEqual([]); expect(io.storage).not.toHaveBeenCalled();
  });

  it("does not hydrate a private key even if a faulty driver returns a row excluded by the SQL", async () => {
    io.execute.mockResolvedValue([[target]]);
    await expect(resolveUnifiedArtifact({ ...scope, artifactId: "known-private-id" })).rejects.toThrow("DEDICATED_ENDPOINT");
    await expect(listUnifiedArtifactVersions({ ...scope, includeContent: false })).rejects.toThrow("DEDICATED_ENDPOINT");
    expect(io.storage).not.toHaveBeenCalled(); expect(io.http).not.toHaveBeenCalled();
  });

  it("retains legacy artifacts with a null source table and an ordinary source job", async () => {
    Object.assign(target, { artifactKey: "legacy.image", sourceTable: null, sourceAiJobRunId: "legacy-job", status: "final", isCurrent: 1 });
    expect(await resolveUnifiedArtifact({ ...scope, artifactId: "known-private-id" })).toMatchObject({ content: { private: "full-source-and-model-candidate" } });
  });

  it("excludes private rows from generic archive/delete export candidate SQL as well", () => {
    for (const mode of ["archive", "delete"] as const) {
      const jobs = DATA_LIFECYCLE_POLICIES.find(item => item.slug === "ai_jobs.completed")!;
      expect(buildLifecycleCandidateSql(jobs, mode, "'2026-01-01'")).toContain("kind <> 'knowledge.image_tagging.v1'");
      expect(buildLifecycleCandidateSql(jobs, mode, "'2026-01-01'")).toContain("kind NOT IN ('image.workflow.outline.v1','product.development.market_overview.v1')");
      const artifacts = DATA_LIFECYCLE_POLICIES.find(item => item.slug === "ai_artifacts.versions")!;
      checkPredicate(buildLifecycleCandidateSql(artifacts, mode, "'2026-01-01'"));
    }
  });

  it.each(["user", "admin", "super_admin"])("%s cannot retrieve private consumption metadata by a known ID", async role => {
    io.raw.mockImplementation(async (query: string, params: unknown[]) => {
      checkPredicate(query);
      expect(query).toContain("INNER JOIN ai_artifacts a ON a.artifactId=c.artifactId AND a.workspaceId <=> c.workspaceId");
      expect(query).toContain("WHERE c.artifactId=? AND c.workspaceId=?");
      expect(params).toEqual(["known-private-id", 42, 100]);
      return [];
    });
    const api = emperorArtifactsRouter.createCaller({ user: { id: 7, role }, workspaceId: 42, req: {}, res: {} } as TrpcContext);
    expect(await api.listConsumptions({ artifactId: "known-private-id" })).toEqual([]);
    expect(io.raw).toHaveBeenCalledOnce(); expect(io.storage).not.toHaveBeenCalled();
  });

  const consumption = { workspaceId: 42,
    artifact: { artifactId: "legacy-id", artifactKey: "legacy-image", version: 1, ref: buildUnifiedArtifactRef("legacy-id", 1) },
    consumerDomain: "agent" as const, consumerType: "agent_node" as const, consumerId: "node" };
  it("retains a normal persisted artifact's generic consumption insertion", async () => {
    io.execute.mockResolvedValueOnce([[{ artifactId: "legacy-id" }]]).mockResolvedValueOnce([{ affectedRows: 1 }]);
    await expect(recordUnifiedArtifactConsumption(consumption)).resolves.toBeUndefined();
    expect(io.execute).toHaveBeenCalledTimes(2);
    expect(dialect.sqlToQuery(io.execute.mock.calls[1][0]).sql).toContain("INSERT INTO ai_artifact_consumptions");
  });
  it("missing legacy artifacts skip best-effort consumption instead of failing the consumer", async () => {
    io.execute.mockResolvedValueOnce([[]]);
    await expect(recordUnifiedArtifactConsumption(consumption)).resolves.toBeUndefined();
    expect(io.execute).toHaveBeenCalledOnce();
  });
  it("retains the original missing-lifecycle-schema best-effort behavior", async () => {
    io.execute.mockRejectedValueOnce(new Error("Table 'synthetic.ai_artifacts' doesn't exist"));
    await expect(recordUnifiedArtifactConsumption(consumption)).resolves.toBeUndefined();
    expect(io.execute).toHaveBeenCalledOnce();
  });
  it("propagates other database failures exactly as the previous insertion path did", async () => {
    const error = new Error("synthetic database unavailable"); io.getDb.mockRejectedValueOnce(error);
    await expect(recordUnifiedArtifactConsumption(consumption)).rejects.toBe(error);
    expect(io.execute).not.toHaveBeenCalled();
  });
});
