import { describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  invokeLLM: vi.fn(),
  safeHttpRequest: vi.fn(),
}));

vi.mock("./repositories/dbClient", () => ({
  getDb: vi.fn(async () => ({ execute: mocks.execute })),
}));
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

const dialect = new MySqlDialect();
const renderedSql = (query: unknown) => dialect.sqlToQuery(query as any).sql;
const callCountUpdates = () => mocks.execute.mock.calls
  .map(([query]) => renderedSql(query))
  .filter((statement) => statement === "UPDATE emperor_skills SET callCount = callCount + 1 WHERE slug = ?");

const skill = {
  slug: "quality.demo",
  name: "Quality demo",
  version: 7,
  status: "Published",
  manifest: JSON.stringify({
    implementation: {
      systemPrompt: "Return the test response.",
      userPromptTemplate: "{{context}}",
      modelPolicy: "test-model",
    },
  }),
};
const model = {
  slug: "test-model",
  provider: "manus_builtin",
  modelId: "test-model",
  isActive: true,
};

function mockSuccessfulRun() {
  mocks.execute.mockReset();
  mocks.invokeLLM.mockReset();
  mocks.safeHttpRequest.mockReset();
  mocks.execute.mockImplementation(async (query: unknown) => {
    const statement = renderedSql(query);
    if (statement.startsWith("SELECT * FROM emperor_skills")) return [[skill]];
    if (statement.startsWith("SELECT * FROM emperor_model_providers")) return [[model]];
    return [[]];
  });
  mocks.invokeLLM.mockResolvedValue({
    choices: [{ message: { content: "mocked response" } }],
    usage: { prompt_tokens: 3, completion_tokens: 5 },
  });
}

async function run(executionPreset?: "standard" | "evaluation") {
  return runEmperorSkill({
    skillSlug: skill.slug,
    userId: 42,
    variables: {},
    context: "offline fixture",
    executionPreset,
    fallbackModels: [],
    maxModelAttempts: 1,
  });
}

describe("皇帝Skill调用量计量", () => {
  it("正常运行成功后增加正常调用量，且不访问外部Provider", async () => {
    mockSuccessfulRun();

    await expect(run("standard")).resolves.toMatchObject({ executionPreset: "standard" });

    expect(mocks.invokeLLM).toHaveBeenCalledTimes(1);
    expect(mocks.safeHttpRequest).not.toHaveBeenCalled();
    expect(callCountUpdates()).toHaveLength(1);
  });

  it("质量门禁回放使用evaluation preset，成功后不增加正常调用量", async () => {
    mockSuccessfulRun();

    await expect(run("evaluation")).resolves.toMatchObject({ executionPreset: "evaluation" });

    expect(mocks.invokeLLM).toHaveBeenCalledTimes(1);
    expect(mocks.safeHttpRequest).not.toHaveBeenCalled();
    expect(callCountUpdates()).toHaveLength(0);
  });
});
