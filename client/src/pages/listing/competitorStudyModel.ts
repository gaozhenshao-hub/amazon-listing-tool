import { CompetitorActiveResearchDeliverySchema, competitorDeepAdoptionHash } from "@shared/competitorDeepAdoption";

export interface CompetitorStudyRecord {
  id: number;
  projectId?: number;
  asin: string;
  revision?: string;
  title?: string | null;
  price?: string | null;
  rating?: string | null;
  reviewCount?: string | number | null;
  bulletPoints?: string | null;
  summary?: string | null;
  aiSummary?: string | null;
  summaryStatus?: string | null;
  summaryVersion?: number | null;
  rawData?: string | null;
  activeResearch?: unknown;
}

function sourceState(rawData: CompetitorStudyRecord["rawData"]) {
  if (rawData === undefined || rawData === null || (typeof rawData === "string" && rawData.trim() === "")) return { analysisStale: false, captureOnly: false, sourceUnknown: false };
  if (typeof rawData !== "string") return { analysisStale: false, captureOnly: false, sourceUnknown: true };
  try {
    const raw: unknown = JSON.parse(rawData);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("INVALID_SOURCE_STATE");
    const flags = raw as Record<string, unknown>;
    const invalidFlag = ["analysisStale", "captureOnly"].some(key => Object.hasOwn(flags, key) && typeof flags[key] !== "boolean");
    return { analysisStale: flags.analysisStale === true, captureOnly: flags.captureOnly === true, sourceUnknown: invalidFlag };
  } catch { return { analysisStale: false, captureOnly: false, sourceUnknown: true }; }
}

/** Saved fields only: absence is not replaced by an invented analysis or task. */
export function competitorStudy(record: CompetitorStudyRecord) {
  const saved = typeof record.summary === "string" ? record.summary : "";
  const candidate = typeof record.aiSummary === "string" ? record.aiSummary : "";
  const summary = saved.trim() ? saved : candidate.trim() ? candidate : "";
  let bullets: string[] = [], bulletsUnavailable = false;
  if (record.bulletPoints) {
    try {
      const parsed: unknown = JSON.parse(record.bulletPoints);
      if (!Array.isArray(parsed) || !parsed.every(item => typeof item === "string")) bulletsUnavailable = true;
      else bullets = parsed;
    } catch { bulletsUnavailable = true; }
  }
  const validIdentity = Number.isSafeInteger(record.id) && record.id > 0 && /^[A-Z0-9]{10}$/.test(record.asin);
  const confirmed = record.summaryStatus === "confirmed";
  const source = sourceState(record.rawData), delivery = CompetitorActiveResearchDeliverySchema.safeParse(record.activeResearch);
  const adopted = delivery.success && delivery.data.status === "adopted_deep" ? delivery.data : null;
  const adoptedDeep = !!adopted && adopted.identity.analysisId === record.id && adopted.identity.asin === record.asin
    && adopted.identity.projectId === record.projectId && adopted.currentRevision === record.revision
    && adopted.ref.summaryVersion === record.summaryVersion && confirmed && !!saved.trim()
    && adopted.ref.summaryHash === competitorDeepAdoptionHash(saved.trim());
  const deliveryUnknown = record.activeResearch !== undefined && (!delivery.success || delivery.data.status === "unavailable"
    || delivery.data.status === "adopted_deep" && !adoptedDeep);
  source.sourceUnknown ||= deliveryUnknown;
  const historical = !adoptedDeep && (source.analysisStale || source.captureOnly);
  const summarySource = saved.trim() ? historical ? "历史已保存摘要（非当前资料分析）" : source.sourceUnknown ? "已保存摘要（来源状态未核验）" : "已保存摘要"
    : summary ? historical ? "历史 AI 候选摘要（未确认）" : source.sourceUnknown ? "AI 候选摘要（来源状态未核验，未确认）" : "AI 候选摘要（未确认）" : "尚无已保存分析摘要";
  return {
    summary, bullets, bulletsUnavailable, confirmed, ...source, historical, adoptedDeep, adoptionNeedsReview: deliveryUnknown,
    summarySource: adoptedDeep ? "人工已采纳四栏正式研究摘要（范围受限）" : summarySource,
    canConfirm: validIdentity && !adoptedDeep && !historical && !source.sourceUnknown && record.summaryStatus === "draft" && !!summary.trim() && summary.length <= 20_000,
    canUnlock: validIdentity && confirmed && !!saved.trim(),
    inconsistent: confirmed && !saved.trim(),
  };
}

export function matchesComparisonSelection(value: unknown, projectId: number, ids: readonly number[]): boolean {
  if (!value || typeof value !== "object") return false;
  const report = value as { projectId?: unknown; analysisIds?: unknown; selectionKey?: unknown };
  const expected = [...ids].sort((a, b) => a - b);
  if (expected.length < 2 || expected.length > 8 || new Set(expected).size !== expected.length) return false;
  if (!expected.every(id => Number.isSafeInteger(id) && id > 0) || report.projectId !== projectId || !Array.isArray(report.analysisIds)) return false;
  const actual = [...report.analysisIds].sort((a, b) => Number(a) - Number(b));
  return actual.length === expected.length && actual.every((id, index) => id === expected[index])
    && report.selectionKey === expected.join("-");
}
