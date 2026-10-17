// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MonthlyFinancialReportPreview } from "@shared/monthlyFinancialReportPreview";
import MonthlyFinancialFilePreview from "./MonthlyFinancialFilePreview";

// Local runtime contract only: the installed jsdom package has no declaration
// package here. Do not widen the application/global DOM types to accommodate it.
type CollectorDom = { window: Pick<Window, "document" | "navigator" | "close"> & {
  File: typeof File;
  XMLHttpRequest: typeof XMLHttpRequest;
  eval(source: string): unknown;
} };
const { JSDOM } = createRequire(resolve(process.cwd(), "package.json"))("jsdom") as {
  JSDOM: new (html: string, options: { url: string; runScripts: "outside-only" }) => CollectorDom;
};
const tasks = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("./monthlyFinancialPreviewTask", () => ({ startMonthlyFinancialPreview: tasks.start }));
const collectorSource = readFileSync(resolve(process.cwd(), "client/public/__manus__/debug-collector.js"), "utf8");
const fileName = "synthetic-private-month.csv", fileValue = `C:\\fakepath\\${fileName}`;
const originalText = "Synthetic private source amount 83.21";
const outsideText = "Outside telemetry positive sentinel";
const windows: CollectorDom[] = [];

function preview(): MonthlyFinancialReportPreview {
  const absentMetric = (): MonthlyFinancialReportPreview["rows"][number]["metrics"]["financialProfit"] => ({
    value: null, sources: [], unknownSources: [], absent: true,
  });
  const metrics: MonthlyFinancialReportPreview["rows"][number]["metrics"] = {
    financialProfit: absentMetric(), salesQty: absentMetric(), salesAmount: absentMetric(),
    otherIncome: absentMetric(), discount: absentMetric(), purchaseCost: absentMetric(),
    freight: absentMetric(), fbaFee: absentMetric(), commission: absentMetric(),
    advertising: absentMetric(), promotion: absentMetric(), storage: absentMetric(),
    otherFees: absentMetric(), refundAmount: absentMetric(), refundQty: absentMetric(),
    returnQty: absentMetric(), adOrders: absentMetric(), adSales: absentMetric(),
    ld: absentMetric(), coupon: absentMetric(), vine: absentMetric(),
  };
  const ratio = { numerator: null, denominator: null, fraction: null, reason: "未知" };
  return {
    mode: "memory-preview-only", format: "csv", byteLength: 24, amountConvention: "source-signed-no-conversion",
    sheets: [{ name: "Synthetic", range: "A1:A2", headerRows: [1], columns: [] }],
    rows: [{ sheet: "Synthetic", rowNumber: 2, kind: "data", yearMonth: "2026-04", asin: "B000000001",
      parentAsin: null, parentCandidates: [], sku: null, title: null, storeName: "Synthetic Store", site: "US",
      currency: "USD", currencySource: "column", allocation: "asin", metrics,
      ratios: { profitMargin: ratio, refundRate: ratio, returnRate: ratio },
      cells: [{ address: "A2", value: originalText, formula: null, format: null, error: false }],
    }], summaries: [], warnings: [], excludedFromSummaries: [],
  };
}

/** Execute the unmodified real collector in its own browser realm. Its original
 * fetch, beacon, XHR and interval boundaries are controlled; no real network or
 * repeating timer is installed. The parser task alone is a display fixture. */
