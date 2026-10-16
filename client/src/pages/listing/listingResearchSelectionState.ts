import { listingResearchBindingSchema, listingResearchIdsSchema, type ListingResearchBinding } from "@shared/listingResearchSelection";

export type ListingRequestOwner = { userId: number; workspaceId: number | null; role: string; projectId: number };
type UserIdentity = { id?: unknown; defaultWorkspaceId?: unknown; role?: unknown } | null | undefined;
export function listingIdentity(user: UserIdentity): Omit<ListingRequestOwner, "projectId"> | null {
  if (!user || typeof user.id !== "number" || !Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.role !== "string" || !user.role) return null;
  const workspaceId = user.defaultWorkspaceId;
  if (workspaceId !== null && (typeof workspaceId !== "number" || !Number.isSafeInteger(workspaceId) || workspaceId <= 0)) return null;
  return { userId: user.id, workspaceId: workspaceId as number | null, role: user.role };
}
export function listingRequestOwner(user: UserIdentity, projectId: number, blocked = false): ListingRequestOwner | null {
  const identity = listingIdentity(user);
  return blocked || !identity || !Number.isSafeInteger(projectId) || projectId <= 0 ? null : { ...identity, projectId };
}
export const listingOwnerKey = (owner: ListingRequestOwner | null) => owner ? JSON.stringify([owner.userId, owner.workspaceId, owner.role, owner.projectId]) : null;

export function listingReviewQueryMatches(queryKey: readonly unknown[], projectId: number, names: readonly string[] = ["listReviewedFacts", "listCurrentCores", "listRawFactSuggestions", "listCandidates", "getActive"]): boolean {
  const [path, descriptor] = queryKey;
  if (!Array.isArray(path) || path.length !== 2 || path[0] !== "listing" || !names.includes(String(path[1]))
    || !descriptor || typeof descriptor !== "object" || !("input" in descriptor)) return false;
  const input = descriptor.input;
  return !!input && typeof input === "object" && "projectId" in input && input.projectId === projectId;
}

export function confirmedResearchPayload(enabled: boolean, confirmedIds: number[] | null): { analysisIds?: number[] } | null {
  if (!enabled) return {};
  if (confirmedIds === null) return null;
  const parsed = listingResearchIdsSchema.safeParse(confirmedIds);
  return parsed.success ? { analysisIds: [...parsed.data] } : null;
}

export type ActualResearchSelection = { binding: ListingResearchBinding; analyzedAsins: string[] | null; phase: "actual" | "frozen" };
export function actualResearchSelection(run: unknown): ActualResearchSelection | null {
  if (!run || typeof run !== "object") return null;
  const job = run as Record<string, unknown>;
  const output = job.output && typeof job.output === "object" ? job.output as Record<string, unknown> : null;
  const input = job.input && typeof job.input === "object" ? job.input as Record<string, unknown> : null;
  const actual = output?.researchSelection;
  const raw = actual ?? input?.researchBinding;
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const parsed = listingResearchBindingSchema.safeParse({ version: value.version, projectId: value.projectId,
    workspaceId: value.workspaceId, mode: value.mode, analysisIds: value.analysisIds, sourceHash: value.sourceHash });
  if (!parsed.success || parsed.data.projectId !== job.projectId || parsed.data.workspaceId !== job.workspaceId) return null;
  if (actual !== undefined && (job.status !== "succeeded" || !Array.isArray(value.analyzedAsins) || !value.analyzedAsins.every(asin => typeof asin === "string" && asin.length > 0 && asin.length <= 100))) return null;
  if (actual !== undefined && input?.researchBinding !== undefined) {
    const frozen = listingResearchBindingSchema.safeParse(input.researchBinding);
    if (!frozen.success || JSON.stringify(frozen.data) !== JSON.stringify(parsed.data)) return null;
  }
  return { binding: parsed.data, analyzedAsins: actual !== undefined ? [...value.analyzedAsins as string[]] : null, phase: actual !== undefined ? "actual" : "frozen" };
}
