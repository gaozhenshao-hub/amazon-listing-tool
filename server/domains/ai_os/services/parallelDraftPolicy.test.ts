import { describe, expect, it } from "vitest";
import { assessParallelDraftCandidates } from "./parallelDraftPolicy";

const safeNodes = [
  { id: "research_a", nodeType: "skill_node", skillSlug: "research.a", outputKey: "researchA" },
  { id: "research_b", nodeType: "skill_node", skillSlug: "research.b", outputKey: "researchB" },
];
const safeSkills = [
  { slug: "research.a", riskTier: "L1", allowedTools: [], executionMode: "inline" },
  { slug: "research.b", riskTier: "L0", allowedTools: [], executionMode: "inline" },
];

describe("受控并行草稿治理策略", () => {
  it("只接受相互独立、低风险、无Tool且唯一输出的Skill分支", () => {
    const result = assessParallelDraftCandidates({ branchNodeIds: ["research_a", "research_b"], nodes: safeNodes, edges: [], skills: safeSkills });
    expect(result.eligible).toBe(true);
    expect(result.constraints.execution).toBe("draft_only");
    expect(result.constraints.requireHumanApproval).toBe(true);
  });

  it("拒绝Tool、L2/L3、共享输出或DAG依赖分支", () => {
    const result = assessParallelDraftCandidates({
      branchNodeIds: ["research_a", "research_b"],
      nodes: [{ ...safeNodes[0], toolSlug: "mcp.write" }, { ...safeNodes[1], outputKey: "researchA" }],
      edges: [{ source: "research_a", target: "research_b" }],
      skills: [{ ...safeSkills[0], riskTier: "L2", allowedTools: ["internal.write"] }, safeSkills[1]],
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining(["tool_backed_node", "skill_risk_not_low", "skill_tools_declared", "output_key_shared", "branch_dependency"]));
  });
});
