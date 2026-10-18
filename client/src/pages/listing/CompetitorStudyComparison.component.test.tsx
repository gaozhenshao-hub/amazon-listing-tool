// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CompetitorStudyComparison from "./CompetitorStudyComparison";
vi.mock("./CompetitorResearchEvidencePreview", () => ({ default: (props: { analysisId: number; projectId: number; revision: string }) =>
  <div data-testid="research-evidence-preview">{JSON.stringify(props)}</div> }));
vi.mock("./CompetitorDeepResultReader", () => ({ default: (props: { analysisId: number; projectId: number; revision: string }) =>
  <div data-testid="saved-deep-result">{JSON.stringify(props)}</div> }));
vi.mock("./CompetitorDeepResearchJobControls", () => ({ default: (props: { analysisId: number; onCompleted?: () => void }) =>
  <button onClick={props.onCompleted}>模拟四栏候选保存 {props.analysisId}</button> }));
vi.mock("./CompetitorDeepAdoptionEditor", () => ({ default: (props: { analysisId: number; onAdopted?: () => void; suspended?: boolean }) =>
  <button disabled={props.suspended} onClick={props.onAdopted}>模拟正式采纳 {props.analysisId}</button> }));

const row = { id: 3, asin: "B000000003", title: "已保存商品", summary: "此前成功保存的精确摘要", aiSummary: "旧 AI 候选",
  summaryStatus: "draft", summaryVersion: 2, bulletPoints: '["真实五点原文"]' };
function mount(patch: Partial<typeof row> & { rawData?: string | null } = {}, pendingIds = new Set<number>()) {
  const onConfirm = vi.fn(), onUnlock = vi.fn();
  const view = render(<CompetitorStudyComparison projectId={7} analyses={[{ ...row, ...patch }]} pendingIds={pendingIds} onConfirm={onConfirm} onUnlock={onUnlock} />);
  return { ...view, onConfirm, onUnlock };
}
afterEach(cleanup);

