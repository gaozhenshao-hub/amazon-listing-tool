import { createHash } from "node:crypto";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { CompetitorAnalysis } from "../../../../drizzle/schema/project";
import type { DbExecutor } from "../../../repositories/dbClient";
import { competitorRevision } from "../../../repositories/project/competitorWritePolicy";
import { competitorDeepAdoptionArtifactId, competitorDeepAdoptionCanonical as canonical, competitorDeepAdoptionHash as hash,
  competitorDeepAdoptionSourceFingerprint as fingerprint, CompetitorDeepAdoptionArtifactSchema, CompetitorDeepAdoptionRefSchema } from "../../../../shared/competitorDeepAdoption";
import { createDeepAdoptionCandidateFixture } from "./competitorDeepAdoption.testFixture";
import { createDeepAdoptionSqlFixture } from "../../../repositories/listing/competitorDeepAdoption.testFixture";
import { issueActiveCompetitorResearch } from "../../../services/competitorActiveResearch";
import { cloneActiveResearch, getActiveCompetitorResearchDelivery, hydrateActiveCompetitorResearch, hydrateActiveCompetitorResearchForLockedRow,
  readActiveCompetitorResearch, renderActiveCompetitorResearchContext } from "./competitorActiveResearch";
import { buildSellingPointPlanningResearch, normalizeSellingPointPlanningOutput } from "./sellingPointPlanning";
import { buildCompetitorResearchSource } from "./competitorResearchSource";
import { buildProductContext } from "../routerContext";

const deps = vi.hoisted(() => ({ analyses: vi.fn(), project: vi.fn(), comparison: vi.fn() }));
vi.mock("../repository", () => ({ getCompetitorAnalysesByProject: deps.analyses, getProjectByIdAdmin: deps.project,
  getLatestCompetitorComparisonReport: deps.comparison }));
