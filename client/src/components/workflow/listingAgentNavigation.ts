import { LISTING_AGENT_WORKFLOW_STEPS } from "./workflowDefinitions";

export const LISTING_AGENT_NODE_PATHS: Record<string, string> = {
  N0: "/listing",
  N1: "/listing/analysis",
  N2: "/listing/comparison",
  N3: "/listing/data-files",
  N4: "/listing/keywords",
  N5: "/listing/review-aggregation",
  G1: "/listing/generate",
  G2: "/listing/generate",
  G3: "/listing/generate",
  G4: "/listing/generate",
  G5: "/listing/generate",
  O1: "/listing/preview",
  O2: "/listing/score",
  O3: "/listing/ad-structure",
  E1: "/listing/image-workflow",
  E2: "/listing/video-script",
};

export interface ListingAgentNodeContext {
  runId: string;
  nodeId: string;
  projectId?: number;
}

export function buildListingAgentNodeUrl(input: ListingAgentNodeContext): string {
  const path = LISTING_AGENT_NODE_PATHS[input.nodeId];
  if (!path) throw new Error(`Unknown Listing Agent node: ${input.nodeId}`);
  const params = new URLSearchParams({
    agentRunId: input.runId,
    nodeId: input.nodeId,
  });
  if (input.projectId) params.set("projectId", String(input.projectId));
  return `${path}?${params.toString()}`;
}

export function parseListingAgentNodeContext(
  location: string,
  browserSearch = "",
): ListingAgentNodeContext | null {
  const parsed = new URL(location, "http://listing.local");
  const search = parsed.search || browserSearch;
  const params = new URLSearchParams(search);
  const runId = params.get("agentRunId")?.trim() || "";
  const nodeId = params.get("nodeId")?.trim() || "";
  if (!runId || !nodeId || !LISTING_AGENT_NODE_PATHS[nodeId]) return null;

  const expectedPath = LISTING_AGENT_NODE_PATHS[nodeId];
  const currentPath = parsed.pathname;
  const pathMatches = nodeId === "E2"
    ? currentPath.startsWith(expectedPath)
    : currentPath === expectedPath;
  if (!pathMatches) return null;

  const rawProjectId = Number(params.get("projectId"));
  return {
    runId,
    nodeId,
    projectId: Number.isInteger(rawProjectId) && rawProjectId > 0 ? rawProjectId : undefined,
  };
}

export function getListingAgentStep(nodeId: string) {
  return LISTING_AGENT_WORKFLOW_STEPS.find((step) => String(step.agentNodeId || step.id) === nodeId);
}
