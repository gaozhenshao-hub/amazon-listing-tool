export type SellingPointSourcePoint = {
  analysisId: number;
  asin: string;
  bulletIndex: number;
  text: string;
};

export type SellingPointSourceAnalysis = {
  id: number;
  asin: string;
  bulletPoints: readonly string[];
};

export type SellingPointSourceEvidenceResult =
  | {
    status: "available";
    asin: string;
    bulletNumber: number;
    sourceText: string;
    comparisonDiffers: boolean;
  }
  | {
    status: "unavailable";
    reason: "missing-reference" | "identity-mismatch" | "invalid-index" | "missing-source" | "invalid-comparison-text";
  };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Resolves only the current saved bullet, never a historical or independently verified quotation. */
export function resolveSellingPointSourceEvidence(
  point: unknown,
  analysis: unknown,
): SellingPointSourceEvidenceResult {
  if (!isRecord(point) || !isRecord(analysis)) {
    return { status: "unavailable", reason: "missing-reference" };
  }
  if (typeof point.analysisId !== "number" || !Number.isSafeInteger(point.analysisId)
    || point.analysisId <= 0 || point.analysisId !== analysis.id
    || typeof point.asin !== "string" || !point.asin.trim()
    || point.asin !== analysis.asin) {
    return { status: "unavailable", reason: "identity-mismatch" };
  }
  const index = point.bulletIndex;
  if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0) {
    return { status: "unavailable", reason: "invalid-index" };
  }
  const bullets = analysis.bulletPoints;
  if (!Array.isArray(bullets) || index >= bullets.length || !Object.hasOwn(bullets, index)) {
    return { status: "unavailable", reason: "missing-source" };
  }
  const sourceText: unknown = bullets[index];
  if (typeof sourceText !== "string" || !sourceText.trim()) {
    return { status: "unavailable", reason: "missing-source" };
  }
  if (typeof point.text !== "string") {
    return { status: "unavailable", reason: "invalid-comparison-text" };
  }
  return {
    status: "available",
    asin: point.asin,
    bulletNumber: index + 1,
    sourceText,
    comparisonDiffers: point.text !== sourceText,
  };
}
