import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ═══════════════════════════════════════════════════════════════
// Optimization 1: DevAnalysisFlow cleanup - remove attribute_tagging stage
// ═══════════════════════════════════════════════════════════════
describe("Optimization 1: DevAnalysisFlow attribute_tagging cleanup", () => {
  const flowPath = path.join(__dirname, "../client/src/pages/dev/DevAnalysisFlow.tsx");
  const flowSrc = fs.readFileSync(flowPath, "utf-8");

  it("should NOT have attribute_tagging in STAGES array", () => {
    // Find the STAGES array definition
    const stagesStart = flowSrc.indexOf("const STAGES");
    const stagesEnd = flowSrc.indexOf("];", stagesStart);
    const stagesSection = flowSrc.substring(stagesStart, stagesEnd);
    expect(stagesSection).not.toContain('"attribute_tagging"');
  });

  it("should NOT have tagMutation in the component", () => {
    expect(flowSrc).not.toContain("tagMutation");
  });

  it("should NOT have AttributeTaggingResult component", () => {
    expect(flowSrc).not.toContain("function AttributeTaggingResult");
    expect(flowSrc).not.toContain("AttributeTaggingResult");
  });

  it("should NOT have case attribute_tagging in switch statement", () => {
    expect(flowSrc).not.toContain('case "attribute_tagging"');
  });

  it("should still have market_overview stage", () => {
    expect(flowSrc).toContain('"market_overview"');
  });

  it("should still have attribute_cross stage", () => {
    expect(flowSrc).toContain('"attribute_cross"');
  });

  it("should still have decision_dashboard stage", () => {
    expect(flowSrc).toContain('"decision_dashboard"');
  });

  it("should default activeStage to market_overview (not attribute_tagging)", () => {
    expect(flowSrc).toContain('useState<StageKey>("market_overview")');
  });
});

// ═══════════════════════════════════════════════════════════════
// Optimization 1b: Backend gating logic updated
// ═══════════════════════════════════════════════════════════════
describe("Optimization 1b: Backend gating uses areProductTagsConfirmed", () => {
  const analysisPath = path.join(__dirname, "routers/devAnalysis.ts");
  const analysisSrc = fs.readFileSync(analysisPath, "utf-8");

  it("should define areProductTagsConfirmed function", () => {
    expect(analysisSrc).toContain("async function areProductTagsConfirmed");
  });

  it("market_overview gating should check product tags confirmed", () => {
    const marketSection = analysisSrc.substring(
      analysisSrc.indexOf('case "market_overview"'),
      analysisSrc.indexOf('case "attribute_cross"')
    );
    expect(marketSection).toContain("areProductTagsConfirmed");
  });

  it("attribute_cross gating should check product tags confirmed", () => {
    const crossSection = analysisSrc.substring(
      analysisSrc.indexOf('case "attribute_cross"'),
      analysisSrc.indexOf('case "tag_cross"')
    );
    expect(crossSection).toContain("areProductTagsConfirmed");
  });

  it("decision_dashboard gating should check product tags confirmed", () => {
    const dashSection = analysisSrc.substring(
      analysisSrc.indexOf('case "decision_dashboard"'),
      analysisSrc.indexOf("break;", analysisSrc.indexOf('case "decision_dashboard"') + 100)
    );
    expect(dashSection).toContain("areProductTagsConfirmed");
  });

  it("decision_dashboard should NOT require attribute_tagging in requiredStages", () => {
    const dashSection = analysisSrc.substring(
      analysisSrc.indexOf('case "decision_dashboard"'),
      analysisSrc.indexOf("break;", analysisSrc.indexOf('case "decision_dashboard"') + 100)
    );
    expect(dashSection).not.toContain('"attribute_tagging"');
  });
});

// ═══════════════════════════════════════════════════════════════
// Optimization 1c: devTagging confirmAll/unlockAll syncs stage
// ═══════════════════════════════════════════════════════════════
describe("Optimization 1c: devTagging syncs analysis stage", () => {
  const taggingPath = path.join(__dirname, "routers/devTagging.ts");
  const taggingSrc = fs.readFileSync(taggingPath, "utf-8");

  it("confirmAll should sync attribute_tagging stage", () => {
    const confirmSection = taggingSrc.substring(
      taggingSrc.indexOf("confirmAll:"),
      taggingSrc.indexOf("unlockAll:")
    );
    expect(confirmSection).toContain("confirmDevAnalysisStage");
    expect(confirmSection).toContain('"attribute_tagging"');
  });

  it("unlockAll should sync attribute_tagging stage", () => {
    const unlockSection = taggingSrc.substring(
      taggingSrc.indexOf("unlockAll:"),
      taggingSrc.indexOf("checkConsistency:")
    );
    expect(unlockSection).toContain("unlockDevAnalysisStage");
    expect(unlockSection).toContain('"attribute_tagging"');
  });
});

