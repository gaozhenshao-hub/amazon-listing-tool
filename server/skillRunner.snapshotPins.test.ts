import { createHash } from "node:crypto";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getDb: vi.fn(),
  invokeLLM: vi.fn(),
  safeHttpRequest: vi.fn(),
  rollout: vi.fn(),
}));
vi.mock("./repositories/dbClient", () => ({ getDb: mocks.getDb }));
vi.mock("./_core/llm", () => ({ invokeLLM: mocks.invokeLLM }));
vi.mock("./infrastructure/http/safeHttpClient", () => ({
  SafeHttpError: class SafeHttpError extends Error {},
  safeHttpRequest: mocks.safeHttpRequest,
}));
vi.mock("./domains/ai_os/services/skillRollout", () => ({
  resolveActiveSkillRollout: mocks.rollout,
}));
vi.mock("./domains/ai_os/services/observability", () => ({
  recordAiOsEvaluation: vi.fn(),
  recordAiOsMetric: vi.fn(),
}));

import {
  getEmperorSkillRuntimeSnapshot,
  runEmperorSkill,
  SkillRunError,
} from "./domains/ai_os/services/skillRunner";

const dialect = new MySqlDialect();
const shortHash = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
const originalManifest = {
  implementation: {
    systemPrompt: "Private system prompt\n保留原文",
    userPromptTemplate: "Private template {{context}}",
    modelPolicy: "fixture-model",
    temperature: 0.2,
  },
  contract: { outputMode: "json", schemaVersion: "1" },
};
const promptHash = shortHash(originalManifest.implementation.systemPrompt);
const userHash = shortHash(originalManifest.implementation.userPromptTemplate);
const manifestHash = shortHash(JSON.stringify(originalManifest));
const skill = {
  slug: "pins.fixture",
  name: "Synthetic pin fixture",
  workspaceId: 7,
  version: 3,
  status: "Released",
  modelOverride: null as string | null,
  manifest: originalManifest as unknown,
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sqlCalls = () =>
  mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query));
