import { describe, expect, it } from "vitest";
import { runEmperorSkill } from "./services/emperorSkillRunner";

const shouldRun = process.env.RUN_GATEWAY_TEST === "1";
const gTest = shouldRun ? it : it.skip;

describe("emperorInvocationGateway integration", () => {
  gTest("routes listing.sellingpoints.generate through Teamo Router", async () => {
    const result = await runEmperorSkill<string>({
      skillSlug: "listing.sellingpoints.generate",
      userId: 1,
      context: "Product: USB-C coffee mug warmer, 55°C constant temperature, auto-off safety",
      emphasis: "简洁测试",
      variables: {},
      validate: (content) => content,
    });
    expect(result.content.length).toBeGreaterThan(10);
    expect(result.modelSlug).toBeTruthy();
    expect(result.provider).toBeTruthy();
    console.log("✓ 模型:", result.modelSlug, "| Provider:", result.provider, "| 耗时:", result.durationMs, "ms | Tokens:", result.inputTokens, "+", result.outputTokens);
    console.log("  响应前200字:", result.content.slice(0, 200));
  }, 60_000);
});
