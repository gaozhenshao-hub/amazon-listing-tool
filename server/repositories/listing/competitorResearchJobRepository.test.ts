import { describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { createCompetitorResearchJobRepository, competitorResearchSession, competitorResearchRunId, decodeCompetitorResearchInput,
  encodeResearchJson, researchHash, type CompetitorResearchBinding, type CompetitorResearchStoredInput } from "./competitorResearchJobRepository";

const binding: CompetitorResearchBinding = { version: 1, userId: 3, workspaceId: 7, projectId: 11, analysisId: 21, asin: "B000000001", sourceHash: "a".repeat(64) };
function stored(): CompetitorResearchStoredInput {
  return { version: 1, binding: { ...binding }, expectedRevision: "b".repeat(64), agentRunId: "synthetic-agent", agentNodeId: "N1",
    checkpoint: { stage: "reserved", analysisJson: null, analysisHash: null, summary: null, keywordsJson: null, skillRunId: null, skillSnapshot: null, committedVersion: null } };
}
function ready() {
  const input = stored(), analysisJson = '{"summary":"Analysis"}';
  input.checkpoint = { stage: "analysis_ready", analysisJson, analysisHash: researchHash(analysisJson), summary: "Analysis", keywordsJson: null,
    skillRunId: "skill", committedVersion: null, skillSnapshot: { version: "4", status: "Released", systemPromptHash: "c".repeat(16), userPromptHash: "d".repeat(16), manifestHash: "e".repeat(16) } };
  return input;
}
describe("competitor research repository boundaries", () => {
  it("uses one deterministic source/scope anchor, not revision, time or random request keys", () => {
    expect(competitorResearchRunId(binding)).toMatch(/^competitor_[a-f0-9]{64}$/u);
    expect(competitorResearchRunId(JSON.parse(JSON.stringify(binding)))).toBe(competitorResearchRunId(binding));
    for (const patch of [{ userId: 4 }, { workspaceId: null }, { workspaceId: 8 }, { projectId: 12 }, { analysisId: 22 }, { asin: "B000000002" }, { sourceHash: "f".repeat(64) }]) {
      expect(competitorResearchRunId({ ...binding, ...patch })).not.toBe(competitorResearchRunId(binding));
    }
  });
  it("preserves every durable field through JSON restart", () => {
    for (const input of [stored(), ready()]) expect(decodeCompetitorResearchInput(JSON.stringify(input))).toEqual(input);
  });
  it.each([
    (s: any) => { s.agentNodeId = "N3"; }, (s: any) => { s.extra = true; }, (s: any) => { s.binding.workspaceId = "7"; },
    (s: any) => { s.expectedRevision = ""; }, (s: any) => { s.checkpoint.stage = "model_dispatched"; },
    (s: any) => { s.checkpoint.analysisJson = "{}"; }, (s: any) => { s.checkpoint.committedVersion = 2; },
  ])("rejects corrupt reservation %#", mutate => { const input = stored(); mutate(input); expect(() => decodeCompetitorResearchInput(input)).toThrow("COMPETITOR_RESEARCH_CHECKPOINT_INVALID"); });
  it.each([
    (s: any) => { s.checkpoint.analysisHash = "f".repeat(64); }, (s: any) => { s.checkpoint.summary = " "; },
    (s: any) => { s.checkpoint.skillSnapshot = null; }, (s: any) => { s.checkpoint.stage = "analysis_committed"; },
    (s: any) => { s.checkpoint.analysisJson = "[]"; s.checkpoint.analysisHash = researchHash("[]"); },
  ])("rejects corrupt model result %#", mutate => { const input = ready(); mutate(input); expect(() => decodeCompetitorResearchInput(input)).toThrow("COMPETITOR_RESEARCH_CHECKPOINT_INVALID"); });
  it.each([undefined, NaN, Infinity, -0, 2 ** 54, 1n, new Date(), Buffer.from("x"), [undefined], Array(1), { x: undefined }, "\ud800"])("rejects lossy JSON %#", value => expect(() => encodeResearchJson(value)).toThrow("COMPETITOR_RESEARCH_JSON_INVALID"));
  it("does not call getters/toJSON and does not truncate UTF8 TEXT", () => {
    const getter = vi.fn(), toJSON = vi.fn();
    expect(() => encodeResearchJson(Object.defineProperty({}, "x", { enumerable: true, get: getter }))).toThrow();
    expect(() => encodeResearchJson({ toJSON })).toThrow();
    expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
    expect(() => encodeResearchJson("你".repeat(21845))).toThrow("COMPETITOR_RESEARCH_TEXT_TOO_LARGE");
  });
  it("requires a real transaction", async () => {
    const execute = vi.fn(), repo = createCompetitorResearchJobRepository(async () => ({ execute }));
    await expect(repo.transaction(async () => 1)).rejects.toThrow("COMPETITOR_RESEARCH_TRANSACTION_REQUIRED"); expect(execute).not.toHaveBeenCalled();
  });
  it.each([1146, 1054, 1062, 1213, 9999])("does not expose DB errors %s", async errno => {
    const repo = createCompetitorResearchJobRepository(async () => ({ execute: vi.fn(), transaction: async () => { throw { errno, sql: "PRIVATE", message: "PRIVATE" }; } }));
    await expect(repo.transaction(async () => 1)).rejects.toThrow(/^COMPETITOR_RESEARCH_/u);
  });
  it("binds runId and source keys as values", async () => {
    const execute = vi.fn(async (_statement: SQL) => [[], []]), session = competitorResearchSession({ execute });
    await session.job("' OR 1=1"); await session.analysis(11, 21);
    const compiled = execute.mock.calls.map(([query]) => new MySqlDialect().sqlToQuery(query));
    expect(compiled.map(v => v.sql)).toEqual(["SELECT * FROM ai_jobs WHERE runId=? FOR UPDATE", "SELECT * FROM competitorAnalyses WHERE projectId=? AND id=? FOR UPDATE"]);
    expect(compiled.map(v => v.params)).toEqual([["' OR 1=1"], [11, 21]]);
  });
  it.each(["queued", "running", "succeeded"])("resume is not a generic retry for %s", async status => {
    const execute = vi.fn(); await expect(competitorResearchSession({ execute }).resume({ status, input: stored() } as any)).rejects.toThrow("COMPETITOR_RESEARCH_RESUME_UNSAFE"); expect(execute).not.toHaveBeenCalled();
  });
  it("never resumes an uncertain model dispatch", async () => {
    const input = ready(); input.checkpoint.stage = "model_dispatched";
    const execute = vi.fn(); await expect(competitorResearchSession({ execute }).resume({ status: "failed", input } as any)).rejects.toThrow("COMPETITOR_RESEARCH_RESUME_UNSAFE"); expect(execute).not.toHaveBeenCalled();
  });
});