// ═══════════════════════════════════════════════════════════════
// Optimization 2: Batch operations
// ═══════════════════════════════════════════════════════════════
describe("Optimization 2: Batch operations in devTagging", () => {
  const taggingPath = path.join(__dirname, "routers/devTagging.ts");
  const taggingSrc = fs.readFileSync(taggingPath, "utf-8");

  it("should have batchUpdateTags procedure", () => {
    expect(taggingSrc).toContain("batchUpdateTags:");
  });

  it("should have batchSetDimensionValue procedure", () => {
    expect(taggingSrc).toContain("batchSetDimensionValue:");
  });

  it("batchUpdateTags should accept projectId, dimensionName, and updates array", () => {
    const batchSection = taggingSrc.substring(
      taggingSrc.indexOf("batchUpdateTags:"),
      taggingSrc.indexOf("batchSetDimensionValue:")
    );
    expect(batchSection).toContain("projectId: z.number()");
    expect(batchSection).toContain("dimensionName: z.string()");
    expect(batchSection).toContain("updates: z.array");
  });

  it("batchSetDimensionValue should accept tagIds array and single dimensionValue", () => {
    const batchSetSection = taggingSrc.substring(
      taggingSrc.indexOf("batchSetDimensionValue:"),
      taggingSrc.indexOf("confirmAll:")
    );
    expect(batchSetSection).toContain("tagIds: z.array(z.number())");
    expect(batchSetSection).toContain("dimensionValue: z.string()");
  });

  it("batchSetDimensionValue should set source to manual", () => {
    const batchSetSection = taggingSrc.substring(
      taggingSrc.indexOf("batchSetDimensionValue:"),
      taggingSrc.indexOf("confirmAll:")
    );
    expect(batchSetSection).toContain('source: "manual"');
  });
});

describe("Optimization 2b: Batch operations in frontend", () => {
  const componentPath = path.join(__dirname, "../client/src/pages/dev/AttributeTagging.tsx");
  const componentSrc = fs.readFileSync(componentPath, "utf-8");

  it("should have batchDimension state", () => {
    expect(componentSrc).toContain("batchDimension");
    expect(componentSrc).toContain("setBatchDimension");
  });

  it("should have batchSelectedIds state", () => {
    expect(componentSrc).toContain("batchSelectedIds");
    expect(componentSrc).toContain("setBatchSelectedIds");
  });

  it("should have batchValue state", () => {
    expect(componentSrc).toContain("batchValue");
    expect(componentSrc).toContain("setBatchValue");
  });

  it("should call devTagging.batchSetDimensionValue mutation", () => {
    expect(componentSrc).toContain("devTagging.batchSetDimensionValue.useMutation");
  });

  it("should have select all checkbox in table header", () => {
    expect(componentSrc).toContain('type="checkbox"');
  });

  it("should show batch modify UI with dimension selector", () => {
    expect(componentSrc).toContain("选择维度批量修改");
  });

  it("should show batch count badge", () => {
    expect(componentSrc).toContain("批量修改:");
    expect(componentSrc).toContain("已选");
  });
});

// ═══════════════════════════════════════════════════════════════
// Optimization 3: Consistency check
// ═══════════════════════════════════════════════════════════════
describe("Optimization 3: Tag consistency check backend", () => {
  const taggingPath = path.join(__dirname, "routers/devTagging.ts");
  const taggingSrc = fs.readFileSync(taggingPath, "utf-8");

  it("should have checkConsistency procedure", () => {
    expect(taggingSrc).toContain("checkConsistency:");
  });

  it("checkConsistency should return consistent boolean", () => {
    const section = taggingSrc.substring(
      taggingSrc.indexOf("checkConsistency:"),
      taggingSrc.indexOf("// Legacy:")
    );
    expect(section).toContain("consistent:");
  });

  it("checkConsistency should return issues array", () => {
    const section = taggingSrc.substring(
      taggingSrc.indexOf("checkConsistency:"),
      taggingSrc.indexOf("// Legacy:")
    );
    expect(section).toContain("issues");
  });

  it("checkConsistency should detect extra_dimension", () => {
    const section = taggingSrc.substring(
      taggingSrc.indexOf("checkConsistency:"),
      taggingSrc.indexOf("// Legacy:")
    );
    expect(section).toContain('"extra_dimension"');
  });

  it("checkConsistency should detect missing_dimension", () => {
    const section = taggingSrc.substring(
      taggingSrc.indexOf("checkConsistency:"),
      taggingSrc.indexOf("// Legacy:")
    );
    expect(section).toContain('"missing_dimension"');
  });

  it("checkConsistency should detect invalid_value", () => {
    const section = taggingSrc.substring(
      taggingSrc.indexOf("checkConsistency:"),
      taggingSrc.indexOf("// Legacy:")
    );
    expect(section).toContain('"invalid_value"');
  });

  it("checkConsistency should return summary with totalDimensions", () => {
    const section = taggingSrc.substring(
      taggingSrc.indexOf("checkConsistency:"),
      taggingSrc.indexOf("// Legacy:")
    );
    expect(section).toContain("totalDimensions:");
    expect(section).toContain("taggedDimensions:");
    expect(section).toContain("totalTags:");
  });
});

describe("Optimization 3b: Consistency check frontend", () => {
  const componentPath = path.join(__dirname, "../client/src/pages/dev/AttributeTagging.tsx");
  const componentSrc = fs.readFileSync(componentPath, "utf-8");

  it("should call devTagging.checkConsistency query", () => {
    expect(componentSrc).toContain("devTagging.checkConsistency.useQuery");
  });

  it("should only enable consistency check when there are tagged products", () => {
    expect(componentSrc).toContain("enabled:");
    expect(componentSrc).toContain("taggedProducts");
  });

  it("should show consistency warning card when inconsistent", () => {
    expect(componentSrc).toContain("标签一致性检测异常");
  });

  it("should display issue types with badges", () => {
    expect(componentSrc).toContain("多余维度");
    expect(componentSrc).toContain("缺少维度");
    expect(componentSrc).toContain("无效值");
  });

  it("should offer re-tagging button to fix consistency issues", () => {
    expect(componentSrc).toContain("重新打标以修复");
  });

  it("should show affected count for each issue", () => {
    expect(componentSrc).toContain("affectedCount");
  });
});