import { prepareListingResearchSelection, assertListingResearchSelection } from "./listingResearchSelection";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const clone = <T>(value: T): T => structuredClone(value);
const dialect = new MySqlDialect();
const operationId = "a1234567-1234-4234-8234-123456789abc";
async function fixture() {
  const candidate = await createDeepAdoptionCandidateFixture();
  const row: CompetitorAnalysis = { ...candidate.state.analysis, reviewAnalysis: JSON.stringify({ painPoints: [{ point: "OLD AI MUST NOT RETURN" }] }),
    rawData: JSON.stringify({ ...JSON.parse(candidate.state.analysis.rawData!), advantages: ["OLD ADVANTAGE"], deepAnalysis: { stale: "OLD DEEP" } }) };
  const sourceFingerprint = fingerprint(row), identity = { userId: 3, workspaceId: 7, sourceWorkspaceId: 7, projectId: 11, analysisId: 21, asin: row.asin };
  const adoptedAt = "2026-10-18T00:00:00.000Z", summary = "Human adopted external summary";
  const body = CompetitorDeepAdoptionArtifactSchema.parse({ version: 1, kind: "adopted_competitor_deep_research", identity, operationId,
    jobRunId: candidate.state.job.runId, originalArtifactId: candidate.receipt.artifactId, publicationRevision: candidate.receipt.committedRevision,
    resultHash: candidate.result.resultHash, evidenceHash: candidate.receipt.evidenceHash, skillPlanHash: candidate.receipt.skillPlanHash,
    journalHash: candidate.receipt.journalHash, sourceFingerprint, summary, summaryVersion: 3, adoptedBy: 3, adoptedAt, result: candidate.result });
  const ref = CompetitorDeepAdoptionRefSchema.parse({ version: 1, kind: "competitor_deep_adoption", artifactId: competitorDeepAdoptionArtifactId({ ...identity, operationId }),
    operationId, jobRunId: body.jobRunId, resultHash: body.resultHash, evidenceHash: body.evidenceHash, sourceFingerprint,
    projectionHash: hash(body), summaryHash: hash(summary), summaryVersion: 3, adoptedBy: 3, adoptedAt });
  Object.assign(row, { summary, summaryStatus: "confirmed", summaryVersion: 3, summaryConfirmedBy: 3, summaryConfirmedAt: new Date(adoptedAt),
    updatedAt: new Date(adoptedAt), rawData: JSON.stringify({ ...JSON.parse(row.rawData!), deepAdoptionRef: ref }) });
  const artifact: Record<string, unknown> = { ...candidate.state.artifact, artifactId: ref.artifactId, artifactKey: `listing.competitor_deep_adopt.${row.asin}`,
    sourceType: "user_edit", status: "final", version: 3, contentHash: ref.projectionHash, fileSizeBytes: Buffer.byteLength(canonical(body)),
    contentWire: JSON.stringify(body), metadataWire: JSON.stringify({ version: 1, kind: "competitor_deep_adoption", ref, identity, requestHash: "a".repeat(64) }) };
  const calls: { sql: string; params: unknown[] }[] = [];
  const control = { fail: "", ackFailure: false, patch: {} as Record<string, unknown>, originalPatch: {} as Record<string, unknown> };
  const wire = (prefix: string, text: unknown) => ({ [`${prefix}Text`]: text, [`${prefix}Bytes`]: Buffer.byteLength(String(text)), [`${prefix}WireHash`]: digest(String(text)) });
  const tx = { execute: async (statement: SQL) => {
    const query = dialect.sqlToQuery(statement); calls.push(query);
    expect(query.sql).not.toMatch(/^(INSERT|UPDATE|DELETE)/u); expect(query.sql).not.toContain("SELECT *");
    if (control.fail && query.sql.includes(control.fail)) throw new Error("PRIVATE SQL / SECRET");
    if (query.sql.includes("FROM ai_jobs")) {
      const { inputWire, outputWire, ...job } = candidate.state.job;
      return [[{ ...job, ...wire("input", inputWire), ...wire("output", outputWire) }], []];
    }
    if (query.sql.includes("FROM projects")) return [[clone(candidate.state.project)], []];
    if (query.sql.includes("FROM competitorAnalyses")) return [[{ ...clone(row), columnsWithinLimit: 1, ...control.patch }], []];
    if (query.sql.includes("FROM ai_artifacts")) {
      const saved = query.params[0] === ref.artifactId ? artifact : { ...candidate.state.artifact, ...control.originalPatch };
      const { contentWire, metadataWire, ...metadata } = saved;
      return [[{ ...metadata, ...wire("content", contentWire), ...wire("metadata", metadataWire) }], []];
    }
    throw new Error("Unexpected query");
  } } as unknown as DbExecutor;
  const database = vi.fn(async () => ({ transaction: async <T>(callback: (tx: DbExecutor) => Promise<T>) => {
    const result = await callback(tx); if (control.ackFailure) throw new Error("PRIVATE ACK"); return result;
  } }));
  const hydrate = () => hydrateActiveCompetitorResearch(row, undefined, database as unknown as Parameters<typeof hydrateActiveCompetitorResearch>[2]);
  deps.project.mockResolvedValue(candidate.state.project); deps.analyses.mockImplementation(async () => [row]); deps.comparison.mockResolvedValue(null);
  return { ...candidate, row, body, ref, artifact, identity, calls, control, tx, database, hydrate };
}
const research = (row: CompetitorAnalysis) => buildSellingPointPlanningResearch({ projectId: 11, competitors: [row], reviewAggregation: null,
  keywords: [], buyerQuestions: [], confirmedComparison: null });

