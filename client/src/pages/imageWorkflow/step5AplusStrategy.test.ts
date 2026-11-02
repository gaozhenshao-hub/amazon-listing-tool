import { describe, expect, it } from "vitest";
import { updateStep5AplusStrategy } from "./step5AplusStrategy";

describe("updateStep5AplusStrategy", () => {
  it("updates only the selected human-review strategy field while retaining sections", () => {
    const source = {
      aPlusContent: {
        overallStrategy: "旧策略",
        overallStory: "旧故事",
        consistency: "旧一致性",
        modularDesign: "旧模块化",
        sections: [{ moduleNumber: 1, title: "模块一" }],
      },
    };

    const result = updateStep5AplusStrategy(source, "overallStrategy", "人工确认后的策略");

    expect(result.aPlusContent.overallStrategy).toBe("人工确认后的策略");
    expect(result.aPlusContent.overallStory).toBe("旧故事");
    expect(result.aPlusContent.sections).toEqual([{ moduleNumber: 1, title: "模块一" }]);
    expect(source.aPlusContent.overallStrategy).toBe("旧策略");
  });
});
