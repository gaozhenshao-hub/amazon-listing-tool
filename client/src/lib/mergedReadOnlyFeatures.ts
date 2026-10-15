/** Local integration opt-in, not an authorization or permission grant. */
export function mergedReadOnlyFeaturesEnabled(value: unknown): boolean {
  return value === "1";
}

// Production builds stay off unless explicitly opted in for a reviewed release.
export const MERGED_READONLY_FEATURES_ENABLED = mergedReadOnlyFeaturesEnabled(
  import.meta.env.VITE_ENABLE_MERGED_READONLY_FEATURES,
);
