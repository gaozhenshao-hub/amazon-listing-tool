import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { MySqlDialect } from "drizzle-orm/mysql-core";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  invokeLLM: vi.fn(),
  safeHttpRequest: vi.fn(),
}));
vi.mock("./repositories/dbClient", () => ({ getDb: vi.fn(async () => ({ execute: mocks.execute })) }));
vi.mock("./_core/llm", () => ({ invokeLLM: mocks.invokeLLM }));
vi.mock("./infrastructure/http/safeHttpClient", () => ({
  SafeHttpError: class SafeHttpError extends Error {},
  safeHttpRequest: mocks.safeHttpRequest,
}));
vi.mock("./domains/ai_os/services/observability", () => ({
  recordAiOsEvaluation: vi.fn(),
  recordAiOsMetric: vi.fn(),
}));

import { runEmperorSkill } from "./domains/ai_os/services/skillRunner";
import { skillRolloutBucket } from "./domains/ai_os/services/skillRollout";

const dialect = new MySqlDialect();
const baseManifest = {
  implementation: { systemPrompt: "original prompt", userPromptTemplate: "original {{context}}", modelPolicy: "base-policy" },
};
const candidateManifest = {
  implementation: { systemPrompt: "candidate prompt", userPromptTemplate: "candidate {{context}}", modelPolicy: "candidate-policy" },
};
const baseSkill = {
  slug: "rollout.test", name: "Rollout test", workspaceId: 12, version: 7, status: "Published",
  modelOverride: "original-model", manifest: JSON.stringify(baseManifest),
};
const plan = {
  planId: "plan-1", skillSlug: baseSkill.slug, snapshotId: "snapshot-1", status: "active",
  skillVersion: "8", snapshotHash: "snapshot-hash", rolloutPercent: 50,
  allowedUserIds: "[]", allowedProjectIds: "[]",
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 16);
const bucketFor = (userId: number, projectId: number | null = 34) => skillRolloutBucket({
  skillSlug: baseSkill.slug, snapshotId: plan.snapshotId, workspaceId: 12, userId, projectId,
});
const hitUserId = Array.from({ length: 100 }, (_, index) => index + 1).find((id) => bucketFor(id) < 50)!;
const missUserId = Array.from({ length: 100 }, (_, index) => index + 1).find((id) => bucketFor(id) >= 50)!;

function insertedRun() {
  const call = mocks.execute.mock.calls.find(([query]) => dialect.sqlToQuery(query).sql.startsWith("INSERT INTO emperor_skill_runs"));
  expect(call).toBeDefined();
  return dialect.sqlToQuery(call![0]);
}

function mockRun(activePlan: typeof plan | null, snapshot = { manifest: JSON.stringify(candidateManifest), modelOverride: "candidate-model" as string | null }) {
  mocks.execute.mockImplementation(async (query: unknown) => {
    const { sql } = dialect.sqlToQuery(query as any);
    if (sql.startsWith("SELECT * FROM emperor_skills")) return [[baseSkill]];
    if (sql.startsWith("SELECT * FROM emperor_skill_rollout_plans")) return [activePlan ? [activePlan] : []];
    if (sql.startsWith("SELECT manifest,modelOverride FROM emperor_skill_version_snapshots")) return [[snapshot]];
    if (sql.startsWith("SELECT * FROM emperor_model_providers")) {
      // Fail closed if rollout model selection unexpectedly goes to a network provider.
      return [[{ slug: "unused", provider: "manus_builtin", modelId: "unused", isActive: true }]];
    }
    return [[]];
  });
}

async function run(userId = hitUserId, extra: Record<string, unknown> = {}) {
  return runEmperorSkill({
    skillSlug: baseSkill.slug, workspaceId: 12, projectId: 34, userId,
    context: "offline", variables: {}, fallbackModels: [], maxModelAttempts: 1, ...extra,
  });
}

