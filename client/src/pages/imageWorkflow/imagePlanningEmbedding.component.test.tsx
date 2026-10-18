// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Step2ImageOutline } from "./ImageOutlineStep";
const state = vi.hoisted(() => ({ generate: vi.fn(), mutate: vi.fn(), invalidate: vi.fn(), props: null as null | { onApplyPendingChange(value: boolean): void; onApplied(candidate?: unknown): Promise<void> } }));
vi.mock("./ImagePlanningWorkflow", () => ({ default: (props: typeof state.props) => { state.props = props; return <div>Configured Step2 explicit controls</div>; } }));
vi.mock("./useImageStepGenerationJob", () => ({ useImageStepGenerationJob: () => ({ start: state.generate, run: null, isGenerating: false, isCanceling: false, cancel: vi.fn() }), ImageStepGenerationStatus: () => null }));
vi.mock("@/lib/trpc", () => ({ trpc: { imageWorkflow: Object.fromEntries(["confirmStep2", "unlockStep2", "optimizeStep2AplusModule", "lockStep2AplusSubmodule", "saveStep2Draft"].map(name => [name, { useMutation: () => ({ mutateAsync: state.mutate, isPending: false }) }])), useUtils: () => ({ imageWorkflow: { getSession: { invalidate: state.invalidate } } }) } }));
const draft = { mainImage: { purpose: "SYNTHETIC original purpose", contentBrief: "SYNTHETIC original content" },
  secondaryImages: Array.from({ length: 6 }, (_, index) => ({ imageNumber: index + 2, purpose: `副图目的${index}`, contentBrief: `副图内容${index}` })),
  aPlusModules: Array.from({ length: 7 }, (_, index) => ({ moduleNumber: index + 1, purpose: `模块目的${index}`, contentBrief: `模块内容${index}` })),
  brandStory: { theme: "brand", contentBrief: "story" } };
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("configured execution inside the unchanged full outline editor", () => {
  it("temporarily disables original editing/confirmation/legacy generation while apply is unresolved, then restores the same draft", async () => {
    render(<Step2ImageOutline projectId={8} session={{ id: 9, step2UserEdit: JSON.stringify(draft), step2Confirmed: 0 }} onConfirm={vi.fn()} />);
    const field = screen.getByDisplayValue("SYNTHETIC original purpose"); expect(field).toBeEnabled();
    await act(async () => state.props?.onApplyPendingChange(true)); expect(field).toBeDisabled(); expect(screen.getByRole("button", { name: "确认大纲" })).toBeDisabled(); expect(screen.getByRole("button", { name: "重新生成" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重新生成" })); expect(state.generate).not.toHaveBeenCalled(); expect(state.mutate).not.toHaveBeenCalled();
    await act(async () => state.props?.onApplyPendingChange(false)); expect(field).toBeEnabled(); expect(field).toHaveValue("SYNTHETIC original purpose");
  });
  it("verified application populates the existing full draft without triggering any confirmation/model/save mutation", async () => {
    render(<Step2ImageOutline projectId={8} session={{ id: 9, step2UserEdit: JSON.stringify(draft), step2Confirmed: 0 }} onConfirm={vi.fn()} />);
    await act(async () => state.props?.onApplied({ ...draft, mainImage: { purpose: "SYNTHETIC new candidate", contentBrief: "complete" } }));
    expect(screen.getByDisplayValue("SYNTHETIC new candidate")).toBeInTheDocument(); expect(state.invalidate).toHaveBeenCalledWith({ projectId: 8 }); expect(state.generate).not.toHaveBeenCalled(); expect(state.mutate).not.toHaveBeenCalled();
  });
});
