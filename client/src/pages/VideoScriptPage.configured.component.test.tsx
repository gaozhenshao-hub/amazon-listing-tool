// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VideoScriptPage from "./VideoScriptPage";
const state = vi.hoisted(() => ({ stage: "stage_0a", controls: vi.fn(), mutation: vi.fn(), refetch: vi.fn(), query: vi.fn(), navigate: vi.fn() }));
vi.mock("wouter", () => ({ useRoute: () => [true, { id: "9" }], useLocation: () => ["/listing/video-script/9", state.navigate] }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 3, defaultWorkspaceId: 7, role: "super_admin" }, loading: false, error: null }) }));
vi.mock("@/components/workflow", () => ({ AiJobHistoryPanel: () => <div>LEGACY HISTORY</div>, BusinessArtifactVersionPicker: () => <div>ORIGINAL VERSIONS</div>, EmbeddedAgentRunPanel: () => <div>ORIGINAL RUN PANEL</div>, WorkflowStepProgress: () => <div>ORIGINAL SIX STAGES</div> }));
vi.mock("./video/VideoWorkflowControls", () => ({ default: (props: { operation: string; onApplied: () => Promise<void> }) => { state.controls(props); return <button onClick={() => void props.onApplied()}>GOVERNED {props.operation}</button>; } }));
vi.mock("@/lib/trpc", () => { const procedure = (name: string) => ({ useQuery: (input: unknown) => { state.query(name, input); const data = name === "getById" ? { id: 9, projectId: 8, scriptName: "SYNTHETIC ORIGINAL VIDEO", videoType: "main_video", targetDuration: 60, currentStage: state.stage, stageStatus: {}, version: 2 }
    : name === "getCompetitorScripts" ? [{ id: 44, competitorName: "SYNTHETIC COMPETITOR", inputType: "excel_upload", rawContent: "Original full script", analysisResult: null }]
      : ["getProductSnapshot", "getCompetitorSummary"].includes(name) ? null : [];
    return { data, isLoading: false, refetch: state.refetch }; }, useMutation: () => ({ mutate: state.mutation, isPending: false }) });
  return { trpc: { videoScript: new Proxy({}, { get: (_target, key) => procedure(String(key)) }), aiJobs: new Proxy({}, { get: (_target, key) => procedure(`aiJobs.${String(key)}`) }) } }; });
beforeEach(() => { vi.clearAllMocks(); state.stage = "stage_0a"; });
afterEach(cleanup);
describe("governed controls inside the original six-stage video page", () => {
  it.each([
    ["stage_0a", ["competitor_analysis", "competitor_summary"]], ["stage_0b", ["product_info"]], ["stage_1", ["sections"]], ["stage_2", ["subtopics"]], ["stage_3", ["shots"]], ["stage_4", ["edit_scripts"]],
  ] as const)("keeps the original %s page and embeds exact operation scope without generation on mount", (stage, operations) => {
    state.stage = stage; render(<VideoScriptPage />); expect(screen.getByRole("heading", { name: "SYNTHETIC ORIGINAL VIDEO" })).toBeInTheDocument();
    expect(screen.getByText("ORIGINAL SIX STAGES")).toBeInTheDocument(); expect(screen.getByRole("button", { name: "版本" })).toBeInTheDocument(); expect(screen.getByRole("button", { name: "导出Excel" })).toBeInTheDocument();
    expect(new Set(state.controls.mock.calls.map(([props]) => props.operation))).toEqual(new Set(operations));
    for (const [props] of state.controls.mock.calls) { expect(props).toMatchObject({ projectId: 8, videoScriptId: 9 }); if (props.operation === "competitor_analysis") expect(props.competitorScriptId).toBe(44); }
    expect(screen.getAllByText("旧协议兼容入口").length).toBeGreaterThan(0); expect(state.mutation).not.toHaveBeenCalled();
  });
  it("explicit candidate application refreshes the original stage reader, not legacy generation", async () => { state.stage = "stage_1"; render(<VideoScriptPage />); fireEvent.click(screen.getByRole("button", { name: "GOVERNED sections" })); await waitFor(() => expect(state.refetch).toHaveBeenCalledTimes(1)); expect(state.mutation).not.toHaveBeenCalled(); });
  it("the original human stage confirmation remains a separate action", () => { state.stage = "stage_1"; render(<VideoScriptPage />); const confirm = screen.getByRole("button", { name: "确认本阶段" }); fireEvent.click(confirm); expect(state.mutation).toHaveBeenCalledWith({ videoScriptId: 9, stage: "stage_1" }); });
});
