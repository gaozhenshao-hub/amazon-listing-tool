import { describe, expect, it } from "vitest";
import { normalizeSkillExecutionPreset, safeParseSkillJSON } from "./domains/ai_os/services/skillRunner";

describe("皇帝Skill长JSON解析容错", () => {
  it("accepts an LLM JSON payload with literal newlines inside a string and a trailing comma", () => {
    const raw = '{"modules":[{"title":"A+ 1.1","description":"第一行\n第二行",}],}';
    const result = safeParseSkillJSON<{ modules: Array<{ title: string; description: string }> }>(raw);
    expect("raw" in result).toBe(false);
    expect((result as { modules: Array<{ description: string }> }).modules[0].description).toBe("第一行\n第二行");
  });

  it("仅接受受治理的Harness执行Preset，未知值安全回退为标准模式", () => {
    expect(normalizeSkillExecutionPreset("quality_first")).toBe("quality_first");
    expect(normalizeSkillExecutionPreset("evaluation")).toBe("evaluation");
    expect(normalizeSkillExecutionPreset("untrusted_override")).toBe("standard");
  });
});
