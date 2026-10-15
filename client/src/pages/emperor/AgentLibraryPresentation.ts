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
  triggerType: string; dagDefinition: unknown;
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

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export type LibraryWorkflowNode = {
  id: string; label: string; skillSlug: string | null; modelSlug: string | null;
  skillVersionRef: string | null; humanGate: boolean; parentIds: string[];
};

/** Reads only explicit DAG fields; no model fallback, generated rules or template revision. */
export function libraryWorkflowNodes(dag: unknown): LibraryWorkflowNode[] {
  const source = record(dag);
  if (!source || !Array.isArray(source.nodes)) return [];
  const edges = Array.isArray(source.edges) ? source.edges.map(record).filter(edge => edge !== null) : [];
  return source.nodes.flatMap(value => {
    const node = record(value), id = node && text(node.id);
    if (!node || !id) return [];
    return [{
      id, label: text(node.label) || id,
      skillSlug: text(node.skillSlug), modelSlug: text(node.modelSlug),
      skillVersionRef: text(node.skillVersionRef), humanGate: node.humanGate === true,
      parentIds: edges.filter(edge => (edge.target ?? edge.to) === id)
        .flatMap(edge => { const parent = text(edge.source ?? edge.from); return parent ? [parent] : []; }),
    }];
  });
}
