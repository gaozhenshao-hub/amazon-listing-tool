// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompetitorReviewsPage from "./CompetitorReviewsPage";
import type { CompetitorReviewCorpusCoverage, CompetitorReviewItem } from "@shared/competitorReviewCorpus";

const state = vi.hoisted(() => {
  const query = vi.fn(), client = { analysis: { listCompetitorReviews: { query } } };
  return { flag: true, analysisId: "3", search: "projectId=7", query, client,
  auth: { user: { id: 1, defaultWorkspaceId: 9, role: "admin" } as { id: number; defaultWorkspaceId: number | null | undefined; role: string } | null,
    loading: false, error: null as Error | null },
}; });
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => state.auth }));
vi.mock("wouter", () => ({ useParams: () => ({ analysisId: state.analysisId }), useSearch: () => state.search }));
vi.mock("@/lib/mergedListingWorkflow", () => ({ get MERGED_LISTING_WORKFLOW_ENABLED() { return state.flag; } }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: state.client }) } }));

const corpusHash = "a".repeat(64), fileHash = "b".repeat(64);
function item(index = 1): CompetitorReviewItem {
  return { reviewId: `review-${index}`, asin: "B000000003", sourceReviewId: `amazon-${index}`, title: `评论标题 ${index}`,
    body: `<script>原文不是HTML ${index}</script>\n完整评论正文`, rating: 4, date: "2026-10-15", author: "买家", verifiedPurchase: true,
    variant: "Blue", helpfulVotes: 0, occurrences: [{ sheet: "Reviews", row: index + 1, assignment: "row_asin",
      fields: [{ column: 1, header: "ASIN", value: "B000000003" }, { column: 2, header: "Review Text", value: "文件中的完整原文字段" }],
      mapping: { asin: 1, body: 2 }, warnings: [] }] };
}
function coverage(): CompetitorReviewCorpusCoverage {
  return { scope: "complete_file_not_market_total", format: "csv", sourceFileHash: fileHash, sourceBytes: 8000, sourceFileName: "source.csv",
    sheets: [{ name: "Reviews", headerRow: 1, dataRows: 39 }], totalRows: 39, blankRows: 1, emptyBodyRows: 2, unassignedRows: 1,
    otherAsinRows: 2, matchedRows: 33, duplicateRows: 2, uniqueReviews: 31, filenameFallbackRows: 3,
    excluded: [{ sheet: "Reviews", row: 39, reason: "unassigned_asin" }], normalization: "LF_then_trim_no_internal_whitespace_collapse" };
}
function page(number = 1, patch: Record<string, unknown> = {}) {
  return { status: "available", reason: null, parserVersion: "competitor-review-corpus/1", projectId: 7, analysisId: 3, asin: "B000000003", corpusHash,
    source: { runId: "analysis-import-1", fileName: "source.csv", fileHash }, coverage: coverage(),
    items: number === 1 ? Array.from({ length: 30 }, (_, index) => item(index + 1)) : [item(31)], page: number, pageSize: 30, total: 31, ...patch };
}
function itemsWithFirst(patch: Partial<CompetitorReviewItem>) {
  return Array.from({ length: 30 }, (_, index) => index === 0 ? { ...item(), ...patch } : item(index + 1));
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const reload = () => fireEvent.click(screen.getByRole("button", { name: "重新读取来源" }));
beforeEach(() => {
  state.flag = true; state.analysisId = "3"; state.search = "projectId=7";
  state.auth = { user: { id: 1, defaultWorkspaceId: 9, role: "admin" }, loading: false, error: null };
  state.query.mockReset().mockResolvedValue(page());
});
afterEach(cleanup);

describe("read-only original competitor reviews", () => {
  it("renders actual full text, original row locations and honest file coverage", async () => {
    render(<CompetitorReviewsPage />); await screen.findByRole("heading", { name: "B000000003 · 原评论" });
    expect(state.query).toHaveBeenCalledOnce(); expect(state.query).toHaveBeenCalledWith({ projectId: 7, analysisId: 3, expectedWorkspaceId: 9, page: 1, pageSize: 30 }, { signal: expect.any(AbortSignal) });
    expect(screen.getByText(/可恢复原文共 31 条/)).toBeInTheDocument(); expect(screen.getByText(/不是 Amazon 累计评论数，也不是深度分析已读样本数/)).toBeInTheDocument();
    expect(screen.getByText(/未归属 ASIN 1 行/)).toHaveTextContent("其他 ASIN 2 行"); expect(screen.getByText(/合并重复 2 行/)).toBeInTheDocument();
    expect(screen.getByText("来源文件：source.csv")).toBeInTheDocument(); expect(screen.getByText(/Reviews · 第 2 行 · 行内 ASIN/)).toBeInTheDocument();
    expect(screen.getAllByText("文件中的完整原文字段")).toHaveLength(30);
    expect(screen.getByText(/<script>原文不是HTML 1<\/script>/)).toBeInTheDocument(); expect(document.querySelector("script")).toBeNull();
    expect(screen.getByRole("link", { name: "返回竞品并排研究" })).toHaveAttribute("href", "/listing/comparison?projectId=7");
  });
  it("passes explicit NULL workspace without inferring a substitute", async () => {
    state.auth.user!.defaultWorkspaceId = null; render(<CompetitorReviewsPage />); await screen.findByText("来源文件：source.csv");
    expect(state.query).toHaveBeenCalledWith(expect.objectContaining({ expectedWorkspaceId: null }), expect.anything());
  });
  it("pins both next and previous pages to the accepted corpus hash", async () => {
    state.query.mockResolvedValueOnce(page()).mockResolvedValueOnce(page(2)).mockResolvedValueOnce(page()); render(<CompetitorReviewsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "下一页" })); await screen.findByText("第 2 / 2 页");
    expect(state.query).toHaveBeenNthCalledWith(2, { projectId: 7, analysisId: 3, expectedWorkspaceId: 9, page: 2, pageSize: 30, expectedCorpusHash: corpusHash }, expect.anything());
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled(); fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    await screen.findByText("第 1 / 2 页"); expect(state.query).toHaveBeenNthCalledWith(3, expect.objectContaining({ page: 1, expectedCorpusHash: corpusHash }), expect.anything());
  });
  it("unavailable source is not a fake empty corpus or a successful review analysis", async () => {
    state.query.mockResolvedValue(page(1, { status: "unavailable", reason: "原导入文件已不可恢复", parserVersion: null, items: [], total: null, corpusHash: null, source: null, coverage: null }));
    render(<CompetitorReviewsPage />); expect(await screen.findByRole("region", { name: "原评论不可恢复" })).toHaveTextContent("原导入文件已不可恢复");
    expect(screen.getByText(/这不表示零条评论/)).toBeInTheDocument(); expect(screen.queryByRole("navigation", { name: "原评论分页" })).not.toBeInTheDocument();
    expect(screen.queryByText(/可恢复原文共 0/)).not.toBeInTheDocument();
  });
  it("distinguishes a real zero-match file from an unavailable source", async () => {
    state.query.mockResolvedValue(page(1, { total: 0, items: [], coverage: { ...coverage(), totalRows: 6, matchedRows: 0, duplicateRows: 0, uniqueReviews: 0 } }));
    render(<CompetitorReviewsPage />); expect(await screen.findByText(/可恢复原文共 0 条/)).toBeInTheDocument();
    expect(screen.getByText(/此来源文件没有归属当前 ASIN 的有效评论正文/)).toBeInTheDocument(); expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
  });
  it("requires an explicit reload after source change rather than silently changing the denominator", async () => {
    state.query.mockResolvedValueOnce(page()).mockRejectedValueOnce({ data: { code: "PRECONDITION_FAILED" }, message: "COMPETITOR_REVIEWS_CORPUS_CHANGED" }); render(<CompetitorReviewsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "下一页" })); expect(await screen.findByRole("alert")).toHaveTextContent("评论来源已变化");
    expect(screen.queryByText(item().body, { normalizer: value => value })).not.toBeInTheDocument(); expect(state.query).toHaveBeenCalledTimes(2);
    const nextHash = "c".repeat(64); state.query.mockResolvedValueOnce(page(1, { corpusHash: nextHash })); reload(); await screen.findByText("第 1 / 2 页");
    expect(state.query.mock.calls[2][0]).not.toHaveProperty("expectedCorpusHash");
  });
  it.each(["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"])("removes prior original text when %s is returned", async code => {
    render(<CompetitorReviewsPage />); await screen.findByText("来源文件：source.csv");
    state.query.mockRejectedValueOnce({ data: { code } }); reload(); expect(await screen.findByRole("alert")).toHaveTextContent("已隐藏旧内容");
    expect(screen.queryByText(item().body, { normalizer: value => value })).not.toBeInTheDocument(); expect(screen.queryByText("来源文件：source.csv")).not.toBeInTheDocument();
  });
  it("never converts a transport failure into zero reviews or retries automatically", async () => {
    state.query.mockRejectedValueOnce(new Error("network")); render(<CompetitorReviewsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("不能视为零条评论"); expect(state.query).toHaveBeenCalledOnce();
  });
  it.each([
    ["COMPETITOR_REVIEWS_FILE_UNSUPPORTED_OR_INVALID", "仅支持 UTF-8 CSV 和受限 XLSX"],
    ["COMPETITOR_REVIEWS_SOURCE_HISTORY_LIMIT", "反复重新读取不能解除限制"],
    ["COMPETITOR_REVIEWS_SCHEMA_UNAVAILABLE", "读取服务尚未就绪"],
    ["COMPETITOR_REVIEWS_TRANSACTION_REQUIRED", "读取服务尚未就绪"],
    ["COMPETITOR_REVIEWS_WORKSPACE_CHANGED", "当前工作区或评论来源已变化"],
    ["COMPETITOR_REVIEWS_SOURCE_CHANGED", "当前工作区或评论来源已变化"],
    ["COMPETITOR_REVIEWS_CORPUS_CHANGED", "当前工作区或评论来源已变化"],
  ])("classifies the exact fixed error %s without exposing server internals", async (message, expected) => {
    state.query.mockRejectedValueOnce({ data: { code: "PRECONDITION_FAILED" }, message }); render(<CompetitorReviewsPage />);
    const alert = await screen.findByRole("alert"); expect(alert).toHaveTextContent(expected); expect(alert).not.toHaveTextContent(message);
    if (!message.endsWith("CHANGED")) expect(alert).not.toHaveTextContent("来源已变化");
    expect(state.query).toHaveBeenCalledOnce();
  });
  it.each(["PRECONDITION_FAILED", "CONFLICT"])("does not misclassify an arbitrary %s payload as source drift or echo it", async code => {
    state.query.mockRejectedValueOnce({ data: { code }, message: "private raw body: COMPETITOR_REVIEWS_SOURCE_CHANGED" }); render(<CompetitorReviewsPage />);
    const alert = await screen.findByRole("alert"); expect(alert).toHaveTextContent("不能视为零条评论"); expect(alert).not.toHaveTextContent("来源已变化"); expect(alert).not.toHaveTextContent("private raw body");
  });
  it("rejects unavailable with a null reason rather than treating it as a valid missing source", async () => {
    state.query.mockResolvedValueOnce(page(1, { status: "unavailable", reason: null, parserVersion: null, corpusHash: null, source: null, coverage: null, total: null, items: [] }));
    render(<CompetitorReviewsPage />); expect(await screen.findByRole("alert")).toHaveTextContent("返回范围不匹配"); expect(screen.queryByRole("region", { name: "原评论不可恢复" })).not.toBeInTheDocument();
  });
  it("a pinned request cannot silently downgrade to an unavailable source", async () => {
    state.query.mockResolvedValueOnce(page()).mockResolvedValueOnce(page(2, { status: "unavailable", reason: "原文件无法恢复", parserVersion: null, corpusHash: null, source: null, coverage: null, total: null, items: [] }));
    render(<CompetitorReviewsPage />); fireEvent.click(await screen.findByRole("button", { name: "下一页" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("评论来源已变化"); expect(screen.queryByRole("region", { name: "原评论不可恢复" })).not.toBeInTheDocument();
  });
  it.each([1, -1])("rejects file classification totals drifting by %s even with a complete page", async drift => {
    state.query.mockResolvedValueOnce(page(1, { coverage: { ...coverage(), totalRows: coverage().totalRows + drift } })); render(<CompetitorReviewsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("返回范围不匹配");
  });
  it("rejects an incomplete first page even when the reported corpus total and coverage agree", async () => {
    state.query.mockResolvedValueOnce(page(1, { items: [item()] })); render(<CompetitorReviewsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("返回范围不匹配"); expect(screen.queryByText(/第 1 \/ 2 页/)).not.toBeInTheDocument();
  });
  it("rejects an incomplete final page instead of presenting missing original reviews as complete", async () => {
    state.query.mockResolvedValueOnce(page()).mockResolvedValueOnce(page(2, { items: [] })); render(<CompetitorReviewsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "下一页" })); expect(await screen.findByRole("alert")).toHaveTextContent("返回范围不匹配");
  });
  it.each([
    { projectId: 8 }, { analysisId: 4 }, { page: 2 }, { pageSize: 50 }, { corpusHash: "invalid" }, { total: null },
    { coverage: { ...coverage(), uniqueReviews: 30 } }, { source: { runId: "run", fileName: "foreign.csv", fileHash } },
    { items: itemsWithFirst({ reviewId: "review-2" }) }, { items: itemsWithFirst({ asin: "B000000004" }) }, { items: itemsWithFirst({ body: "" }) },
  ])("rejects a mismatched or malformed response %j", async patch => {
    state.query.mockResolvedValueOnce(page(1, patch)); render(<CompetitorReviewsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("返回范围不匹配"); expect(screen.queryByRole("region", { name: "原评论列表" })).not.toBeInTheDocument();
  });
  it("rejects a changed hash even when a pagination endpoint incorrectly returns success", async () => {
    state.query.mockResolvedValueOnce(page()).mockResolvedValueOnce(page(2, { corpusHash: "c".repeat(64) })); render(<CompetitorReviewsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "下一页" })); expect(await screen.findByRole("alert")).toHaveTextContent("返回范围不匹配");
    expect(screen.queryByText(item(31).body, { normalizer: value => value })).not.toBeInTheDocument();
  });
});

describe("review source owner and request isolation", () => {
  it("default-off does not read any source even through a direct route", () => {
    state.flag = false; render(<CompetitorReviewsPage />); expect(screen.getByText("原评论研究入口尚未启用。")).toBeInTheDocument(); expect(state.query).not.toHaveBeenCalled();
  });
  it.each([undefined, 0, -1, 1.5, Number.NaN])("missing or invalid workspace %s cannot read", workspaceId => {
    state.auth.user!.defaultWorkspaceId = workspaceId; render(<CompetitorReviewsPage />); expect(state.query).not.toHaveBeenCalled();
  });
  it.each(["projectId=0", "projectId=-1", "projectId=7x", "", "projectId=7&projectId=8", "projectId=9007199254740992"])("rejects ambiguous/invalid project query %s", search => {
    state.search = search; render(<CompetitorReviewsPage />); expect(screen.getByRole("alert")).toHaveTextContent("链接无效"); expect(state.query).not.toHaveBeenCalled();
  });
  it.each(["3x", "0", "-3", "9007199254740992"])("rejects an invalid analysis id %s", id => {
    state.analysisId = id; render(<CompetitorReviewsPage />); expect(state.query).not.toHaveBeenCalled();
  });
  it.each(["user", "workspace", "role", "project", "analysis"])("clears source and refuses late replies after %s changes", async field => {
    const old = deferred<ReturnType<typeof page>>(); state.query.mockReturnValueOnce(old.promise); const view = render(<CompetitorReviewsPage />);
    if (field === "user") state.auth.user!.id = 2;
    if (field === "workspace") state.auth.user!.defaultWorkspaceId = null;
    if (field === "role") state.auth.user!.role = "readonly";
    if (field === "project") state.search = "projectId=8";
    if (field === "analysis") state.analysisId = "4";
    const next = page(1, { projectId: field === "project" ? 8 : 7, analysisId: field === "analysis" ? 4 : 3,
      items: itemsWithFirst({ body: "新范围原文" }) }); state.query.mockResolvedValueOnce(next); view.rerender(<CompetitorReviewsPage />);
    await screen.findByText("新范围原文"); await act(async () => old.resolve(page()));
    expect(screen.queryByText(item().body, { normalizer: value => value })).not.toBeInTheDocument(); expect(screen.getByText("新范围原文")).toBeInTheDocument();
  });
  it("auth suspension hides private content and requires a fresh read on return", async () => {
    const view = render(<CompetitorReviewsPage />); await screen.findByText("来源文件：source.csv"); state.auth.loading = true; view.rerender(<CompetitorReviewsPage />);
    expect(screen.queryByText(item().body, { normalizer: value => value })).not.toBeInTheDocument(); expect(screen.getByRole("status")).toHaveTextContent("确认原评论读取身份");
    state.auth.loading = false; view.rerender(<CompetitorReviewsPage />); await screen.findByText("来源文件：source.csv"); expect(state.query).toHaveBeenCalledTimes(2);
  });
  it("explicit reread cancels stale pagination and does not let its late success win", async () => {
    const old = deferred<ReturnType<typeof page>>(); state.query.mockResolvedValueOnce(page()).mockReturnValueOnce(old.promise);
    render(<CompetitorReviewsPage />); fireEvent.click(await screen.findByRole("button", { name: "下一页" }));
    state.query.mockResolvedValueOnce(page(1, { items: itemsWithFirst({ body: "重新读取的来源原文" }) })); reload(); await screen.findByText("重新读取的来源原文");
    await act(async () => old.resolve(page(2))); expect(screen.queryByText(item(31).body, { normalizer: value => value })).not.toBeInTheDocument(); expect(screen.getByText("第 1 / 2 页")).toBeInTheDocument();
  });
  it("StrictMode cleanup ignores an old request without dropping the current successful read", async () => {
    const old = deferred<ReturnType<typeof page>>(); state.query.mockReturnValueOnce(old.promise).mockResolvedValueOnce(page(1, { items: itemsWithFirst({ body: "StrictMode 最新原文" }) }));
    render(<StrictMode><CompetitorReviewsPage /></StrictMode>); await screen.findByText("StrictMode 最新原文"); await act(async () => old.resolve(page()));
    expect(screen.queryByText(item().body, { normalizer: value => value })).not.toBeInTheDocument(); expect(screen.getByText("StrictMode 最新原文")).toBeInTheDocument(); expect(state.query).toHaveBeenCalledTimes(2);
  });
  it("mounts the real protected route without adding a model mutation", () => {
    const app = readFileSync(`${process.cwd()}/client/src/App.tsx`, "utf8");
    expect(app).toContain('path="/listing/competitors/:analysisId/reviews"');
    expect(app).toContain('<PermissionGuard moduleId="listing" subModuleId="listing_analysis"><CompetitorReviewsPage /></PermissionGuard>');
  });
});
