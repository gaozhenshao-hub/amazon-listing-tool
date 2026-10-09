const FILE_IMPORT_PROCEDURES = new Set([
  "analysis.previewReviewFile",
  "analysis.previewSellerSpriteFile",
  "analysis.startImportJob",
]);

/** Uploads include base64 file data and need a larger budget than ordinary reads. */
export function getRequestTimeoutMs(url: string): number {
  const procedures = url.split("/api/trpc/")[1]?.split("?")[0]?.split(",") ?? [];
  if (procedures.some(procedure => FILE_IMPORT_PROCEDURES.has(procedure))) return 180_000;
  // Keep older clients supported while import analysis moves to durable jobs.
  if (procedures.includes("analysis.importReviews")) return 180_000;
  const aiProcedures = ["imageWorkflow", "generate", "evaluate", "analyze", "adDeep", "runStage", "Checklist"];
  return aiProcedures.some(name => url.includes(name)) ? 180_000 : 30_000;
}
