// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useEffect } from "react";
import { SellingPointDirectionDetails, SellingPointPlanSummary } from "./SellingPointPlanSummary";
import { findSuccessfulSellingPointPlan, hasCurrentConfirmedEvidence, recoverSellingPointPlan, sellingPointBuyerReason } from "./reviewRecovery";
import { useSellingPointPlanRecovery } from "./useSellingPointPlanRecovery";

afterEach(cleanup);

const point = {
  index: 1, theme: "Quick setup", themeZh: "便捷安装", description: "Addresses difficult assembly in buyer reviews",
  descriptionZh: "回应评论中的安装痛点", fabeDirection: { feature: "Confirmed connector", benefit: "Less assembly effort" },
  targetKeywords: ["easy setup"], addressesGap: "Reviews mention difficult assembly",
};
const output = {
  sellingPoints: Array.from({ length: 7 }, (_, index) => ({ ...point, index: index + 1, theme: index ? `Direction ${index + 1}` : point.theme })),
  overallStrategy: "先解决高频顾虑，再补充使用场景与信任保障",
  checkListCoverage: { B4_order: "安装痛点排在第一，其次说明使用收益", B9_faq: "回应评论安装问题" },
  researchLimitations: ["当前项目缺少关键词研究，未声称覆盖关键词策略"],
};
const reviewed = {
  id: 11, coreId: "reviewed-core", sellingPointIndex: 0, buyerReason: sellingPointBuyerReason(point),
  factRevisionIdsJson: [21], status: "confirmed", revision: 3, inputHash: "a".repeat(64),
};