function configure(
  manifest: unknown = originalManifest,
  modelOverride: string | null = null,
  status: string | null = "Released"
) {
  mocks.execute.mockImplementation(async query => {
    const compiled = dialect.sqlToQuery(query);
    if (compiled.sql.startsWith("SELECT * FROM emperor_skills"))
      return [[{ ...skill, manifest: clone(manifest), modelOverride, status }]];
    if (compiled.sql.startsWith("SELECT * FROM emperor_model_providers"))
      return [
        [
          {
            slug: compiled.params[0],
            provider: "manus_builtin",
            modelId: "synthetic-model",
            isActive: true,
          },
        ],
      ];
    return [[]];
  });
}
function run(extra: Record<string, unknown> = {}) {
  return runEmperorSkill({
    skillSlug: skill.slug,
    workspaceId: 7,
    projectId: 11,
    userId: 13,
    context: "evidence input",
    variables: {},
    fallbackModels: [],
    maxModelAttempts: 1,
    ...extra,
  });
}
function noPaidOrModelRead() {
  expect(mocks.invokeLLM).not.toHaveBeenCalled();
  expect(mocks.safeHttpRequest).not.toHaveBeenCalled();
  expect(
    sqlCalls().every(query =>
      query.sql.startsWith("SELECT * FROM emperor_skills")
    )
  ).toBe(true);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDb.mockResolvedValue({ execute: mocks.execute });
  mocks.rollout.mockResolvedValue(null);
  configure();
  mocks.invokeLLM.mockResolvedValue({
    choices: [{ message: { content: "offline result" } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  });
});

describe("Skill snapshot pin compatibility (mocked database/provider)", () => {
  it("tests server-owned draft prompts without altering the formal registry and still checks its baseline", async () => {
    const candidate = {
      systemPrompt: "candidate system",
      userPromptTemplate: "candidate {{context}}",
    };
    await run({
      executionPreset: "evaluation",
      skillVersionPolicy: "pinned",
      expectedSkillManifestHash: manifestHash,
      evaluationPrompts: candidate,
    });
    expect(mocks.invokeLLM.mock.calls[0][0].messages).toEqual([
      { role: "system", content: candidate.systemPrompt },
      { role: "user", content: "candidate evidence input" },
    ]);
    expect(
      sqlCalls().filter(query =>
        /UPDATE emperor_skills SET manifest/u.test(query.sql)
      )
    ).toHaveLength(0);
    expect(mocks.rollout).not.toHaveBeenCalled();
    vi.clearAllMocks();
    configure({ ...originalManifest, changed: true });
    await expect(
      run({
        executionPreset: "evaluation",
        skillVersionPolicy: "pinned",
        expectedSkillManifestHash: manifestHash,
        evaluationPrompts: candidate,
      })
    ).rejects.toMatchObject({ code: "SKILL_VERSION_MISMATCH" });
    expect(mocks.invokeLLM).not.toHaveBeenCalled();
  });
  it("refuses a candidate prompt on the ordinary execution lane", async () => {
    await expect(
      run({
        evaluationPrompts: {
          systemPrompt: "candidate",
          userPromptTemplate: "{{context}}",
        },
      })
    ).rejects.toThrow("固定版本");
    expect(mocks.invokeLLM).not.toHaveBeenCalled();
  });
  it.each(["Draft", "Retired", null])(
    "refuses a previously approved Skill that now has status %s before any paid work",
    async status => {
      const snapshot = await getEmperorSkillRuntimeSnapshot(skill.slug, 7);
      configure(originalManifest, null, status);
      await expect(
        run({
          skillVersionPolicy: "latest",
          expectedSkillStatus: "Released",
          expectedSkillVersion: snapshot.version,
          expectedSkillUserPromptHash: snapshot.userPromptHash,
          expectedSkillManifestHash: snapshot.manifestHash,
        })
      ).rejects.toMatchObject({
        code: "SKILL_VERSION_MISMATCH",
        retryable: false,
        message: "Skill release state changed after approval",
      });
      noPaidOrModelRead();
      expect(mocks.rollout).not.toHaveBeenCalled();
    }
  );
  it("checks a status-only pin despite explicit latest and never applies a rollout", async () => {
    await run({
      expectedSkillStatus: "Released",
      skillVersionPolicy: "latest",
    });
    expect(mocks.invokeLLM).toHaveBeenCalledOnce();
    expect(mocks.rollout).not.toHaveBeenCalled();
  });
  it.each([null, "Draft", "released", "", {}, 1])(
    "rejects malformed release-state pin %j before reading the database",
    async value => {
      await expect(run({ expectedSkillStatus: value })).rejects.toMatchObject({
        code: "SKILL_VERSION_MISMATCH",
        retryable: false,
      });
      expect(mocks.getDb).not.toHaveBeenCalled();
      noPaidOrModelRead();
    }
  );
  it("uses existing truncated SHA-256 hashes, not SHA-1, full SHA-256 or sorted JSON", async () => {
    const snapshot = await getEmperorSkillRuntimeSnapshot(skill.slug, 7);
    expect(snapshot).toMatchObject({
      version: "3",
      systemPromptHash: promptHash,
      userPromptHash: userHash,
      manifestHash,
    });
    expect(snapshot.userPromptHash).toHaveLength(16);
    expect(snapshot.manifestHash).toHaveLength(16);
    expect(snapshot.userPromptHash).not.toBe(
      createHash("sha1")
        .update(originalManifest.implementation.userPromptTemplate)
        .digest("hex")
    );
    configure({
      contract: originalManifest.contract,
      implementation: originalManifest.implementation,
    });
    expect(
      (await getEmperorSkillRuntimeSnapshot(skill.slug, 7)).manifestHash
    ).not.toBe(manifestHash);
  });

  it.each([undefined, "snapshot", "pinned", "latest"])(
    "checks user-template drift before model lookup/invocation under %s",
    async policy => {
      const changed = clone(originalManifest);
      changed.implementation.userPromptTemplate += " changed";
      configure(changed);
      await expect(
        run({
          skillVersionPolicy: policy,
          expectedSkillUserPromptHash: userHash,
        })
      ).rejects.toMatchObject({
        code: "SKILL_VERSION_MISMATCH",
        retryable: false,
        message: "Skill user prompt snapshot mismatch",
      });
      noPaidOrModelRead();
      expect(mocks.rollout).not.toHaveBeenCalled();
    }
  );

  it.each([undefined, "snapshot", "pinned", "latest"])(
    "checks non-prompt manifest drift before model lookup/invocation under %s",
    async policy => {
      const changed = clone(originalManifest);
      changed.contract.outputMode = "different";
      configure(changed);
      await expect(
        run({
          skillVersionPolicy: policy,
          expectedSkillManifestHash: manifestHash,
        })
      ).rejects.toMatchObject({
        code: "SKILL_VERSION_MISMATCH",
        retryable: false,
        message: "Skill manifest snapshot mismatch",
      });
      noPaidOrModelRead();
      expect(mocks.rollout).not.toHaveBeenCalled();
    }
  );

  it.each(["expectedSkillUserPromptHash", "expectedSkillManifestHash"])(
    "rejects invalid %s format before even loading the Skill",
    async field => {
      for (const value of [
        "",
        " ",
        "A".repeat(16),
        "x".repeat(16),
        "a".repeat(15),
        "a".repeat(17),
        "a".repeat(40),
        "a".repeat(64),
        "a".repeat(16) + "\n",
        "a".repeat(16) + "\r",
        "a".repeat(16) + "\r\n",
        null,
        123,
        [],
        {},
        new String("a".repeat(16)),
      ]) {
        vi.clearAllMocks();
        const error = await run({
          [field]: value,
          skillVersionPolicy: "latest",
        }).catch(error => error);
        expect(error).toBeInstanceOf(SkillRunError);
        expect(error).toMatchObject({
          code: "SKILL_VERSION_MISMATCH",
          retryable: false,
          message:
            field === "expectedSkillUserPromptHash"
              ? "Expected Skill user prompt hash must be 16 lowercase hexadecimal characters"
              : "Expected Skill manifest hash must be 16 lowercase hexadecimal characters",
        });
        expect(error.cause).toBeUndefined();
        expect(mocks.getDb).not.toHaveBeenCalled();
        expect(mocks.rollout).not.toHaveBeenCalled();
        noPaidOrModelRead();
      }
    }
  );

  it.each(["expectedSkillUserPromptHash", "expectedSkillManifestHash"])(
    "matching %s alone prevents a rollout even under explicit latest",
    async field => {
      mocks.rollout.mockResolvedValue({
        planId: "must-not-run",
        skillVersion: 4,
        manifest: { implementation: { systemPrompt: "rollout prompt" } },
      });
      const result = await run({
        skillVersionPolicy: "latest",
        [field]:
          field === "expectedSkillUserPromptHash" ? userHash : manifestHash,
      });
      expect(mocks.rollout).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        skillVersion: "3",
        skillPromptHash: promptHash,
        skillManifestHash: manifestHash,
      });
      expect(mocks.invokeLLM.mock.calls[0][0].messages).toEqual([
        {
          role: "system",
          content: originalManifest.implementation.systemPrompt,
        },
        { role: "user", content: "Private template evidence input" },
      ]);
      expect(mocks.safeHttpRequest).not.toHaveBeenCalled();
    }
  );

  it("accepts all four matching pins and uses the captured stored template", async () => {
    const snapshot = await getEmperorSkillRuntimeSnapshot(skill.slug, 7);
    const result = await run({
      skillVersionPolicy: "pinned",
      expectedSkillVersion: snapshot.version,
      expectedSkillPromptHash: snapshot.systemPromptHash,
      expectedSkillUserPromptHash: snapshot.userPromptHash,
      expectedSkillManifestHash: snapshot.manifestHash,
    });
    expect(result.skillManifestHash).toBe(snapshot.manifestHash);
    expect(mocks.invokeLLM).toHaveBeenCalledOnce();
    expect(mocks.rollout).not.toHaveBeenCalled();
  });

  it.each(["version", "system", "user", "manifest"])(
    "all supplied pins are enforced, including %s alongside new pins and explicit latest",
    async kind => {
      const extra = {
        skillVersionPolicy: "latest",
        expectedSkillVersion: 3,
        expectedSkillPromptHash: promptHash,
        expectedSkillUserPromptHash: userHash,
        expectedSkillManifestHash: manifestHash,
      };
      if (kind === "version") extra.expectedSkillVersion = 4;
      if (kind === "system") extra.expectedSkillPromptHash = "0".repeat(16);
      if (kind === "user") extra.expectedSkillUserPromptHash = "0".repeat(16);
      if (kind === "manifest") extra.expectedSkillManifestHash = "0".repeat(16);
      await expect(run(extra)).rejects.toMatchObject({
        code: "SKILL_VERSION_MISMATCH",
        retryable: false,
      });
      noPaidOrModelRead();
    }
  );

  it("new mismatch errors contain neither actual nor expected prompt/manifest/hash payloads", async () => {
    for (const field of [
      "expectedSkillUserPromptHash",
      "expectedSkillManifestHash",
    ]) {
      const error = await run({ [field]: "0".repeat(16) }).catch(
        error => error
      );
      expect(error).toBeInstanceOf(SkillRunError);
      const serialized = JSON.stringify(error);
      for (const forbidden of [
        originalManifest.implementation.systemPrompt,
        originalManifest.implementation.userPromptTemplate,
        userHash,
        manifestHash,
        "0".repeat(16),
      ])
        expect(serialized).not.toContain(forbidden);
      expect(error.cause).toBeUndefined();
    }
    noPaidOrModelRead();
  });

  it("does not silently canonicalize changed manifest property order", async () => {
    configure({
      contract: originalManifest.contract,
      implementation: originalManifest.implementation,
    });
    await expect(
      run({ expectedSkillManifestHash: manifestHash })
    ).rejects.toMatchObject({ code: "SKILL_VERSION_MISMATCH" });
    noPaidOrModelRead();
  });

  it("hashes the parsed manifest identically for serialized JSON and object DB representations", async () => {
    configure(JSON.stringify(originalManifest));
    await expect(
      run({
        expectedSkillUserPromptHash: userHash,
        expectedSkillManifestHash: manifestHash,
      })
    ).resolves.toMatchObject({ skillManifestHash: manifestHash });
    expect(mocks.invokeLLM).toHaveBeenCalledOnce();
  });

  it("leaves existing fallback-template behavior intact when the stored template is absent", async () => {
    const manifest = {
      implementation: { systemPrompt: "system", modelPolicy: "fixture-model" },
    };
    configure(manifest);
    const snapshot = await getEmperorSkillRuntimeSnapshot(skill.slug, 7);
    expect(snapshot.userPromptHash).toBe(shortHash(""));
    await run({
      expectedSkillUserPromptHash: snapshot.userPromptHash,
      expectedSkillManifestHash: snapshot.manifestHash,
    });
    expect(mocks.invokeLLM.mock.calls[0][0].messages[1].content).toBe(
      "evidence input"
    );
  });

  it("preserves the old latest/rollout policy when both new fields are omitted or undefined", async () => {
    const candidate = {
      implementation: {
        systemPrompt: "candidate",
        userPromptTemplate: "candidate {{context}}",
      },
    };
    mocks.rollout.mockResolvedValue({
      planId: "plan",
      snapshotId: "snapshot",
      snapshotHash: "snapshot-hash",
      skillVersion: 4,
      manifest: candidate,
      modelOverride: "candidate-model",
      bucket: 2,
      rolloutPercent: 50,
    });
    const result = await run({
      skillVersionPolicy: "latest",
      expectedSkillVersion: 3,
      expectedSkillPromptHash: promptHash,
      expectedSkillUserPromptHash: undefined,
      expectedSkillManifestHash: undefined,
    });
    expect(mocks.rollout).toHaveBeenCalledOnce();
    expect(result.skillVersion).toBe("4");
    expect(mocks.invokeLLM.mock.calls[0][0].messages[0].content).toBe(
      "candidate"
    );
  });

  it("does not claim to pin separate live model registry/modelOverride configuration", async () => {
    configure(originalManifest, "changed-model-override");
    await run({
      expectedSkillUserPromptHash: userHash,
      expectedSkillManifestHash: manifestHash,
    });
    const firstModelRead = sqlCalls().find(query =>
      query.sql.startsWith("SELECT * FROM emperor_model_providers")
    );
    expect(firstModelRead?.params.slice(0, 2)).toEqual([
      "changed-model-override",
      "changed-model-override",
    ]);
    expect(mocks.invokeLLM).toHaveBeenCalledOnce();
  });
});
