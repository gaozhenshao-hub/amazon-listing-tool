export type DailyPerformanceEvidenceRow = {
  asin: string;
  storeName: string;
  country: string;
  reportDate: string;
  salesQty: number | null;
  orderProfit: number | string | null;
  fbaAvailable: number | null;
  availableStock: number | null;
  fbaInTransit: number | null;
  sourceType?: string | null;
};

export type CompleteCoverageEvidence = {
  asin: string;
  storeName: string;
  country: string;
  reportDate: string;
  salesQty: number;
  orderProfit: number;
  totalInventory: number;
};

const identityKey = (row: Pick<DailyPerformanceEvidenceRow, "asin" | "storeName" | "country">) =>
  `${row.asin}::${row.storeName}::${row.country}`;

const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const sourcePriority = (sourceType: string | null | undefined) => {
  if (sourceType === "lingxing_mcp") return 3;
  if (sourceType === "lingxing") return 2;
  return 1;
};

/**
 * 活跃商品过滤会省略全零行。只有某日已由完整、无截断的官方MCP批次覆盖时，
 * 才可以将该已知ASIN在该日的缺席解释为零值；任何未覆盖日期均使90天证据不足。
 */
export function buildCompleteCoverageEvidence(
  rows: DailyPerformanceEvidenceRow[],
  coveredDates: Set<string>,
  requiredDays = 90,
): Map<string, CompleteCoverageEvidence[]> {
  const latestCoveredDate = [...coveredDates].sort().at(-1);
  if (!latestCoveredDate) return new Map();
  const startDate = addDays(latestCoveredDate, -(requiredDays - 1));
  const requiredDates: string[] = [];
  for (let date = startDate; date <= latestCoveredDate; date = addDays(date, 1)) requiredDates.push(date);
  if (requiredDates.some(date => !coveredDates.has(date))) return new Map();

  // 仅以窗口开始时已经存在的身份决定是否可补零，避免把窗口中途才上架的新品误判为停售；
  // 但窗口内后续真实活跃行必须完整参与证据计算，不能因“已知身份”筛选被遗漏。
  const knownRows = rows.filter(row => row.reportDate <= latestCoveredDate);
  const latestByIdentityAndDate = new Map<string, DailyPerformanceEvidenceRow>();
  const knownIdentities = new Map<string, Pick<DailyPerformanceEvidenceRow, "asin" | "storeName" | "country">>();
  const firstSeenDateByIdentity = new Map<string, string>();
  for (const row of knownRows) {
    const key = identityKey(row);
    knownIdentities.set(key, row);
    const firstSeen = firstSeenDateByIdentity.get(key);
    if (!firstSeen || row.reportDate < firstSeen) firstSeenDateByIdentity.set(key, row.reportDate);
    if (!coveredDates.has(row.reportDate)) continue;
    const dateKey = `${key}::${row.reportDate}`;
    const previous = latestByIdentityAndDate.get(dateKey);
    if (!previous || sourcePriority(row.sourceType) > sourcePriority(previous.sourceType)) {
      latestByIdentityAndDate.set(dateKey, row);
    }
  }

  const evidenceByIdentity = new Map<string, CompleteCoverageEvidence[]>();
  for (const [key, identity] of knownIdentities) {
    if ((firstSeenDateByIdentity.get(key) || latestCoveredDate) > startDate) continue;
    evidenceByIdentity.set(key, requiredDates.map(reportDate => {
      const row = latestByIdentityAndDate.get(`${key}::${reportDate}`);
      return {
        ...identity,
        reportDate,
        salesQty: Number(row?.salesQty || 0),
        orderProfit: Number(row?.orderProfit || 0),
        totalInventory: Number(row?.fbaAvailable ?? row?.availableStock ?? 0) + Number(row?.fbaInTransit || 0),
      };
    }));
  }
  return evidenceByIdentity;
}