describe("selling point planning recovery", () => {
  it("uses the last complete planning run when the latest retry failed, never another project or a bullet draft", () => {
    const saved = { runId: "saved", projectId: 1, status: "succeeded", input: { operation: "sellingPoints", scopeKey: "main" }, output };
    const failed = { ...saved, runId: "failed", status: "failed" };
    expect(findSuccessfulSellingPointPlan(failed, [
      { ...saved, projectId: 2 }, { ...saved, input: { operation: "singleBullet" } }, saved,
    ], 1)).toBe(saved);
    expect(findSuccessfulSellingPointPlan(saved, [{ ...saved, runId: "older" }], 1)).toBe(saved);
    expect(findSuccessfulSellingPointPlan(failed, [{ ...saved, output: { raw: "unparsed" } }], 1)).toBeNull();
  });

  it("restores the original seven directions, bilingual detail, research and B4 order without treating AI as confirmation", () => {
    const recovered = recoverSellingPointPlan(output, [reviewed]);
    expect(recovered.points).toHaveLength(7);
    expect(recovered.points?.[0]).toMatchObject({ ...point, serverCoreId: reviewed.coreId, restoredBuyerReason: reviewed.buyerReason });
    expect(recovered.metadata.overallStrategy).toBe(output.overallStrategy);
    expect(recovered.metadata.checkListCoverage.B4_order).toBe(output.checkListCoverage.B4_order);
    expect(recovered.points?.[0]).not.toHaveProperty("confirmed");
    expect(hasCurrentConfirmedEvidence(reviewed, new Set([22]))).toBe(false);
  });

  it("does not attach old AI explanations to a manually changed reviewed direction", () => {
    const changed = { ...reviewed, buyerReason: "Human direction: Confirmed buying reason" };
    const recovered = recoverSellingPointPlan(output, [changed]);
    expect(recovered.points?.[0]).toMatchObject({ theme: "Human direction", description: "Confirmed buying reason", restoredBuyerReason: changed.buyerReason });
    expect(recovered.points?.[0].themeZh).toBeUndefined();
    expect(recovered.points?.[0].addressesGap).toBe("");
    expect(recovered.metadata.hasReviewedEdits).toBe(true);
  });

  it("restores only reviewed facts/reasons when planning metadata is unavailable, without inventing a strategy", () => {
    const recovered = recoverSellingPointPlan(null, [reviewed]);
    expect(recovered.metadata).toMatchObject({ overallStrategy: "", checkListCoverage: {}, missingPlanningMetadata: true });
    render(<SellingPointPlanSummary metadata={recovered.metadata} />);
    expect(screen.getByText(/未保存整体策略与排序逻辑/)).toBeInTheDocument();
    expect(screen.queryByText(/七条方向的整体策略/)).not.toBeInTheDocument();
  });

  it.each(["job-first", "reviews-first"])("waits for the ledger and preserves reviewed edits when %s", (order) => {
    function Harness({ job, cores, loading }: { job: typeof output | null; cores: typeof reviewed[]; loading: boolean }) {
      const plan = useSellingPointPlanRecovery(1);
      const { restore } = plan;
      useEffect(() => { if (!loading) restore(job ? "run-1" : null, job, cores); }, [job, cores, loading, restore]);
      return <><SellingPointPlanSummary metadata={plan.metadata} /><div data-testid="theme">{plan.points?.[0]?.theme}</div></>;
    }
    const changed = [{ ...reviewed, buyerReason: "Human direction: Reviewed reason" }];
    const { rerender } = render(<Harness job={order === "job-first" ? output : null} cores={order === "reviews-first" ? changed : []} loading={order === "job-first"} />);
    rerender(<Harness job={output} cores={changed} loading={false} />);
    expect(screen.getByTestId("theme")).toHaveTextContent("Human direction");
    expect(screen.getByText(/安装痛点排在第一/)).toBeInTheDocument();
  });

  it("keeps operator edits through later job arrival and repeated query refetches", () => {
    function Harness({ job }: { job: typeof output | null }) {
      const plan = useSellingPointPlanRecovery(1);
      const { restore } = plan;
      useEffect(() => { restore(job ? "run-1" : null, job, [reviewed]); }, [job, restore]);
      return <input aria-label="方向" value={plan.points?.[0]?.theme || ""} onChange={(event) => {
        const theme = event.target.value;
        plan.setPoints((current) => current?.map((item, index) => index ? item : { ...item, theme }) || null);
      }} />;
    }
    const { rerender } = render(<Harness job={null} />);
    fireEvent.change(screen.getByLabelText("方向"), { target: { value: "My unsaved direction" } });
    rerender(<Harness job={output} />);
    rerender(<Harness job={{ ...output }} />);
    expect(screen.getByLabelText("方向")).toHaveValue("My unsaved direction");
  });

  it("clears strategy/coverage on project switch and ignores late callbacks from the previous project", () => {
    const { result, rerender } = renderHook(({ projectId }) => useSellingPointPlanRecovery(projectId), { initialProps: { projectId: 1 } });
    act(() => result.current.restore("a", output, [reviewed]));
    const lateRestoreA = result.current.restore;
    rerender({ projectId: 2 });
    expect(result.current.points).toBeNull();
    expect(result.current.metadata).toMatchObject({ overallStrategy: "", checkListCoverage: {} });
    act(() => lateRestoreA("a", output, [reviewed]));
    expect(result.current.points).toBeNull();
    act(() => result.current.restore(null, null, [{ ...reviewed, coreId: "b", buyerReason: "B: Project B reason" }]));
    expect(result.current.points?.[0].theme).toBe("B");
    expect(result.current.metadata.overallStrategy).toBe("");
  });

  it("does not replace fact-selection/confirmation work when a completed job arrives", () => {
    const { result } = renderHook(() => useSellingPointPlanRecovery(1));
    act(() => result.current.restore(null, null, [reviewed]));
    act(() => result.current.markDirty());
    act(() => result.current.restore("run-1", output, [reviewed]));
    expect(result.current.sourceRunId).toBe("run-1");
    expect(result.current.points?.[0].serverCoreId).toBe(reviewed.coreId);
    expect(result.current.metadata.overallStrategy).toBe(output.overallStrategy);
    expect(result.current.restorationVersion).toBe(1);
  });

  it("reconciles a later authoritative ledger response, but never turns an old AI draft into the reviewed reason", () => {
    const { result } = renderHook(() => useSellingPointPlanRecovery(1));
    act(() => result.current.restore("run-1", output, []));
    act(() => result.current.restore("run-1", output, [{ ...reviewed, buyerReason: "Human revision: Latest reason", revision: 4 }]));
    expect(result.current.points?.[0]).toMatchObject({ theme: "Human revision", serverCoreId: reviewed.coreId, restoredBuyerReason: "Human revision: Latest reason" });
    expect(result.current.metadata.overallStrategy).toBe(output.overallStrategy);
    expect(result.current.metadata.hasReviewedEdits).toBe(true);
  });

  it("does not restore ledger-only cards while the first explicitly requested plan is still pending", () => {
    const { result } = renderHook(() => useSellingPointPlanRecovery(1));
    act(() => result.current.prepare(null));
    act(() => result.current.restore(null, null, [reviewed]));
    expect(result.current.points).toBeNull();
    act(() => result.current.restore("new", output, [reviewed]));
    expect(result.current.points).toHaveLength(7);
  });

  it.each(["failed", "canceled", "submission-failed"])("restores the previous complete plan without refresh after %s", (status) => {
    const { result } = renderHook(() => useSellingPointPlanRecovery(1));
    act(() => result.current.restore("old-success", output, [reviewed]));
    act(() => result.current.prepare("old-success"));
    act(() => result.current.settleUnsuccessfulAttempt(status === "submission-failed" ? undefined : { runId: "new-attempt", status }));
    expect(result.current.awaitingNewRun).toBe(false);
    act(() => result.current.restore("old-success", output, [reviewed]));
    expect(result.current.points).toHaveLength(7);
    expect(result.current.metadata.overallStrategy).toBe(output.overallStrategy);
    expect(result.current.metadata.checkListCoverage.B4_order).toBe(output.checkListCoverage.B4_order);
    expect(result.current.points?.[0].serverCoreId).toBe(reviewed.coreId);
  });

  it("keeps the gate closed for an old failed attempt and for a currently queued/running attempt", () => {
    const { result } = renderHook(() => useSellingPointPlanRecovery(1));
    act(() => result.current.prepare("old-failure"));
    for (const run of [{ runId: "old-failure", status: "failed" }, { runId: "new", status: "queued" }, { runId: "new", status: "running" }]) {
      act(() => result.current.settleUnsuccessfulAttempt(run));
      expect(result.current.awaitingNewRun).toBe(true);
      expect(result.current.points).toBeNull();
    }
  });

  it("ignores a previous project's late submission failure while a new project is generating", () => {
    const { result, rerender } = renderHook(({ projectId }) => useSellingPointPlanRecovery(projectId), { initialProps: { projectId: 1 } });
    act(() => result.current.prepare(null));
    const failedProjectA = result.current.settleUnsuccessfulAttempt;
    rerender({ projectId: 2 });
    act(() => result.current.prepare(null));
    act(() => failedProjectA());
    expect(result.current.awaitingNewRun).toBe(true);
    expect(result.current.points).toBeNull();
  });

  it("does not resurrect dismissed plans; an explicit new request accepts only a new completed run", () => {
    const { result } = renderHook(() => useSellingPointPlanRecovery(1));
    act(() => result.current.restore("old", output, []));
    act(() => result.current.reset());
    act(() => result.current.restore("old", output, []));
    expect(result.current.points).toBeNull();
    act(() => result.current.prepare("old"));
    act(() => result.current.restore("old", output, []));
    expect(result.current.points).toBeNull();
    act(() => result.current.restore("new", output, []));
    expect(result.current.points).toHaveLength(7);
    expect(result.current.metadata.overallStrategy).toBe(output.overallStrategy);
  });

  it("renders overall strategy and ordering above the directions, with honest research limitations", () => {
    const recovered = recoverSellingPointPlan(output, []);
    render(<><SellingPointPlanSummary metadata={recovered.metadata} />{recovered.points?.map((item) => <article key={item.index}>{item.theme}</article>)}</>);
    expect(screen.getByText("七条方向的整体策略：")).toBeInTheDocument();
    expect(screen.getByText("排序逻辑：")).toBeInTheDocument();
    expect(screen.getByText(output.researchLimitations[0])).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(7);
    expect(screen.getByText("排序逻辑：").compareDocumentPosition(screen.getAllByRole("article")[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the original bilingual direction description, FABE, keywords and addressed pain point visible", () => {
    render(<SellingPointDirectionDetails point={point} />);
    expect(screen.getByText(point.description)).toBeInTheDocument();
    expect(screen.getByText(point.descriptionZh)).toBeInTheDocument();
    expect(screen.getByText("feature:").parentElement).toHaveTextContent("Confirmed connector");
    expect(screen.getByText("benefit:").parentElement).toHaveTextContent("Less assembly effort");
    expect(screen.getByText(point.targetKeywords[0])).toBeInTheDocument();
    expect(screen.getByText(`针对: ${point.addressesGap}`)).toBeInTheDocument();
  });
});
