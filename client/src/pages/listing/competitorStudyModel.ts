export interface CompetitorStudyRecord {
  id: number;
  asin: string;
  title?: string | null;
  price?: string | null;
  rating?: string | null;
  reviewCount?: string | number | null;
  bulletPoints?: string | null;
  summary?: string | null;
  aiSummary?: string | null;
  summaryStatus?: string | null;
  summaryVersion?: number | null;
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
  return {
    summary, bullets, bulletsUnavailable, confirmed,
    summarySource: saved.trim() ? "已保存摘要" : summary ? "AI 候选摘要（未确认）" : "尚无已保存分析摘要",
    canConfirm: validIdentity && record.summaryStatus === "draft" && !!summary.trim() && summary.length <= 20_000,
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
