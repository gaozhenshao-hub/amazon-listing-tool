import { z } from "zod";

const positiveSafeId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** [] explicitly excludes competitor research. Omission is handled separately
 * by the server's legacy-all admission and is never equivalent to []. */
export const listingResearchIdsSchema = z.array(positiveSafeId).max(1000)
  .refine(ids => new Set(ids).size === ids.length, "竞品分析ID不能重复");

export const listingResearchBindingSchema = z.object({
  version: z.literal(1),
  projectId: positiveSafeId,
  workspaceId: positiveSafeId.nullable(),
  mode: z.enum(["explicit", "legacy_all"]),
  analysisIds: listingResearchIdsSchema.refine(
    ids => ids.every((id, index) => index === 0 || ids[index - 1] < id),
    "持久竞品选集必须按ID升序排列",
  ),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type ListingResearchIds = z.infer<typeof listingResearchIdsSchema>;
export type ListingResearchBinding = z.infer<typeof listingResearchBindingSchema>;