describe("Skill runner active rollout (mocked DB and LLM only)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invokeLLM.mockResolvedValue({
      choices: [{ message: { content: "offline result" } }],
      usage: { prompt_tokens: 2, completion_tokens: 3 },
    });
  });

  it("keeps the original version, model and prompt when there is no active plan", async () => {
    mockRun(null);
    const result = await run();
    expect(result).toMatchObject({ skillVersion: "7", skillPromptHash: hash("original prompt"), skillManifestHash: hash(JSON.stringify(baseManifest)) });
    expect(mocks.invokeLLM.mock.calls[0][0].messages[0].content).toBe("original prompt");
    expect(insertedRun().params[7]).toBeNull();
    expect(JSON.parse(insertedRun().params[9] as string)).not.toHaveProperty("__rollout");
    expect(JSON.parse(dialect.sqlToQuery(mocks.execute.mock.calls.find(([query]) => dialect.sqlToQuery(query).sql.startsWith("UPDATE emperor_skill_runs SET status=?,output="))![0]).params[1] as string).rollout).toBeNull();
    expect(mocks.safeHttpRequest).not.toHaveBeenCalled();
  });

  it("uses candidate snapshot and persists the stable bucket and plan audit only on an active hit", async () => {
    mockRun({ ...plan, allowedUserIds: JSON.stringify([hitUserId]), allowedProjectIds: "[34]" });
    const result = await run();
    expect(result).toMatchObject({ skillVersion: "8", skillPromptHash: hash("candidate prompt"), skillManifestHash: hash(JSON.stringify(candidateManifest)) });
    expect(mocks.invokeLLM.mock.calls[0][0].messages).toEqual([
      { role: "system", content: "candidate prompt" }, { role: "user", content: "candidate offline" },
    ]);
    const modelQuery = mocks.execute.mock.calls.find(([query]) => dialect.sqlToQuery(query).sql.startsWith("SELECT * FROM emperor_model_providers"));
    expect(dialect.sqlToQuery(modelQuery![0]).params.slice(0, 2)).toEqual(["candidate-model", "candidate-model"]);
    expect(insertedRun().params[4]).toBe(8);
    expect(insertedRun().params[7]).toBe("skill_rollout:plan-1");
    const input = JSON.parse(insertedRun().params[9] as string);
    expect(input.__rollout).toEqual({ planId: "plan-1", snapshotId: "snapshot-1", snapshotHash: "snapshot-hash", bucket: bucketFor(hitUserId), rolloutPercent: 50 });
    expect(input.__promptAudit).toMatchObject({ skillVersion: "8", skillManifestHash: hash(JSON.stringify(candidateManifest)) });
    const outputQuery = mocks.execute.mock.calls.find(([query]) => dialect.sqlToQuery(query).sql.startsWith("UPDATE emperor_skill_runs SET status=?,output="));
    expect(JSON.parse(dialect.sqlToQuery(outputQuery![0]).params[1] as string).rollout).toEqual(input.__rollout);
    expect(mocks.safeHttpRequest).not.toHaveBeenCalled();
  });

  it("does not retain the original model override when the candidate uses only manifest modelPolicy", async () => {
    mockRun(plan, { manifest: JSON.stringify(candidateManifest), modelOverride: null });
    await run();
    const modelQuery = mocks.execute.mock.calls.find(([query]) => dialect.sqlToQuery(query).sql.startsWith("SELECT * FROM emperor_model_providers"));
    expect(dialect.sqlToQuery(modelQuery![0]).params.slice(0, 2)).toEqual(["candidate-policy", "candidate-policy"]);
  });

  it("keeps original version on an active plan bucket miss or project allowlist miss", async () => {
    mockRun(plan);
    expect(bucketFor(missUserId)).toBeGreaterThanOrEqual(50);
    expect((await run(missUserId)).skillVersion).toBe("7");
    expect(insertedRun().params[7]).toBeNull();
    expect(mocks.execute.mock.calls.some(([query]) => dialect.sqlToQuery(query).sql.startsWith("SELECT manifest,modelOverride FROM emperor_skill_version_snapshots"))).toBe(false);

    vi.clearAllMocks();
    mocks.invokeLLM.mockResolvedValue({ choices: [{ message: { content: "offline result" } }] });
    mockRun({ ...plan, allowedProjectIds: "[999]" });
    expect((await run(hitUserId)).skillVersion).toBe("7");
    expect(insertedRun().params[7]).toBeNull();
  });

  it.each(["snapshot", "pinned"] as const)("skips the resolver and original version does not drift under %s policy", async (policy) => {
    mockRun(plan);
    const result = await run(hitUserId, { skillVersionPolicy: policy, expectedSkillVersion: 7, expectedSkillPromptHash: hash("original prompt") });
    expect(result.skillVersion).toBe("7");
    expect(mocks.execute.mock.calls.some(([query]) => dialect.sqlToQuery(query).sql.includes("emperor_skill_rollout_plans"))).toBe(false);
    expect(insertedRun().params[7]).toBeNull();
  });

  it("skips implicit snapshot policy when an expected version/hash is provided", async () => {
    mockRun(plan);
    const result = await run(hitUserId, { expectedSkillVersion: 7, expectedSkillPromptHash: hash("original prompt") });
    expect(result.skillVersion).toBe("7");
    expect(mocks.execute.mock.calls.some(([query]) => dialect.sqlToQuery(query).sql.includes("emperor_skill_rollout_plans"))).toBe(false);
  });
});