function environment() {
  const dom = new JSDOM("<!doctype html><html><body><div id='mount'></div></body></html>", {
    url: "https://synthetic-preview.invalid/", runScripts: "outside-only",
  });
  windows.push(dom);
  const reports: unknown[] = [], intervals: Array<() => unknown> = [];
  const fetch = vi.fn(async (url: unknown, init?: { body?: unknown }) => {
    expect(url).toBe("/__manus__/logs");
    expect(typeof init?.body).toBe("string");
    reports.push(JSON.parse(init!.body as string));
    return { ok: true };
  });
  Object.defineProperty(dom.window, "fetch", { configurable: true, writable: true, value: fetch });
  const beacon = vi.fn(() => true);
  Object.defineProperty(dom.window.navigator, "sendBeacon", { configurable: true, value: beacon });
  const xhrSend = vi.spyOn(dom.window.XMLHttpRequest.prototype, "send").mockImplementation(() => {
    throw new Error("Unexpected XHR in privacy fixture");
  });
  Object.defineProperty(dom.window, "setInterval", { configurable: true, value: (callback: () => unknown, delay: number) => {
    expect(delay).toBe(2000); intervals.push(callback); return intervals.length;
  } });
  render(<MonthlyFinancialFilePreview scopeKey="synthetic-owner" />, { container: dom.window.document.getElementById("mount")! });
  const ui = within(dom.window.document.body), section = ui.getByRole("region", { name: "月报本地内存预览" });
  dom.window.eval(collectorSource);
  expect(intervals).toHaveLength(1);
  const input = ui.getByLabelText("选择本地月报文件") as HTMLInputElement;
  // Browsers set the native file input value during the picker interaction.
  // JSDOM cannot drive a picker, so supply only its synthetic fakepath value.
  Object.defineProperty(input, "value", { configurable: true, writable: true, value: fileValue });
  async function choose() {
    fireEvent.change(input, { target: { files: [new dom.window.File(["synthetic"], fileName)] } });
    await ui.findByText("当前本地文件：" + fileName);
    await ui.findByRole("button", { name: "查看原字段" });
    fireEvent.click(ui.getByRole("button", { name: "查看原字段" }));
    return within(ui.getByRole("region", { name: "所选月报原字段" })).getByText(originalText);
  }
  async function flushWithOutsideControl() {
    const outside = dom.window.document.createElement("button");
    outside.textContent = outsideText; dom.window.document.body.append(outside);
    fireEvent.click(outside);
    await intervals[0]();
    expect(fetch).toHaveBeenCalledOnce();
    expect(xhrSend).not.toHaveBeenCalled(); expect(beacon).not.toHaveBeenCalled();
    const encoded = JSON.stringify(reports);
    expect(encoded).toContain(outsideText);
    return encoded;
  }
  return { dom, section, input, choose, flushWithOutsideControl };
}

beforeEach(() => {
  tasks.start.mockReset().mockImplementation(() => ({ promise: Promise.resolve(preview()), cancel: vi.fn() }));
});
afterEach(() => {
  cleanup();
  for (const dom of windows.splice(0)) dom.window.close();
  vi.restoreAllMocks();
});

describe("monthly preview: real collector section-local privacy", () => {
  it("has a working unmarked positive control: capture sees the picker filename and clicked source text", async () => {
    const env = environment(); env.section.classList.remove("manus-no-record");
    const cell = await env.choose();
    // React already cleared input.value, but document capture ran before it.
    expect(env.input.value).toBe("");
    env.input.value = fileValue; fireEvent.focusOut(env.input); fireEvent.click(cell);
    const encoded = await env.flushWithOutsideControl();
    expect(encoded).toContain(fileName); expect(encoded).toContain(originalText);
    expect(encoded).toContain('"kind":"change"'); expect(encoded).toContain('"kind":"focusout"');
  });

  it.each(["change", "focusout", "nested source click"])("excludes %s inside the actual component while outside events still report", async kind => {
    const env = environment();
    const cell = await env.choose();
    if (kind === "focusout") { env.input.value = fileValue; fireEvent.focusOut(env.input); }
    if (kind === "nested source click") fireEvent.click(cell);
    const encoded = await env.flushWithOutsideControl();
    expect(encoded).not.toContain(fileName); expect(encoded).not.toContain(originalText);
    expect(encoded).not.toContain("月报本地内存预览");
    expect(env.section).toHaveClass("manus-no-record");
    expect(cell.closest(".manus-no-record")).toBe(env.section);
  });
});
