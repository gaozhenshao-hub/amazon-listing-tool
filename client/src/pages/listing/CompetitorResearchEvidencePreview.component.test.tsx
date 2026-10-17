// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompetitorResearchEvidenceSummary } from "@shared/competitorResearchEvidence";
import CompetitorResearchEvidencePreview from "./CompetitorResearchEvidencePreview";

const state = vi.hoisted(() => {
  const query = vi.fn();
  return { query, client: { analysis: { previewResearchEvidence: { query } } },
    auth: { user: { id: 1, defaultWorkspaceId: 9, role: "admin" } as { id: number; defaultWorkspaceId: number | null | undefined; role: string } | null,
      loading: false, error: null as Error | null } };
});
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => state.auth }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: state.client }) } }));
const props = { projectId: 7, analysisId: 3, asin: "B000000003", revision: "a".repeat(64) };
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function summary(): CompetitorResearchEvidenceSummary {
  return { version: 1, identity: { userId: 1, workspaceId: 9, sourceWorkspaceId: null, ...props },
    evidenceHash: "b".repeat(64), modelRead: false, listing: { titleAvailable: true, bulletCount: 5, sourceCount: 6 },
    reviews: { status: "available", total: 61, parserCorpusHash: "c".repeat(64), authorizedCorpusHash: "d".repeat(64),
      sourceFileHash: "e".repeat(64), scope: "complete_file_not_market_total", batchCount: 2, totalBatchUtf8Bytes: 31000,
      batches: [{ batchId: "analysis:3:reviews:1", count: 40, utf8Bytes: 20000, sha256: "f".repeat(64) },
        { batchId: "analysis:3:reviews:2", count: 21, utf8Bytes: 11000, sha256: "0".repeat(64) }] } };
}
function unavailable() {
  const value = summary(); value.reviews = { status: "unavailable", total: null, parserCorpusHash: null, authorizedCorpusHash: null,
    sourceFileHash: null, scope: null, batchCount: 0, totalBatchUtf8Bytes: 0, batches: [] }; return value;
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const click = () => fireEvent.click(screen.getByRole("button", { name: "预览生成依据" }));
beforeEach(() => {
  state.query.mockReset().mockResolvedValue(summary());
  state.auth.user = { id: 1, defaultWorkspaceId: 9, role: "admin" }; state.auth.loading = false; state.auth.error = null;
});
afterEach(cleanup);

describe("explicit evidence preview — no analysis or full text", () => {
  it("does not request on mount or StrictMode replay; exact explicit read binds the current row", async () => {
    render(<StrictMode><CompetitorResearchEvidencePreview {...props} /></StrictMode>);
    expect(state.query).not.toHaveBeenCalled(); click();
    expect(await screen.findByLabelText("已核对的证据摘要")).toHaveTextContent("标题原文：已保存；五点原文：5 条");
    expect(state.query).toHaveBeenCalledOnce();
    expect(state.query.mock.calls[0][0]).toEqual({ projectId: 7, analysisId: 3, expectedWorkspaceId: 9, expectedRevision: props.revision });
    expect(state.query.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(screen.getByText(/评论：61 条/)).toBeInTheDocument();
    expect(screen.getByText(/计划分批：2 批/)).toHaveTextContent("31000 字节");
    expect(screen.getByText(/图片内容、OCR 和问答尚未纳入/)).toHaveTextContent("不代表标题、卖点、买家与总结四项研究已完成");
  });
  it("clears the old preview while explicitly refreshing and suppresses double clicks", async () => {
    render(<CompetitorResearchEvidencePreview {...props} />); click(); await screen.findByLabelText("已核对的证据摘要");
    const next = deferred<CompetitorResearchEvidenceSummary>(); state.query.mockReturnValueOnce(next.promise);
    click(); click(); expect(screen.queryByLabelText("已核对的证据摘要")).not.toBeInTheDocument();
    expect(state.query).toHaveBeenCalledTimes(2); expect(screen.getByRole("button")).toBeDisabled();
    await act(async () => next.resolve(summary())); expect(screen.getByRole("button")).toBeEnabled();
  });
  it("distinguishes unavailable unknown from an available empty file sample", async () => {
    state.query.mockResolvedValueOnce(unavailable()); render(<CompetitorResearchEvidencePreview {...props} />); click();
    expect(await screen.findByText(/原评论来源未知/)).toHaveTextContent("不能视为 0 条");
    expect(screen.queryByText(/计划分批/)).not.toBeInTheDocument();
    const empty = summary(); Object.assign(empty.reviews, { total: 0, batchCount: 0, totalBatchUtf8Bytes: 0, batches: [] });
    state.query.mockResolvedValueOnce(empty); click();
    expect(await screen.findByText(/评论：0 条/)).toBeInTheDocument(); expect(screen.getByText(/计划分批：0 批/)).toBeInTheDocument();
  });
  it.each(["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND", "CONFLICT", "PRECONDITION_FAILED", "INTERNAL_SERVER_ERROR"])("clears old data and never echoes %s error payloads or retries", async code => {
    render(<CompetitorResearchEvidencePreview {...props} />); click(); await screen.findByLabelText("已核对的证据摘要");
    state.query.mockRejectedValueOnce({ data: { code }, message: "secret filename / author / model result", stack: "private" }); click();
    expect(await screen.findByRole("alert")).toHaveTextContent("旧预览已隐藏");
    expect(screen.queryByLabelText("已核对的证据摘要")).not.toBeInTheDocument(); expect(document.body.textContent).not.toContain("secret");
    expect(state.query).toHaveBeenCalledTimes(2);
  });
  it("rejects raw-data and arbitrary reason extensions instead of displaying them", async () => {
    state.query.mockResolvedValueOnce({ ...summary(), reason: "private reason", items: [{ body: "secret full text" }] });
    render(<CompetitorResearchEvidencePreview {...props} />); click(); await screen.findByRole("alert");
    expect(document.body.textContent).not.toContain("private reason"); expect(document.body.textContent).not.toContain("secret full text");
  });
});

describe("summary runtime shape and coverage", () => {
  it.each(["userId", "workspaceId", "sourceWorkspaceId", "projectId", "analysisId", "asin", "revision"])("rejects mismatched %s", async key => {
    const value = summary(); Object.assign(value.identity, { [key]: key === "asin" ? "B000000004" : key === "revision" ? "1".repeat(64) : 21 });
    state.query.mockResolvedValueOnce(value); render(<CompetitorResearchEvidencePreview {...props} />); click();
    await screen.findByRole("alert"); expect(screen.queryByLabelText("已核对的证据摘要")).not.toBeInTheDocument();
  });
  it.each(["version", "modelRead", "hash", "parserHash", "authorizedHash", "fileHash", "listingCount", "negative", "batchCount", "total", "bytes", "batchId", "duplicate", "batchHash", "overCount", "overBytes", "zeroBatch", "scope", "totalUnknown"])("refuses malformed %s rather than a ready preview", async kind => {
    const value = summary(), r = value.reviews;
    if (kind === "version") Object.assign(value, { version: 2 });
    if (kind === "modelRead") Object.assign(value, { modelRead: true });
    if (kind === "hash") value.evidenceHash = "short";
    if (kind === "parserHash") r.parserCorpusHash = null;
    if (kind === "authorizedHash") r.authorizedCorpusHash = "F".repeat(64);
    if (kind === "fileHash") r.sourceFileHash = "bad";
    if (kind === "listingCount") value.listing.sourceCount = 7;
    if (kind === "negative") value.listing.bulletCount = -1;
    if (kind === "batchCount") r.batchCount = 3;
    if (kind === "total") r.total = 62;
    if (kind === "bytes") r.totalBatchUtf8Bytes++;
    if (kind === "batchId") r.batches[0].batchId = "analysis:4:reviews:1";
    if (kind === "duplicate") r.batches[1].batchId = r.batches[0].batchId;
    if (kind === "batchHash") r.batches[0].sha256 = "invalid";
    if (kind === "overCount") { r.batches[0].count = 61; r.total = 82; }
    if (kind === "overBytes") { r.batches[0].utf8Bytes = 24577; r.totalBatchUtf8Bytes = 35577; }
    if (kind === "zeroBatch") { r.batches[0].count = 0; r.total = 21; }
    if (kind === "scope") Object.assign(r, { scope: "all_market" });
    if (kind === "totalUnknown") r.total = null;
    state.query.mockResolvedValueOnce(value); render(<CompetitorResearchEvidencePreview {...props} />); click();
    await screen.findByRole("alert"); expect(screen.queryByLabelText("已核对的证据摘要")).not.toBeInTheDocument();
  });
  it.each(["total", "parserCorpusHash", "authorizedCorpusHash", "sourceFileHash", "scope", "batch"])("unknown source cannot carry a fake %s", async key => {
    const value = unavailable();
    if (key === "batch") Object.assign(value.reviews, { batchCount: 1, totalBatchUtf8Bytes: 20000, batches: [summary().reviews.batches[0]] });
    else Object.assign(value.reviews, { [key]: key === "total" ? 0 : key === "scope" ? "complete_file_not_market_total" : "a".repeat(64) });
    state.query.mockResolvedValueOnce(value); render(<CompetitorResearchEvidencePreview {...props} />); click(); await screen.findByRole("alert");
  });
  it("does not invoke response getters or accept sparse batches", async () => {
    const unsafe = summary(); let calls = 0;
    Object.defineProperty(unsafe, "modelRead", { enumerable: true, get() { calls++; return false; } });
    state.query.mockResolvedValueOnce(unsafe); render(<CompetitorResearchEvidencePreview {...props} />); click(); await screen.findByRole("alert"); expect(calls).toBe(0);
    const sparse = summary(); sparse.reviews.batches = new Array(2); state.query.mockResolvedValueOnce(sparse); click(); await screen.findByRole("alert");
    expect(screen.queryByLabelText("已核对的证据摘要")).not.toBeInTheDocument();
  });
});

describe("owner, pending auth and row-version isolation", () => {
  it.each(["loading", "error", "noUser", "noWorkspace", "badWorkspace", "noRole"])("does no private business IO while %s", kind => {
    if (kind === "loading") state.auth.loading = true;
    if (kind === "error") state.auth.error = new Error("private auth error");
    if (kind === "noUser") state.auth.user = null;
    if (kind === "noWorkspace") state.auth.user!.defaultWorkspaceId = undefined;
    if (kind === "badWorkspace") state.auth.user!.defaultWorkspaceId = 0;
    if (kind === "noRole") state.auth.user!.role = "";
    render(<CompetitorResearchEvidencePreview {...props} />); expect(screen.queryByRole("button")).not.toBeInTheDocument(); expect(state.query).not.toHaveBeenCalled();
  });
  it.each([{ projectId: 0 }, { analysisId: -1 }, { analysisId: 1.5 }, { asin: "invalid" }, { revision: "" }])("invalid props %j cannot query", patch => {
    render(<CompetitorResearchEvidencePreview {...props} {...patch} />); expect(screen.queryByRole("button")).not.toBeInTheDocument(); expect(state.query).not.toHaveBeenCalled();
  });
  it("accepts legacy NULL workspace and explicit NULL source workspace", async () => {
    state.auth.user!.defaultWorkspaceId = null; const value = summary(); value.identity.workspaceId = null;
    state.query.mockResolvedValueOnce(value); render(<CompetitorResearchEvidencePreview {...props} />); click(); await screen.findByLabelText("已核对的证据摘要");
    expect(state.query.mock.calls[0][0].expectedWorkspaceId).toBeNull();
  });
  it.each(["user", "workspace", "nullWorkspace", "role", "project", "analysis", "asin", "revision"])("discards loaded and late old responses after %s changes, including a switch back", async kind => {
    const view = render(<CompetitorResearchEvidencePreview {...props} />); click(); await screen.findByLabelText("已核对的证据摘要");
    const old = deferred<CompetitorResearchEvidenceSummary>(); state.query.mockReturnValueOnce(old.promise); click();
    const signal = state.query.mock.calls[1][1].signal as AbortSignal, next = { ...props };
    if (kind === "user") state.auth.user!.id = 2;
    if (kind === "workspace") state.auth.user!.defaultWorkspaceId = 10;
    if (kind === "nullWorkspace") state.auth.user!.defaultWorkspaceId = null;
    if (kind === "role") state.auth.user!.role = "readonly";
    if (kind === "project") next.projectId = 8;
    if (kind === "analysis") next.analysisId = 4;
    if (kind === "asin") next.asin = "B000000004";
    if (kind === "revision") next.revision = "b".repeat(64);
    view.rerender(<CompetitorResearchEvidencePreview {...next} />); expect(signal.aborted).toBe(true);
    expect(screen.queryByLabelText("已核对的证据摘要")).not.toBeInTheDocument(); expect(state.query).toHaveBeenCalledTimes(2);
    state.auth.user = { id: 1, defaultWorkspaceId: 9, role: "admin" }; view.rerender(<CompetitorResearchEvidencePreview {...props} />);
    await act(async () => old.resolve(copy(summary())));
    expect(screen.queryByLabelText("已核对的证据摘要")).not.toBeInTheDocument(); expect(state.query).toHaveBeenCalledTimes(2);
    click(); await screen.findByLabelText("已核对的证据摘要"); expect(state.query).toHaveBeenCalledTimes(3);
  });
  it.each(["loading", "error", "logout"])("destroys private response on %s and requires another explicit read after recovery", async kind => {
    const view = render(<CompetitorResearchEvidencePreview {...props} />); click(); await screen.findByLabelText("已核对的证据摘要");
    if (kind === "loading") state.auth.loading = true;
    if (kind === "error") state.auth.error = new Error("private");
    if (kind === "logout") state.auth.user = null;
    view.rerender(<CompetitorResearchEvidencePreview {...props} />); expect(screen.queryByLabelText("已核对的证据摘要")).not.toBeInTheDocument();
    state.auth.loading = false; state.auth.error = null; state.auth.user = { id: 1, defaultWorkspaceId: 9, role: "admin" };
    view.rerender(<CompetitorResearchEvidencePreview {...props} />); expect(state.query).toHaveBeenCalledOnce(); expect(screen.queryByLabelText("已核对的证据摘要")).not.toBeInTheDocument();
  });
  it("unmounts with abort and ignores both late success and failure without another request", async () => {
    const old = deferred<CompetitorResearchEvidenceSummary>(); state.query.mockReturnValueOnce(old.promise);
    const view = render(<CompetitorResearchEvidencePreview {...props} />); click(); const signal = state.query.mock.calls[0][1].signal as AbortSignal; view.unmount();
    expect(signal.aborted).toBe(true); await act(async () => old.resolve(summary())); expect(state.query).toHaveBeenCalledOnce();
    const failure = deferred<CompetitorResearchEvidenceSummary>(); state.query.mockReturnValueOnce(failure.promise);
    const second = render(<CompetitorResearchEvidencePreview {...props} />); click(); second.unmount();
    await act(async () => failure.reject(new Error("secret late failure"))); expect(document.body.textContent).not.toContain("secret");
  });
});
