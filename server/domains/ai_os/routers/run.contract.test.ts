import { beforeEach, describe, expect, it, vi } from "vitest";

const { runEmperorSkill } = vi.hoisted(() => ({ runEmperorSkill: vi.fn() }));

vi.mock("../services/skillRunner", () => ({
  normalizeSkillExecutionPreset: (value: string) => value || "standard",
  runEmperorSkill,
}));

vi.mock("../routerContext", () => ({
  rawExecute: vi.fn(),
}));

import { emperorRunRouter } from "./run";

describe("emperor.run.run governed runner contract", () => {
  beforeEach(() => {
    runEmperorSkill.mockReset();
    runEmperorSkill.mockResolvedValue({
      runId: "run_governed",
      content: "{\"draft\":true}",
      parsed: { draft: true },
      durationMs: 12,
      inputTokens: 10,
      outputTokens: 20,
      costCents: 1,
      skillVersion: 4,
      modelSlug: "teamo-gpt-6-astra",
      provider: "custom",
      executionPreset: "quality_first",
      governance: {
        draft: true,
        recommendationOnly: true,
        humanReviewRequired: true,
        automaticExecution: "prohibited",
      },
    });
  });

  it("uses the shared governed runner and returns its review metadata", async () => {
    const caller = emperorRunRouter.createCaller({
      user: { id: 7, role: "super_admin", defaultWorkspaceId: 9 },
    } as any);

    const output = await caller.run({
      skillSlug: "listing.bullets.generate",
      context: "synthetic context",
      emphasis: "clarity",
      executionPreset: "quality_first",
    });

    expect(runEmperorSkill).toHaveBeenCalledWith(expect.objectContaining({
      skillSlug: "listing.bullets.generate",
      userId: 7,
      workspaceId: 9,
      executionPreset: "quality_first",
    }));
    expect(output).toMatchObject({
      status: "succeeded",
      modelSlug: "teamo-gpt-6-astra",
      executionPreset: "quality_first",
      governance: { humanReviewRequired: true, automaticExecution: "prohibited" },
    });
  });
});
