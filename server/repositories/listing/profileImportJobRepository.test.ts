import { describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import {
  createProfileImportJobRepository, decodeProfileImportInput, encodeProfileImportJson,
  profileImportRunId, profileImportHash, profileImportSession, type ProfileImportBinding, type ProfileImportStoredInput,
} from "./profileImportJobRepository";

const binding: ProfileImportBinding = { version: 1, userId: 3, workspaceId: 7, listingProjectId: 11, devProjectId: 21, profileId: 31, sourceHash: "a".repeat(64), converterVersion: 1 };
function stored(): ProfileImportStoredInput {
  return { version: 1, binding: { ...binding }, agentRunId: "synthetic-agent", agentNodeId: "N3",
    checkpoint: { stage: "reserved", analysisJson: null, analysisHash: null, fileId: null, skillRunId: null } };
}
function ready() {
  const input = stored(), analysisJson = '{"zero":0,"enabled":false}';
  input.checkpoint = { stage: "analysis_ready", analysisJson, analysisHash: profileImportHash(analysisJson), skillRunId: "skill-run", fileId: null };
  return input;
}
describe("profile import durable repository contracts", () => {
  it("operation identity is stable through JSON restart and includes actor, null workspace, target, source and conversion version", () => {
    expect(profileImportRunId(binding)).toMatch(/^profile_[a-f0-9]{64}$/);
    expect(profileImportRunId(JSON.parse(JSON.stringify(binding)))).toBe(profileImportRunId(binding));
    for (const change of [{ userId: 4 }, { workspaceId: null }, { workspaceId: 8 }, { listingProjectId: 12 }, { devProjectId: 22 }, { profileId: 32 }, { sourceHash: "b".repeat(64) }]) {
      expect(profileImportRunId({ ...binding, ...change })).not.toBe(profileImportRunId(binding));
    }
    expect(() => profileImportRunId({ ...binding, converterVersion: 2 } as any)).toThrow();
  });
  it("valid stages survive persistence with null/0/false preserved", () => {
    expect(decodeProfileImportInput(JSON.stringify(stored()))).toEqual(stored());
    expect(decodeProfileImportInput(JSON.stringify(ready()))).toEqual(ready());
    expect(encodeProfileImportJson({ zero: 0, false: false, unknown: null })).toBe('{"zero":0,"false":false,"unknown":null}');
  });
  it.each([
    (s: any) => { s.extra = true; }, (s: any) => { s.agentNodeId = "N1"; },
    (s: any) => { s.binding.workspaceId = "7"; }, (s: any) => { s.binding.userId = 0; },
    (s: any) => { s.checkpoint.stage = "analysis_ready"; }, (s: any) => { s.checkpoint.fileId = 1; },
    (s: any) => { s.checkpoint.analysisJson = "{}"; }, (s: any) => { s.checkpoint.skillRunId = "fake"; },
  ])("rejects malformed or invented checkpoints %#", mutate => { const s = stored(); mutate(s); expect(() => decodeProfileImportInput(s)).toThrow("PROFILE_IMPORT_CHECKPOINT_INVALID"); });
  it.each([
    (s: any) => { s.checkpoint.analysisHash = "b".repeat(64); },
    (s: any) => { s.checkpoint.analysisJson = "0"; s.checkpoint.analysisHash = profileImportHash("0"); },
    (s: any) => { s.checkpoint.analysisJson = "[]"; s.checkpoint.analysisHash = profileImportHash("[]"); },
    (s: any) => { s.checkpoint.analysisJson = '{"value":1e400}'; s.checkpoint.analysisHash = profileImportHash(s.checkpoint.analysisJson); },
    (s: any) => { s.checkpoint.stage = "file_committed"; },
  ])("rejects corrupt analysis and incomplete receipts %#", mutate => { const s = ready(); mutate(s); expect(() => decodeProfileImportInput(s)).toThrow(); });
  it("limits analysis TEXT by UTF8 bytes, not string length; never truncates", () => {
    const text = "你".repeat(21844); expect(Buffer.byteLength(encodeProfileImportJson(text))).toBe(65534);
    expect(() => encodeProfileImportJson(`${text}你`)).toThrow("PROFILE_IMPORT_TEXT_TOO_LARGE");
  });
  it.each([undefined, NaN, Infinity, -0, 2 ** 54, 1n, Symbol("x"), () => 1, new Date(), Buffer.from("x"), { a: undefined }, [undefined], Array(1), "\ud800"])("rejects non-lossless JSON %#", value => {
    expect(() => encodeProfileImportJson(value)).toThrow("PROFILE_IMPORT_JSON_INVALID");
  });
  it("rejects getters, symbols, cycles, hidden data and toJSON without invoking them", () => {
    const getter = vi.fn(() => 1), toJSON = vi.fn(() => ({}));
    const accessor = Object.defineProperty({}, "x", { enumerable: true, get: getter });
    const cycle: any = {}; cycle.self = cycle;
    for (const value of [accessor, cycle, { [Symbol("secret")]: 1 }, Object.defineProperty({}, "secret", { value: 1 }), { toJSON }]) expect(() => encodeProfileImportJson(value)).toThrow();
    expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
  });
  it("requires a real transaction and does not silently fall back to a plain connection", async () => {
    const execute = vi.fn(); const repo = createProfileImportJobRepository(async () => ({ execute }));
    await expect(repo.transaction(async () => 1)).rejects.toThrow("PROFILE_IMPORT_TRANSACTION_REQUIRED"); expect(execute).not.toHaveBeenCalled();
  });
  it.each([1146, 1054, 1062, 1213, 9999])("sanitizes native failure %s without SQL/credentials in public errors", async errno => {
    const repo = createProfileImportJobRepository(async () => ({ execute: vi.fn(), transaction: async () => { throw { errno, message: "password PRIVATE", sql: "PRIVATE" }; } }));
    await expect(repo.transaction(async () => 1)).rejects.toThrow(/^PROFILE_IMPORT_/);
    try { await repo.transaction(async () => 1); } catch (error) { expect(JSON.stringify(error)).not.toContain("PRIVATE"); }
  });
  it("job lock is literal SQL and binds hostile runId instead of interpolating it", async () => {
    const execute = vi.fn<(statement: SQL) => Promise<unknown>>(async () => [[], []]); const session = profileImportSession({ execute }); await session.job("x' OR 1=1");
    const actual = new MySqlDialect().sqlToQuery(execute.mock.calls[0][0] as SQL);
    expect(actual.sql).toBe("SELECT * FROM ai_jobs WHERE runId=? FOR UPDATE"); expect(actual.params).toEqual(["x' OR 1=1"]);
  });
  it("resume rejects running/succeeded and unknown checkpoints before issuing SQL", async () => {
    const execute = vi.fn(), session = profileImportSession({ execute });
    for (const status of ["running", "succeeded", "queued"]) await expect(session.resume({ status, input: stored() } as any)).rejects.toThrow("PROFILE_IMPORT_RESUME_UNSAFE");
    const input = stored(); input.checkpoint.stage = "model_dispatched";
    await expect(session.resume({ status: "failed", input } as any)).rejects.toThrow("PROFILE_IMPORT_RESUME_UNSAFE"); expect(execute).not.toHaveBeenCalled();
  });
});
