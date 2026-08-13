import { describe, expect, it } from "vitest";
import { evaluateThreeMonthZeroDiscontinuation, evaluateThreeMonthZeroWeeklyDiscontinuation } from "./zeroValueDiscontinuation";

function rows(days: number, values = { salesQty: 0, orderProfit: 0, totalInventory: 0 }) {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date("2026-05-12T00:00:00Z");
    date.setUTCDate(date.getUTCDate() + index);
    return { reportDate: date.toISOString().slice(0, 10), ...values };
  });
}

describe("子 ASIN 三个月零值停售判定", () => {
  it("连续90天销量、库存、利润均为零时允许自动停售", () => {
    expect(evaluateThreeMonthZeroDiscontinuation(rows(90))).toMatchObject({ shouldDiscontinue: true, reason: "three_months_zero", evidenceDays: 90 });
  });

  it("没有连续90天数据时不允许自动停售", () => {
    expect(evaluateThreeMonthZeroDiscontinuation(rows(7))).toMatchObject({ shouldDiscontinue: false, reason: "insufficient_history", evidenceDays: 7 });
  });

  it("存在任何销量、库存或利润时不允许自动停售", () => {
    expect(evaluateThreeMonthZeroDiscontinuation(rows(90, { salesQty: 1, orderProfit: 0, totalInventory: 0 })).shouldDiscontinue).toBe(false);
  });

  it("连续十三周的子 ASIN 七天汇总可作为三个月停售证据", () => {
    const weeks = Array.from({ length: 13 }, (_, index) => {
      const start = new Date("2026-03-30T00:00:00Z");
      start.setUTCDate(start.getUTCDate() + index * 7);
      const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
      return { weekStartDate: start.toISOString().slice(0, 10), weekEndDate: end.toISOString().slice(0, 10), salesQty: 0, orderProfit: 0, totalInventory: 0 };
    });
    expect(evaluateThreeMonthZeroWeeklyDiscontinuation(weeks)).toMatchObject({ shouldDiscontinue: true, reason: "three_months_zero" });
  });
});
