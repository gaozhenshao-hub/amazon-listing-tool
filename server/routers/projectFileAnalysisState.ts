export function buildCompletedAnalysisUpdate(analysisResult: unknown) {
  return {
    analysisResult: JSON.stringify(analysisResult),
    status: "completed" as const,
    errorMessage: null,
  };
}
