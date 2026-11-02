export const PRODUCT_ANALYSIS_CONTEXT_BUDGET_CHARS = 48_000;

export type ProductAnalysisContextPackage = {
  schemaVersion: "1.0";
  stageType: string;
  project: {
    id: number;
    name: string;
    targetMarket: string | null;
    keywords: string | null;
  };
  evidence: unknown;
  provenance: Array<{
    source: string;
    recordCount?: number;
    artifactRef?: string;
    confirmed?: boolean;
  }>;
  compression: {
    budgetChars: number;
    originalChars: number;
    finalChars: number;
    truncated: boolean;
    arrayLimit: number;
    stringLimit: number;
  };
};

type BuildContextInput = {
  stageType: string;
  project: {
    id: number;
    name?: string | null;
    targetMarket?: string | null;
    keywords?: string | null;
  };
  evidence: unknown;
  provenance: ProductAnalysisContextPackage["provenance"];
  budgetChars?: number;
};

function jsonLength(value: unknown) {
  return JSON.stringify(value).length;
}

function compactValue(
  value: unknown,
  limits: { arrayLimit: number; stringLimit: number; depthLimit: number },
  depth = 0,
): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") {
    if (value.length <= limits.stringLimit) return value;
    return `${value.slice(0, limits.stringLimit)}...[已压缩 ${value.length - limits.stringLimit} 字符]`;
  }
  if (typeof value !== "object") return value;
  if (depth >= limits.depthLimit) return "[超出上下文深度，已压缩]";
  if (Array.isArray(value)) {
    const items = value.slice(0, limits.arrayLimit).map((item) => compactValue(item, limits, depth + 1));
    if (value.length > limits.arrayLimit) {
      items.push(`[其余 ${value.length - limits.arrayLimit} 项已压缩]`);
    }
    return items;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, compactValue(child, limits, depth + 1)]),
  );
}

export function buildProductAnalysisContextPackage(input: BuildContextInput) {
  const budgetChars = Math.min(Math.max(input.budgetChars || PRODUCT_ANALYSIS_CONTEXT_BUDGET_CHARS, 8_000), 96_000);
  const originalChars = jsonLength(input.evidence);
  const candidates = [
    { arrayLimit: 80, stringLimit: 1_200, depthLimit: 10 },
    { arrayLimit: 40, stringLimit: 800, depthLimit: 9 },
    { arrayLimit: 20, stringLimit: 500, depthLimit: 8 },
    { arrayLimit: 10, stringLimit: 300, depthLimit: 7 },
  ];

  let selected = candidates[0];
  let evidence = compactValue(input.evidence, selected);
  let context: ProductAnalysisContextPackage;

  const makePackage = (): ProductAnalysisContextPackage => ({
    schemaVersion: "1.0",
    stageType: input.stageType,
    project: {
      id: input.project.id,
      name: input.project.name || "",
      targetMarket: input.project.targetMarket || null,
      keywords: input.project.keywords || null,
    },
    evidence,
    provenance: input.provenance,
    compression: {
      budgetChars,
      originalChars,
      finalChars: 0,
      truncated: originalChars !== jsonLength(evidence),
      arrayLimit: selected.arrayLimit,
      stringLimit: selected.stringLimit,
    },
  });

  context = makePackage();
  for (const candidate of candidates.slice(1)) {
    if (jsonLength(context) <= budgetChars) break;
    selected = candidate;
    evidence = compactValue(input.evidence, selected);
    context = makePackage();
  }

  if (jsonLength(context) > budgetChars) {
    const serializedEvidence = JSON.stringify(evidence);
    evidence = {
      compressedEvidenceExcerpt: serializedEvidence.slice(0, Math.max(2_000, budgetChars - 3_000)),
      note: "结构化证据超过预算，已保留前部摘要；统计原始结果仍会完整保存到阶段产物。",
    };
    context = makePackage();
    context.compression.truncated = true;
  }

  for (let index = 0; index < 3; index += 1) {
    const nextLength = jsonLength(context);
    if (context.compression.finalChars === nextLength) break;
    context.compression.finalChars = nextLength;
  }
  return {
    package: context,
    serialized: JSON.stringify(context),
  };
}
