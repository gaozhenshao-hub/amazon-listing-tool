export type ParallelDraftNode = {
  id: string;
  nodeType: string;
  skillSlug?: string;
  toolSlug?: string;
  outputKey?: string;
  inputRefs?: string[];
};

export type ParallelDraftEdge = { source?: string; target?: string; from?: string; to?: string };
export type ParallelDraftSkill = { slug: string; riskTier?: string | null; allowedTools?: unknown; executionMode?: string | null };

const asArray = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item)) : [];
const edgeFrom = (edge: ParallelDraftEdge) => String(edge.source || edge.from || "");
const edgeTo = (edge: ParallelDraftEdge) => String(edge.target || edge.to || "");

function reachable(from: string, to: string, edges: ParallelDraftEdge[]) {
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    const source = edgeFrom(edge); const target = edgeTo(edge);
    if (!source || !target) continue;
    next.set(source, [...(next.get(source) || []), target]);
  }
  const queue = [from]; const seen = new Set<string>();
  while (queue.length) {
    const nodeId = queue.shift()!;
    if (nodeId === to) return true;
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    queue.push(...(next.get(nodeId) || []));
  }
  return false;
}

export function assessParallelDraftCandidates(input: {
  branchNodeIds: string[];
  nodes: ParallelDraftNode[];
  edges: ParallelDraftEdge[];
  skills: ParallelDraftSkill[];
}) {
  const uniqueBranchIds = [...new Set(input.branchNodeIds.filter(Boolean))];
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const skillBySlug = new Map(input.skills.map((skill) => [skill.slug, skill]));
  const reasons: Array<{ nodeId?: string; code: string; message: string }> = [];
  const outputKeys = new Map<string, string>();

  if (uniqueBranchIds.length < 2) reasons.push({ code: "branch_count", message: "并行草稿至少需要两个分支。" });
  for (const nodeId of uniqueBranchIds) {
    const node = nodeById.get(nodeId);
    if (!node) { reasons.push({ nodeId, code: "node_missing", message: "分支节点不存在于Agent DAG。" }); continue; }
    if (node.nodeType !== "skill_node") reasons.push({ nodeId, code: "node_type_not_readonly_skill", message: "仅允许无Tool的Skill节点作为并行候选；MCP、HTTP、代码、知识和业务节点保持串行。" });
    if (node.toolSlug) reasons.push({ nodeId, code: "tool_backed_node", message: "带Tool的节点副作用无法证明为零，必须保持串行。" });
    if (!node.skillSlug) { reasons.push({ nodeId, code: "skill_missing", message: "Skill节点缺少登记能力。" }); continue; }
    const skill = skillBySlug.get(node.skillSlug);
    if (!skill) { reasons.push({ nodeId, code: "skill_unregistered", message: "Skill未在登记表中，无法验证风险与工具范围。" }); continue; }
    if (skill.riskTier !== "L0" && skill.riskTier !== "L1") reasons.push({ nodeId, code: "skill_risk_not_low", message: "仅L0/L1 Skill可作为并行候选。" });
    if (asArray(skill.allowedTools).length > 0) reasons.push({ nodeId, code: "skill_tools_declared", message: "声明可调用Tool的Skill可能存在副作用，必须保持串行。" });
    if (skill.executionMode === "background") reasons.push({ nodeId, code: "skill_background_mode", message: "后台Skill不作为子图并行草稿候选。" });
    const outputKey = String(node.outputKey || "");
    if (!outputKey) reasons.push({ nodeId, code: "output_key_missing", message: "分支必须声明唯一输出键，避免共享Artifact写入。" });
    else if (outputKeys.has(outputKey)) reasons.push({ nodeId, code: "output_key_shared", message: `输出键与${outputKeys.get(outputKey)}重复，存在共享Artifact写入风险。` });
    else outputKeys.set(outputKey, nodeId);
  }
  for (let index = 0; index < uniqueBranchIds.length; index += 1) {
    for (let compare = index + 1; compare < uniqueBranchIds.length; compare += 1) {
      const left = uniqueBranchIds[index]; const right = uniqueBranchIds[compare];
      if (reachable(left, right, input.edges) || reachable(right, left, input.edges)) {
        reasons.push({ code: "branch_dependency", message: `${left}与${right}存在DAG依赖，必须保持串行。` });
      }
    }
  }
  return {
    eligible: reasons.length === 0,
    branchNodeIds: uniqueBranchIds,
    reasons,
    constraints: {
      execution: "draft_only",
      requireHumanApproval: true,
      defaultSerial: true,
      maxConcurrencyCap: 4,
      prohibited: ["tool_write", "mcp_write", "unknown_side_effect", "shared_artifact", "L2_L3", "dependency"],
    },
  };
}
