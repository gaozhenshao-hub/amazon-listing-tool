export const BUSINESS_AI_JOB_MODULES = [
  "adAnalysis",
  "imageWorkflow",
  "keywordWorkflow",
  "listing",
  "operations",
  "productDevelopment",
  "videoScript",
] as const;

const BUSINESS_MODULE_SET = new Set<string>(BUSINESS_AI_JOB_MODULES);

export type BusinessJobAgentBinding = {
  agentRunId: string;
  agentNodeId: string;
};

export function isBusinessAiJobModule(module: string): boolean {
  return BUSINESS_MODULE_SET.has(module);
}

export function readBusinessJobAgentBinding(value: unknown): BusinessJobAgentBinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const agentRunId = typeof record.agentRunId === "string" ? record.agentRunId.trim() : "";
  const agentNodeId = typeof record.agentNodeId === "string" ? record.agentNodeId.trim() : "";
  return agentRunId && agentNodeId ? { agentRunId, agentNodeId } : null;
}

export function assertBusinessJobAgentBinding(input: {
  module: string;
  kind: string;
  input: unknown;
}): BusinessJobAgentBinding | null {
  if (input.kind === PROFILE_IMPORT_JOB_KIND) {
    const profileBinding = readBusinessJobAgentBinding(input.input);
    if (input.module !== "listing" || profileBinding?.agentNodeId !== "N3") {
      throw new Error("Product profile conversion must bind the Listing N3 agent node");
    }
    return profileBinding;
  }
  if (!isBusinessAiJobModule(input.module)) return null;
  const binding = readBusinessJobAgentBinding(input.input);
  if (binding) return binding;
  throw new Error(
    `Business AI Job ${input.module}/${input.kind} must include agentRunId and agentNodeId`,
  );
}
import { PROFILE_IMPORT_JOB_KIND } from "@shared/profileImportJob";
