import { describe, expect, it } from "vitest";
import {
  collectSaihuReport,
  validateSaihuReportSource,
} from "./saihuReportCoverage";
import { saihuReportDecimalSum } from "./saihuReportDecimal";
import {
  syntheticSaihuContract,
  syntheticSaihuRead,
  syntheticSaihuRow,
  fixtureIdentity,
  fixtureUuid,
} from "./saihuReportTestFixture";
import {
  SaihuReportDate,
  saihuReportHash,
  saihuReportWeek,
} from "../../../shared/saihuReportSync";

async function collect(
  patch: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
  monthly = false
) {
  const contract = syntheticSaihuContract(monthly ? "monthly" : "daily"),
    period = monthly ? "2026-09" : "2026-10-01";
  return collectSaihuReport(
    {
      version: 1,
      identity: fixtureIdentity,
      operationId: fixtureUuid(1),
      scope: {
        kind: monthly ? "monthly" : "daily",
        start: period,
        end: period,
      },
      connectionVersion: "a".repeat(64),
      contractHash: saihuReportHash(contract),
      shops: contract.shops,
    },
    contract,
    async () =>
      syntheticSaihuRead(
        [syntheticSaihuRow(period, contract.kind, patch)],
        extra
      ),
    new AbortController().signal
  );
}

describe("Saihu actual raw-source coverage and decimal mapper", () => {
  it("preserves raw UTF-8 bytes and derives Saturday–Friday without Qingdao calendar changes", async () => {
    const result = await collect();
    expect(result.preview.coverage.complete).toBe(true);
    expect(result.source.pages[0].originalUtf8).toContain("产品");
    expect(saihuReportWeek("2026-10-01")).toEqual({
      weekStartDate: "2026-09-26",
      weekEndDate: "2026-10-02",
    });
    expect(SaihuReportDate.safeParse("2026-02-31").success).toBe(false);
    expect(SaihuReportDate.safeParse("2024-02-29").success).toBe(true);
  });
  it.each([
    { period: "2026-10-02" },
    { currency: "CNY" },
    { shopId: "s2" },
    { country: "UK" },
    { parent: ["B000000001", "B000000003"] },
  ])("rejects unverified response identity/period/currency %j", async patch => {
    await expect(collect(patch)).rejects.toThrow();
  });
  it("requires an actual settlement source field rather than assigning requested month/caliber", async () => {
    await expect(collect({ caliber: "accrual" }, {}, true)).rejects.toThrow(
      "SOURCE_PERIOD_OR_CURRENCY_INVALID"
    );
    expect((await collect({}, {}, true)).preview.monthlyRows[0].period).toBe(
      "2026-09"
    );
  });
  it.each([
    { total: 2 },
    { pageNo: 2 },
    { pageCount: 2 },
    { emptyShops: ["s1"] },
  ])(
    "rejects incomplete or contradictory pagination/coverage %j",
    async extra => {
      await expect(collect({}, extra)).rejects.toThrow();
    }
  );
  it("replays saved bytes and rejects modified JSON or bytes even when normalized facts look unchanged", async () => {
    const result = await collect(),
      contract = syntheticSaihuContract("daily"),
      raw = structuredClone(result.source);
    raw.pages[0].originalUtf8 += " ";
    expect(() => validateSaihuReportSource(raw, contract)).toThrow(
      "SOURCE_BYTES_INVALID"
    );
    const duplicate = structuredClone(result.source),
      read = syntheticSaihuRead([syntheticSaihuRow(), syntheticSaihuRow()]);
    Object.assign(duplicate.pages[0], read);
    expect(() => validateSaihuReportSource(duplicate, contract)).toThrow(
      "DUPLICATE_IDENTITY"
    );
  });
  it("does exact signed decimal normalization without rounding away minor units", () => {
    expect(
      saihuReportDecimalSum([
        { value: 0.1, multiplier: 1, divisor: 1 },
        { value: 0.2, multiplier: 1, divisor: 1 },
      ])
    ).toBe(0.3);
    expect(
      saihuReportDecimalSum([
        { value: 100, multiplier: 1, divisor: 1 },
        { value: 25, multiplier: -1, divisor: 100 },
      ])
    ).toBe(99.75);
    expect(() =>
      saihuReportDecimalSum([{ value: 1e-15, multiplier: 1, divisor: 1 }])
    ).toThrow("METRIC_PRECISION_UNVERIFIED");
  });
});
