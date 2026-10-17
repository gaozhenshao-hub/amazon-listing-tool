import { AGENT_LIBRARY_ROLES, type AgentLibraryKey } from "@shared/agentLibraryContracts";

/** Presentation categories, not saved bindings, permissions, or execution routing. */
export function libraryRoleForSkill(slug: string): AgentLibraryKey | null {
  if (slug === "finance.monthly.profit") return "finance";
  if (slug === "knowledge.images.tag" || slug === "knowledge.images.tag.coach") return "tagger";
  if (/^image\./.test(slug)) return "images";
  if (/^video\./.test(slug)) return "video";
  if (/^(dev|product\.development)\./.test(slug)) return "development";
  if (slug === "ad.structure.generate" || /^(listing|analysis|keyword)\./.test(slug)) return "listing";
  if (/^(knowledge\.(chat|qa|ask)|kb\.(chat|qa)|system\.knowledge\.chat)/.test(slug)) return "knowledge";
  return null;
}

export function libraryRoleForWorkflow(slug: string): AgentLibraryKey | null {
  // This acquisition workflow remains business-managed, not a second assistant workflow.
  if (slug === "listing.amazon.competitor-analysis") return null;
  if (/^listing\./.test(slug)) return "listing";
  if (/^(product-development|dev\.)/.test(slug)) return "development";
  if (/^video\./.test(slug)) return "video";
  if (/^image\./.test(slug)) return "images";
  if (/^knowledge\./.test(slug)) return "knowledge";
  return null;
}

export type LibrarySkill = { slug: string; name: string; description?: string | null; category?: string | null };
export type LibraryModel = { slug: string; name: string; provider: string; modelId: string; isDefault: boolean };
export type LibraryWorkflow = {
  id: number; slug: string; name: string; description?: string | null; status: string;
  triggerType: string; dagDefinition: unknown; validation?: unknown;
};
export type LibraryReadState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; rows: readonly T[] };

/** A failed refresh never silently displays cached rows as a successful empty result. */
export function libraryReadState<T>(query: {
  data?: T[]; isPending: boolean; error: { message: string } | null;
}): LibraryReadState<T> {
  if (query.error) return { status: "error", message: query.error.message };
  if (query.isPending || !query.data) return { status: "loading" };
  return { status: "ready", rows: query.data };
}

/** Existing APIs return workspace rows before global rows. Do not merge configurations. */
export function firstVisibleBySlug<T extends { slug: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  return rows.filter(row => {
    if (seen.has(row.slug)) return false;
    seen.add(row.slug);
    return true;
  });
}

export function libraryDirectory(key: AgentLibraryKey) {
  return AGENT_LIBRARY_ROLES.find(role => role.key === key)!;
}

export function workflowCanvasHref(slug: string): string {
  return `/emperor/agents/${encodeURIComponent(slug)}/canvas`;
}

export function librarySkillHref(slug: string): string {
  return `/emperor/skills?skill=${encodeURIComponent(slug)}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export type LibraryWorkflowNode = {
  id: string; label: string; skillSlug: string | null; modelSlug: string | null;
  skillVersionRef: string | null; humanGate: boolean | null; parentIds: string[];
  nodeType: string | null; subtitle: string | null; required: boolean | null;
  scheduler: string | null; incomingEdges: LibraryWorkflowEdge[];
};
export type LibraryWorkflowEdge = {
  source: string | null; target: string | null; kind: string | null; required: boolean | null;
};
export type LibraryWorkflowView = {
  nodes: LibraryWorkflowNode[];
  order: "validated_topological" | "static";
  orderReason: string;
  errors: string[];
  warnings: string[];
};

function flag(value: unknown): boolean | null { return typeof value === "boolean" ? value : null; }
function workflowEdges(dag: Record<string, unknown> | null): LibraryWorkflowEdge[] {
  return Array.isArray(dag?.edges) ? dag.edges.map(value => {
    const edge = record(value);
    // Match runtime's `source || from` / `target || to`, including the empty alias case.
    return { source: text(edge?.source || edge?.from), target: text(edge?.target || edge?.to),
      kind: text(edge?.kind), required: flag(edge?.required) };
  }) : [];
}

/** Reads only explicit DAG fields; no model fallback, generated rules or template revision. */
export function libraryWorkflowNodes(dag: unknown): LibraryWorkflowNode[] {
  const source = record(dag);
  if (!source || !Array.isArray(source.nodes)) return [];
  const edges = workflowEdges(source);
  return source.nodes.flatMap(value => {
    const node = record(value), id = node && text(node.id);
    if (!node || !id) return [];
    return [{
      id, label: text(node.label) || id,
      skillSlug: text(node.skillSlug), modelSlug: text(node.modelSlug),
      skillVersionRef: text(node.skillVersionRef), humanGate: flag(node.humanGate),
      nodeType: text(node.nodeType), subtitle: text(node.subtitle), required: flag(node.required),
      scheduler: text(node.scheduler),
      parentIds: edges.filter(edge => edge.target === id).flatMap(edge => edge.source ? [edge.source] : []),
      incomingEdges: edges.filter(edge => edge.target === id),
    }];
  });
}

/** Use the API's validated ordering only when it completely describes this exact DAG.
 * This is a display order, not a schedule, authorization, or execution readiness check. */
export function libraryWorkflowView(dag: unknown, validation: unknown): LibraryWorkflowView {
  const source = record(dag), receipt = record(validation), nodes = libraryWorkflowNodes(dag);
  const issues = (values: unknown): string[] => Array.isArray(values) ? values.map(value => {
    const issue = record(value);
    return issue && text(issue.message) ? `${text(issue.code) || "validation"}: ${issue.message}` : "校验信息格式不完整";
  }) : [];
  const base = { nodes, errors: issues(receipt?.errors), warnings: issues(receipt?.warnings) };
  const staticView = (orderReason: string): LibraryWorkflowView => ({ ...base, order: "static", orderReason });
  if (!receipt) return staticView("未返回服务端校验，仅按静态原序展示。");
  if (receipt.valid !== true || !Array.isArray(receipt.errors) || receipt.errors.length !== 0 || !Array.isArray(receipt.warnings)) {
    return staticView("服务端校验未通过或信息不完整，仅按静态原序展示。");
  }
  const order = receipt.topologicalNodeIds;
  if (!nodes.length || !Array.isArray(source?.nodes) || source.nodes.length !== nodes.length || !Array.isArray(source.edges)
    || !Array.isArray(order) || order.length !== nodes.length || order.some(id => typeof id !== "string")
    || new Set(order).size !== nodes.length || new Set(nodes.map(node => node.id)).size !== nodes.length) {
    return staticView("拓扑顺序缺失、不完整或节点重复，仅按静态原序展示。");
  }
  const positions = new Map(order.map((id, index) => [id as string, index]));
  if (nodes.some(node => !positions.has(node.id)) || workflowEdges(source).some(edge =>
    !edge.source || !edge.target || !positions.has(edge.source) || !positions.has(edge.target)
      || positions.get(edge.source)! >= positions.get(edge.target)!)) {
    return staticView("拓扑顺序与当前节点或依赖不一致，仅按静态原序展示。");
  }
  const byId = new Map(nodes.map(node => [node.id, node]));
  return { ...base, nodes: order.map(id => byId.get(id as string)!), order: "validated_topological",
    orderReason: "按服务端校验的完整拓扑顺序展示；同层节点可并列，不代表运行顺序或执行状态。" };
}
