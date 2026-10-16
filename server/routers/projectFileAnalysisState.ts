export function buildCompletedAnalysisUpdate(analysisResult: unknown) {
  return {
    analysisResult: JSON.stringify(analysisResult),
    status: "completed" as const,
    errorMessage: null,
  };
}

/** Repositories return newest first. An older completed file must never undo a
 * newly committed conversion; invalid/deleted entries do not shadow valid ones. */
export function buildProjectFileAnalysisSummary(files: Array<{
  fileType: string; status: string; analysisResult: string | null; lifecycleState?: string | null;
}>) {
  const summary: Record<string, any> = { productAttributes: null, competitorListings: null,
    cosmoScenes: null, a9Keywords: null, hasAllFiles: false, fileCount: files.length };
  const keys: Record<string, string> = { product_attributes: "productAttributes", competitor_listings: "competitorListings",
    search_term_report: "cosmoScenes", aba_keywords: "a9Keywords" };
  const selected = new Set<string>();
  for (const file of files) {
    const key = keys[file.fileType];
    if (!key || selected.has(key) || file.status !== "completed" || file.lifecycleState === "deleted" || !file.analysisResult) continue;
    try {
      const result: unknown = JSON.parse(file.analysisResult);
      if (result === null || typeof result !== "object") continue;
      summary[key] = result;
      selected.add(key);
    } catch { /* A malformed newest entry must not suppress an earlier valid one. */ }
  }
  summary.n3Ready = !!summary.productAttributes;
  summary.hasAllFiles = summary.n3Ready;
  return summary;
}