describe("current adopted deep research proof and actual consumers", () => {
  it("uses the real adoption writer receipt and artifact in hydrate→selection→planning (SQL protocol, not native DB)", async () => {
    const f = await createDeepAdoptionSqlFixture(), request = f.input();
    const saved = await f.service.adopt(f.ctx, request);
    expect(saved.status).toBe("committed");
    await hydrateActiveCompetitorResearch(f.state.analysis, { execute: f.execute } as DbExecutor);
    expect(readActiveCompetitorResearch(f.state.analysis)).toMatchObject({ status: "adopted_deep", ref: saved.ref, summary: request.summary });
    deps.project.mockResolvedValue(f.state.project); deps.analyses.mockImplementation(async () => [f.state.analysis]); deps.comparison.mockResolvedValue(null);
    const selected = await prepareListingResearchSelection({ projectId: 11, workspaceId: 7, analysisIds: [21] });
    const active = readActiveCompetitorResearch(selected.competitors[0]);
    expect(active.status).toBe("adopted_deep");
    expect(JSON.stringify(research(selected.competitors[0]))).toContain(saved.ref!.projectionHash);
    expect(JSON.parse(f.state.analysis.rawData!).analysisStale).toBe(true);
    expect(f.state.artifacts).toHaveLength(1); expect(f.state.audits).toHaveLength(1);
  });
  it("replays the saved candidate and full independent adoption, then preserves proof through selection cloning", async () => {
    const f = await fixture(), before = clone(f.row);
    expect(readActiveCompetitorResearch(f.row).status).toBe("unavailable");
    await f.hydrate(); expect(readActiveCompetitorResearch(f.row).status).toBe("adopted_deep");
    expect(f.row).toEqual(before); expect(Object.keys(f.row)).not.toContain("activeResearch");
    expect(getActiveCompetitorResearchDelivery(f.row)).toEqual({ status: "adopted_deep", identity: f.identity, ref: f.ref, currentRevision: competitorRevision(f.row) });
    const selected = await prepareListingResearchSelection({ projectId: 11, workspaceId: 7, analysisIds: [21] });
    expect(selected.competitors[0]).not.toBe(f.row);
    expect(readActiveCompetitorResearch(selected.competitors[0]).status).toBe("adopted_deep");
    expect(await assertListingResearchSelection(selected.binding, { projectId: 11, workspaceId: 7 })).toMatchObject({ binding: selected.binding });
    expect(f.calls.map(call => call.sql.match(/FROM (\w+)/u)?.[1])).toEqual(["ai_jobs", "projects", "competitorAnalyses", "ai_artifacts", "ai_artifacts"]);
    expect(f.calls.every(call => call.sql.endsWith("FOR SHARE"))).toBe(true);
  });
  it.each([8, null])("does not use a legacy NULL parent to admit workspace-7 private adopted research in workspace %s", async workspaceId => {
    const f = await createDeepAdoptionSqlFixture({ sourceWorkspaceId: null });
    await f.service.adopt(f.ctx, f.input());
    await hydrateActiveCompetitorResearch(f.state.analysis, { execute: f.execute } as DbExecutor);
    expect(readActiveCompetitorResearch(f.state.analysis)).toMatchObject({ status: "adopted_deep", identity: { workspaceId: 7, sourceWorkspaceId: null } });
    deps.project.mockResolvedValue(f.state.project); deps.analyses.mockResolvedValue([f.state.analysis]); deps.comparison.mockClear();
    await expect(prepareListingResearchSelection({ projectId: 11, workspaceId, analysisIds: [21] }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(deps.comparison).not.toHaveBeenCalled();
    expect((await prepareListingResearchSelection({ projectId: 11, workspaceId: 7, analysisIds: [21] })).competitors).toHaveLength(1);
  });
  it.each([{ projectId: 12 }, { analysisId: 22 }, { asin: "B000000999" }])("refuses a trusted proof with an inconsistent selected source identity %j", async patch => {
    const f = await fixture(); await f.hydrate(); const active = readActiveCompetitorResearch(f.row);
    if (active.status !== "adopted_deep") throw new Error("Expected proof");
    issueActiveCompetitorResearch(f.row, { ...active, identity: { ...active.identity, ...patch } });
    await expect(prepareListingResearchSelection({ projectId: 11, workspaceId: 7, analysisIds: [21] }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("passes exact groups/denominator/claim basis into seven directions and excludes retained old AI in all contexts", async () => {
    const f = await fixture(); await f.hydrate(); const projected = research(f.row);
    expect(projected.competitors.records[0]).toMatchObject({ confirmedCompetitorSummary: f.body.summary, observedAdvantages: [], observedWeaknesses: [], adoptedReference: f.ref });
    expect(projected.reviews.records).toContainEqual(expect.objectContaining({ sourceId: `competitorAnalyses:21:adoptedDeep:${f.ref.artifactId}:buyers:group:1`, category: "review_theme_group", denominator: 1, frequency: 1 }));
    expect(projected.reviews.records).toContainEqual(expect.objectContaining({ sourceId: `competitorAnalyses:21:adoptedDeep:${f.ref.artifactId}:summary:positioning`, basis: "review_feedback", references: ["buyers:group:1"] }));
    for (const context of [JSON.stringify(projected), buildCompetitorResearchSource(f.row).context,
      buildProductContext({}, [f.row], undefined, { projectId: 11, workspaceId: 7, userId: 3 }), renderActiveCompetitorResearchContext(f.row)]) {
      expect(context).not.toContain("OLD AI"); expect(context).not.toContain("OLD ADVANTAGE"); expect(context).not.toContain("OLD DEEP");
      expect(context).toContain(f.ref.projectionHash);
    }
    expect(buildCompetitorResearchSource(f.row).evidence).toMatchObject({ originalReviewsAvailable: true, reviewAnalysisAvailable: true });
  });
  it.each([undefined, { projectId: 11, workspaceId: 8, userId: 3 }, { projectId: 11, workspaceId: null, userId: 3 },
    { projectId: 11, workspaceId: 7, userId: 4 }, { projectId: 12, workspaceId: 7, userId: 3 }])(
    "product context requires explicit matching private research scope %j", async scope => {
      const f = await fixture(); await f.hydrate();
      expect(() => buildProductContext({ id: 11, workspaceId: null }, [f.row], undefined, scope))
        .toThrow("DEEP_ADOPTION_SOURCE_SCOPE_CHANGED");
    });
  it("rejects an omitted/fabricated deep entry citation instead of accepting a valid parent prefix", async () => {
    const f = await fixture(); await f.hydrate(); const projected = research(f.row);
    const plan = { sellingPoints: Array.from({ length: 7 }, (_, i) => ({ index: i + 1, theme: `Theme ${i}`, themeZh: `方向${i}`, description: "Buyer angle", descriptionZh: "买家方向",
      fabeDirection: { feature: "待补证", advantage: "待补证", benefit: "待补证", evidence: "待补证" }, targetKeywords: [], addressesGap: `competitorAnalyses:21:adoptedDeep:${f.ref.artifactId}:buyers:group:999`, checkListTargets: [] })),
      overallStrategy: "Missing product evidence", checkListCoverage: { B4_order: "Evidence gap" } };
    expect(() => normalizeSellingPointPlanningOutput(plan, projected)).toThrow();
    plan.sellingPoints.forEach(point => point.addressesGap = "competitorAnalyses:21:adoptedDeep:invented:1");
    expect(() => normalizeSellingPointPlanningOutput(plan, projected)).toThrow();
    plan.sellingPoints.forEach(point => point.addressesGap = `competitorAnalyses:21:adoptedDeep:${f.ref.artifactId}:buyers:group:1`);
    expect(normalizeSellingPointPlanningOutput(plan, projected).sellingPoints).toHaveLength(7);
  });
  it("keeps a high-frequency 120-review group and its claim inside the prompt budget with honest excerpts", async () => {
    const f = await fixture(); await f.hydrate(); const active = readActiveCompetitorResearch(f.row);
    if (active.status !== "adopted_deep") throw new Error("Expected proof");
    // Projection-only stress input at the trusted issuance boundary. The
    // independent test above proves real writer/replay/consumer integration;
    // this synthetic enlargement does not pretend to be a published artifact.
    const enlarged = clone(active), group = enlarged.result.deepAnalysis.buyers.groups[0];
    group.count = 120; group.denominator = 200; group.percentage = 60;
    group.reviewIds = Array.from({ length: 120 }, (_, index) => `review-${index}-${"a".repeat(64)}`);
    group.themeIds = Array.from({ length: 120 }, (_, index) => `buyers:batch:${index}:theme:1`);
    group.evidence[0].body = "Long original body; ".repeat(1000);
    enlarged.result.deepAnalysis.buyers.sampleCount = 200;
    issueActiveCompetitorResearch(f.row, enlarged);
    const projected = research(f.row), row = projected.reviews.records.find(row => row.category === "review_theme_group")!;
    expect(row).toMatchObject({ frequency: 120, denominator: 200, percentage: 60,
      reviewIds: { shownCount: 3, totalCount: 120, omittedCount: 117 }, themeIds: { totalCount: 120, omittedCount: 117 } });
    expect((row.evidence as { bodyExcerpt: string; originalLength: number; omittedCharacters: number }[])[0]).toEqual(expect.objectContaining({
      bodyExcerpt: group.evidence[0].body.slice(0, 180), originalLength: group.evidence[0].body.length, omittedCharacters: group.evidence[0].body.length - 180 }));
    const claim = projected.reviews.records.find(row => row.category === "adopted_external_summary_claim")!;
    expect(claim).toMatchObject({ references: ["buyers:group:1"], referenceEntries: [expect.objectContaining({ entryId: "buyers:group:1", count: 120, denominator: 200 })] });
    expect(JSON.stringify(row).length).toBeLessThan(3000); expect(JSON.stringify(claim).length).toBeLessThan(3000);
    expect(JSON.stringify(projected.reviews.records).length).toBeLessThan(5400);
    const rendered = JSON.parse(renderActiveCompetitorResearchContext(f.row));
    expect(rendered.included.groups.records[0]).toMatchObject({ entryId: "buyers:group:1", count: 120, denominator: 200, percentage: 60 });
    expect(rendered.included.groups.omittedCount).toBe(0); expect(rendered.completeProjection).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(rendered))).toBeLessThan(60 * 1024);
  });
  it("long human summaries remain complete in the immutable artifact but disclose prompt shortening", async () => {
    const f = await createDeepAdoptionSqlFixture(), request = { ...f.input(), summary: "灯".repeat(5000) };
    await f.service.adopt(f.ctx, request);
    await hydrateActiveCompetitorResearch(f.state.analysis, { execute: f.execute } as DbExecutor);
    const active = readActiveCompetitorResearch(f.state.analysis); if (active.status !== "adopted_deep") throw new Error("Expected proof");
    expect(active.summary).toHaveLength(5000);
    const context = JSON.parse(renderActiveCompetitorResearchContext(f.state.analysis));
    expect(context.summaryTruncated).toBe(true); expect(context.completeProjection).toBe(false); expect(context.summary).toContain("[truncated]");
    expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThan(61 * 1024);
    expect(JSON.parse(String(f.state.artifacts[0].contentText)).summary).toHaveLength(5000);
  });
  it.each(["title", "summary", "summaryStatus", "summaryVersion", "rawData", "updatedAt", "summaryConfirmedAt"])("invalidates issued proof after current %s mutation", async key => {
    const f = await fixture(); await f.hydrate();
    Object.assign(f.row, { [key]: key === "summaryVersion" ? 4 : key === "updatedAt" || key === "summaryConfirmedAt" ? new Date() : key === "summaryStatus" ? "draft" : key === "rawData" ? JSON.stringify({ ...JSON.parse(f.row.rawData!), unknown: 1 }) : "changed" });
    expect(readActiveCompetitorResearch(f.row).status).toBe("unavailable");
    expect(JSON.stringify(research(f.row))).not.toContain("OLD AI");
    await expect(prepareListingResearchSelection({ projectId: 11, workspaceId: 7, analysisIds: [21] })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("does not trust raw ref, a DTO field, structuredClone, or externally mutated proof data", async () => {
    const f = await fixture(); await f.hydrate();
    const copy = clone(f.row); expect(readActiveCompetitorResearch(copy).status).toBe("unavailable");
    cloneActiveResearch(f.row, copy); expect(readActiveCompetitorResearch(copy).status).toBe("adopted_deep");
    const active = readActiveCompetitorResearch(f.row); if (active.status !== "adopted_deep") throw new Error("Expected proof");
    expect(Object.isFrozen(active.result.deepAnalysis)).toBe(true);
    expect(() => { active.summary = "forged"; }).toThrow();
    expect(readActiveCompetitorResearch({ ...f.row, activeResearch: getActiveCompetitorResearchDelivery(f.row) }).status).toBe("unavailable");
  });
  it("forgets in-transaction proof if its standalone transaction ACK is lost", async () => {
    const f = await fixture(); f.control.ackFailure = true; await f.hydrate();
    expect(readActiveCompetitorResearch(f.row).status).toBe("unavailable");
  });
  it("existing transaction mode never opens a nested transaction or reverses caller locks", async () => {
    const f = await fixture(); await hydrateActiveCompetitorResearch(f.row, f.tx, f.database as unknown as Parameters<typeof hydrateActiveCompetitorResearch>[2]);
    expect(f.database).not.toHaveBeenCalled(); expect(f.calls.every(call => !/FOR (SHARE|UPDATE)/u.test(call.sql))).toBe(true);
    expect(readActiveCompetitorResearch(f.row).status).toBe("adopted_deep");
  });
  it("locked-row mode uses the caller's current locked rows, never an older ordinary snapshot", async () => {
    const f = await fixture(); f.control.patch.title = "Older snapshot"; f.control.fail = "FROM projects";
    await hydrateActiveCompetitorResearchForLockedRow(f.row, f.tx, f.state.project);
    expect(readActiveCompetitorResearch(f.row).status).toBe("adopted_deep"); expect(f.database).not.toHaveBeenCalled();
    expect(f.calls.map(call => call.sql.match(/FROM (\w+)/u)?.[1])).toEqual(["ai_jobs", "ai_artifacts", "ai_artifacts"]);
    expect(f.calls.every(call => !/FOR (SHARE|UPDATE)/u.test(call.sql))).toBe(true);
  });
  it.each([{ id: 12 }, { id: 0 }, { userId: 4 }, { userId: 0 }, { workspaceId: 8 }, { workspaceId: undefined }])(
    "locked-row mode rejects mismatched/invalid parent %j without widening the original candidate scope", async patch => {
      const f = await fixture();
      await hydrateActiveCompetitorResearchForLockedRow(f.row, f.tx, { ...f.state.project, ...patch } as Parameters<typeof hydrateActiveCompetitorResearchForLockedRow>[2]);
      expect(readActiveCompetitorResearch(f.row).status).toBe("unavailable");
    });
  it("locked-row mode still rejects oversized exact row data and unavailable immutable source", async () => {
    const f = await fixture(); f.row.title = "x".repeat(65_536);
    await hydrateActiveCompetitorResearchForLockedRow(f.row, f.tx, f.state.project);
    expect(f.calls).toHaveLength(0); expect(readActiveCompetitorResearch(f.row).status).toBe("unavailable");
    const g = await fixture(); g.control.fail = "FROM ai_jobs";
    await hydrateActiveCompetitorResearchForLockedRow(g.row, g.tx, g.state.project);
    expect(readActiveCompetitorResearch(g.row).status).toBe("unavailable");
  });
  it.each(["contentHash", "status", "sourceType", "userId", "workspaceId", "projectId", "artifactKey", "fileSizeBytes", "sourceSkillRunId"])("rejects adoption artifact %s tampering", async key => {
    const f = await fixture(); f.artifact[key] = "forged"; await f.hydrate(); expect(readActiveCompetitorResearch(f.row).status).toBe("unavailable");
  });
  it.each(["status", "sourceType", "domain", "sourceSkillRunId", "fileSizeBytes", "metadataWire"])("rejects original candidate %s tampering", async key => {
    const f = await fixture(); f.control.originalPatch[key] = "forged"; await f.hydrate(); expect(readActiveCompetitorResearch(f.row).status).toBe("unavailable");
  });
  it.each(["ai_jobs", "ai_artifacts", "projects", "competitorAnalyses"])("on %s read failure exposes only safe unavailable, not old AI", async table => {
    const f = await fixture(); f.control.fail = table; await f.hydrate();
    expect(readActiveCompetitorResearch(f.row)).toEqual({ status: "unavailable", reasonCode: "DEEP_ADOPTION_NOT_CURRENT_OR_UNVERIFIED" });
    expect(renderActiveCompetitorResearchContext(f.row)).not.toContain("PRIVATE");
  });
  it("bounds current row fields and rejects a failed full-column size guard", async () => {
    const f = await fixture(); f.control.patch.columnsWithinLimit = 0; await f.hydrate();
    expect(readActiveCompetitorResearch(f.row).status).toBe("unavailable");
    expect(f.calls.find(call => call.sql.includes("FROM competitorAnalyses"))?.sql).toContain("OCTET_LENGTH(rawData)<=65535");
  });
  it("legacy rows use no additional database IO and retain the legacy consumer output", async () => {
    const f = await fixture(); f.row.rawData = JSON.stringify({ advantages: ["Legacy advantage"] });
    await f.hydrate(); expect(f.database).not.toHaveBeenCalled(); expect(readActiveCompetitorResearch(f.row)).toEqual({ status: "legacy" });
    expect(JSON.stringify(research(f.row))).toContain("Legacy advantage");
  });
  it("does not mix an unbound project aggregation back into a deep result", async () => {
    const f = await fixture(); await f.hydrate(); const aggregate = { projectId: 11, status: "completed", painPoints: JSON.stringify([{ point: "STALE AGGREGATION" }]) };
    const value = buildSellingPointPlanningResearch({ projectId: 11, competitors: [f.row], reviewAggregation: aggregate, keywords: [], buyerQuestions: [], confirmedComparison: null });
    expect(JSON.stringify(value)).not.toContain("STALE AGGREGATION");
    expect(buildProductContext({}, [f.row], { reviewAggregation: aggregate }, { projectId: 11, workspaceId: 7, userId: 3 })).not.toContain("STALE AGGREGATION");
  });
});
