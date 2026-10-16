/** Local opt-in for the integrated Listing flow; permissions remain server-side. */
export function mergedListingWorkflowEnabled(value: unknown): boolean {
  return value === "1";
}

export const MERGED_LISTING_WORKFLOW_ENABLED = mergedListingWorkflowEnabled(
  import.meta.env.VITE_ENABLE_MERGED_LISTING_WORKFLOW,
);