describe("saved competitor research source state", () => {
  it("retains legacy summary, original bullets and analysis navigation without starting analysis", () => {
    const { onConfirm, onUnlock } = mount();
    expect(screen.getByText(row.summary)).toBeInTheDocument(); expect(screen.getByText("真实五点原文")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "前往竞品采集、分析与后台任务" })).toHaveAttribute("href", "/listing/analysis");
    expect(screen.getByRole("link", { name: `查看 ${row.asin} 原评论` })).toHaveAttribute("href", "/listing/competitors/3/reviews?projectId=7");
    fireEvent.click(screen.getByRole("button", { name: "确认此摘要" }));
    expect(onConfirm).toHaveBeenCalledOnce(); expect(onConfirm.mock.calls[0][1]).toBe(row.summary); expect(onUnlock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /一键分析|重新分析|全部分析/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/历史已保存/)).not.toBeInTheDocument();
  });

  it.each([{ analysisStale: true }, { captureOnly: true }, { analysisStale: true, captureOnly: true }])("keeps old success visible but disables confirmation for %j", flags => {
    const { onConfirm } = mount({ rawData: JSON.stringify(flags) });
    expect(screen.getByText(row.summary)).toBeInTheDocument(); expect(screen.getByText("历史已保存摘要（非当前资料分析）")).toBeInTheDocument();
    expect(screen.getByText(/需要重新分析/)).toBeInTheDocument();
    if ("analysisStale" in flags) expect(screen.getByText(/资料已变化/)).toBeInTheDocument();
    else expect(screen.getByText(/当前仅保存采集资料/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "确认此摘要" }); expect(button).toBeDisabled(); fireEvent.click(button);
    expect(onConfirm).not.toHaveBeenCalled(); expect(screen.queryByText("待确认")).not.toBeInTheDocument();
  });

  it.each([{ analysisStale: true }, { captureOnly: true }])("confirmed historical summary remains explicitly unlockable %j", flags => {
    const { onConfirm, onUnlock } = mount({ rawData: JSON.stringify(flags), summaryStatus: "confirmed" });
    expect(screen.getByText("历史摘要曾确认")).toBeInTheDocument(); expect(screen.queryByText("已确认")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认此摘要" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "解锁此摘要" })); expect(onUnlock).toHaveBeenCalledOnce(); expect(onConfirm).not.toHaveBeenCalled();
  });

  it("invalid source state is unknown rather than a fabricated failed, stale or current success", () => {
    const { onConfirm } = mount({ rawData: "broken JSON" });
    expect(screen.getByText("来源状态未核验")).toBeInTheDocument(); expect(screen.getByText(row.summary)).toBeInTheDocument();
    expect(screen.getByText(/来源状态无法核验/)).toBeInTheDocument(); expect(screen.queryByText("历史摘要")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认此摘要" })); expect(onConfirm).not.toHaveBeenCalled();
  });

  it("explicit false flags preserve legacy confirmation without requiring a deepAnalysis result", () => {
    const { onConfirm } = mount({ rawData: '{"analysisStale":false,"captureOnly":false}' });
    expect(screen.getByText("待确认")).toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "确认此摘要" }));
    expect(onConfirm).toHaveBeenCalledOnce(); expect(screen.queryByText(/需要重新分析/)).not.toBeInTheDocument();
  });

  it("fresh prop updates disable a formerly confirmable card without changing its readable saved text", () => {
    const onConfirm = vi.fn(), onUnlock = vi.fn();
    const view = render(<CompetitorStudyComparison analyses={[row]} pendingIds={new Set()} onConfirm={onConfirm} onUnlock={onUnlock} />);
    expect(screen.getByRole("button", { name: "确认此摘要" })).toBeEnabled();
    view.rerender(<CompetitorStudyComparison analyses={[{ ...row, rawData: '{"analysisStale":true}' }]} pendingIds={new Set()} onConfirm={onConfirm} onUnlock={onUnlock} />);
    const button = screen.getByRole("button", { name: "确认此摘要" }); expect(button).toBeDisabled(); fireEvent.click(button);
    expect(onConfirm).not.toHaveBeenCalled(); expect(screen.getByText(row.summary)).toBeInTheDocument();
  });

  it("pending scope disables both mutations, including an otherwise allowed historical unlock", () => {
    const { onConfirm, onUnlock } = mount({ rawData: '{"analysisStale":true}', summaryStatus: "confirmed" }, new Set([row.id]));
    for (const label of ["确认此摘要", "解锁此摘要"]) { const button = screen.getByRole("button", { name: label }); expect(button).toBeDisabled(); fireEvent.click(button); }
    expect(onConfirm).not.toHaveBeenCalled(); expect(onUnlock).not.toHaveBeenCalled();
  });
  it("does not invent a review source link without an explicit valid parent project", () => {
    render(<CompetitorStudyComparison analyses={[row]} pendingIds={new Set()} onConfirm={vi.fn()} onUnlock={vi.fn()} />);
    expect(screen.queryByRole("link", { name: /原评论/ })).not.toBeInTheDocument();
    expect(screen.getByText(/不代表四项深度分析已完成/)).toBeInTheDocument();
  });
  it("connects the selected saved record to an exact-revision evidence preview without upload", () => {
    render(<CompetitorStudyComparison projectId={7} analyses={[{ ...row, revision: "a".repeat(64) }]} pendingIds={new Set()} onConfirm={vi.fn()} onUnlock={vi.fn()} />);
    expect(screen.getByTestId("research-evidence-preview")).toHaveTextContent(JSON.stringify({ projectId: 7, analysisId: row.id, asin: row.asin, revision: "a".repeat(64) }));
    expect(screen.getByTestId("saved-deep-result")).toHaveTextContent(JSON.stringify({ projectId: 7, analysisId: row.id, asin: row.asin, revision: "a".repeat(64) }));
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
  it("does not pretend an unversioned legacy card is a pinned research input", () => {
    mount(); expect(screen.queryByTestId("research-evidence-preview")).not.toBeInTheDocument();
    expect(screen.queryByTestId("saved-deep-result")).not.toBeInTheDocument();
  });
  it("refreshes the selected saved record after research without confirming its summary", () => {
    const refresh = vi.fn(), confirm = vi.fn();
    render(<CompetitorStudyComparison projectId={7} analyses={[{ ...row, revision: "a".repeat(64) }]} pendingIds={new Set()} onConfirm={confirm} onUnlock={vi.fn()} onResearchCompleted={refresh} />);
    fireEvent.click(screen.getByRole("button", { name: "模拟四栏候选保存 3" }));
    expect(refresh).toHaveBeenCalledOnce(); expect(confirm).not.toHaveBeenCalled();
  });
  it("routes explicit adoption to its own refresh callback without invoking legacy confirmation", () => {
    const adopted = vi.fn(), confirm = vi.fn(); render(<CompetitorStudyComparison projectId={7} analyses={[{ ...row, revision: "a".repeat(64) }]}
      pendingIds={new Set()} onConfirm={confirm} onUnlock={vi.fn()} onAdopted={adopted} />);
    fireEvent.click(screen.getByRole("button", { name: "模拟正式采纳 3" })); expect(adopted).toHaveBeenCalledOnce(); expect(confirm).not.toHaveBeenCalled();
  });
});
