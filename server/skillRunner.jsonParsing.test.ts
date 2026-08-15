import { describe, expect, it } from "vitest";
import { safeParseSkillJSON } from "./domains/ai_os/services/skillRunner";

describe("皇帝Skill长JSON解析容错", () => {
  it("accepts an LLM JSON payload with literal newlines inside a string and a trailing comma", () => {
    const raw = '{"modules":[{"title":"A+ 1.1","description":"第一行\n第二行",}],}';
    const result = safeParseSkillJSON<{ modules: Array<{ title: string; description: string }> }>(raw);
    expect("raw" in result).toBe(false);
    expect((result as { modules: Array<{ description: string }> }).modules[0].description).toBe("第一行\n第二行");
  });
});
