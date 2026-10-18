// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StepTitle from "./StepTitle";
import StepDescription from "./StepDescription";
import StepSearchTerms from "./StepSearchTerms";
import StepQA from "./StepQA";
import { ListingConfiguredGenerationProvider, useListingConfiguredGeneration } from "./ListingConfiguredGenerationContext";
import { ListingAuxiliaryProvider, useListingAuxiliary, type AuxiliaryBinding } from "./ListingAuxiliaryContext";
import { listingAuxiliaryDraftHash, listingAuxiliaryTargets, ListingAuxiliaryPreviewInputSchema } from "@shared/listingAuxiliaryWorkflow";
const m = vi.hoisted(() => ({ mutate: vi.fn(), start: vi.fn(), get: vi.fn(), history: vi.fn(), complete: vi.fn(), lock: vi.fn(), toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 3, defaultWorkspaceId: 7, role: "admin" }, loading: false, error: null }) }));
vi.mock("sonner", () => ({ toast: m.toast }));
vi.mock("@/components/LockedContentBar", () => ({ default: () => null }));
vi.mock("@/lib/trpc", () => {
  const listing = new Proxy({}, { get: (_, key: string) => ({ useMutation: () => ({ mutate: m.mutate, mutateAsync: key === "startGenerationJob" ? m.start : m.mutate, isPending: false }) }) });
  const client = { listing: { getGenerationRun: { query: m.get }, listGenerationRuns: { query: m.history } } };
  return { trpc: { listing, useUtils: () => ({ client }) } };
});
const props = { projectId: 8, emphasis: "", onComplete: m.complete, onLock: m.lock };
function Fixture({ children, outputs }: { children: ReactNode; outputs: Record<string, unknown> }) {
  const main = useListingConfiguredGeneration()!, aux = useListingAuxiliary()!, captured = useRef<AuxiliaryBinding | null>(null);
  return <><button onClick={() => { main.setEnabled(true); main.setSourceSelection({ analysisIds: [10], coreRevisionIds: [] }); }}>Enter new lane</button><button onClick={() => main.deliver(outputs, main.capture())}>Apply generated draft</button>
    <output data-testid="intent">{JSON.stringify(aux.intent)}</output><button onClick={() => { captured.current = aux.capture(); }}>Capture request</button><button onClick={() => {
      const request = ListingAuxiliaryPreviewInputSchema.parse({ ...aux.intent, expectedWorkspaceId: 7, projectId: 8, operationId: "11111111-1111-4111-8111-111111111111" });
      aux.deliver({ version: 1, operation: request.operation, sourceHash: "a".repeat(64), draftHash: listingAuxiliaryDraftHash(request), requiresHumanReview: true, targets: listingAuxiliaryTargets(request).map(item => ({ targetIndex: item.targetIndex, targetHash: item.targetHash, result: { checkListScores: { coreKeyword: { pass: false, notes: "FULL NOTE", reason: "FULL REASON", suggestion: "FULL SUGGESTION", evidenceQuote: "FULL EVIDENCE", suggestedRevision: "ONLY A SUGGESTION" } } } })) }, captured.current);
    }}>Apply reviewed report</button>{children}</>;
}
function mount(children: ReactNode, outputs: Record<string, unknown>) { render(<ListingConfiguredGenerationProvider><ListingAuxiliaryProvider><Fixture outputs={outputs}>{children}</Fixture></ListingAuxiliaryProvider></ListingConfiguredGenerationProvider>); fireEvent.click(screen.getByText("Enter new lane")); fireEvent.click(screen.getByText("Apply generated draft")); }
const intent = () => JSON.parse(screen.getByTestId("intent").textContent!);
beforeEach(() => { vi.clearAllMocks(); m.get.mockResolvedValue(null); m.history.mockResolvedValue([]); }); afterEach(cleanup);
describe("original four steps prepare exact auxiliary drafts", () => {
  it("checks selected unsaved two-layer title, not first candidate or saved title", () => {
    mount(<StepTitle {...props} />, { title: { titles: [{ title: "SYNTHETIC A", itemHighlights: "first" }, { title: "SYNTHETIC B", itemHighlights: "second" }] } });
    fireEvent.click(screen.getByText("SYNTHETIC B")); fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByPlaceholderText("Brand + Core Keyword + Differentiator (≤75 chars)"), { target: { value: "MY CURRENT TITLE" } });
    fireEvent.change(screen.getByPlaceholderText("Specs + Use Cases + Secondary Keywords (≤125 chars)"), { target: { value: "MY CURRENT HIGHLIGHTS" } });
    fireEvent.click(screen.getByRole("button", { name: /Check List 10维度自检/ }));
    expect(intent()).toEqual({ operation: "checkTitle", analysisIds: [10], payload: { title: "MY CURRENT TITLE", itemHighlights: "MY CURRENT HIGHLIGHTS" } }); expect(m.mutate).not.toHaveBeenCalled(); expect(m.start).not.toHaveBeenCalled();
  });
  it("checks full edited description and never saves free JSON scores", () => {
    mount(<StepDescription {...props} />, { description: { description: "<p>INITIAL</p>" } }); fireEvent.click(screen.getByRole("button", { name: "源码" })); fireEvent.change(screen.getByDisplayValue("<p>INITIAL</p>"), { target: { value: "<p>FULL UNSAVED DESCRIPTION</p>" } });
    fireEvent.click(screen.getByRole("button", { name: /Check List 8维度自检/ })); expect(intent().payload).toEqual({ description: "<p>FULL UNSAVED DESCRIPTION</p>" }); expect(m.mutate).not.toHaveBeenCalled();
  });
  it("search checks the complete supplied title/bullets and labels saved-title limitation", () => {
    const bullets = Array.from({ length: 9 }, (_, i) => ({ subtitle: `S${i}`, fullText: `COMPLETE LOCAL ${i}` }));
    mount(<StepSearchTerms {...props} checkContext={{ title: "SAVED TITLE", bulletPoints: bullets, basis: "已保存标题，不含其他步骤未保存候选", ready: true }} />, { searchTerms: { searchTerms: "INITIAL terms" } });
    fireEvent.change(screen.getByDisplayValue("INITIAL terms"), { target: { value: "UNSAVED search terms" } }); fireEvent.click(screen.getByRole("button", { name: /Check List 5维度自检/ }));
    expect(intent().payload).toEqual({ searchTerms: "UNSAVED search terms", title: "SAVED TITLE", bulletPoints: bullets }); expect(screen.getByText(/已保存标题，不含其他步骤未保存候选/)).toBeInTheDocument(); expect(m.mutate).not.toHaveBeenCalled();
  });
  it("invalid cross-step search context does not prepare an incomplete check", () => {
    mount(<StepSearchTerms {...props} checkContext={{ title: "", bulletPoints: [], basis: "missing", ready: false }} />, { searchTerms: { searchTerms: "INITIAL terms" } }); fireEvent.click(screen.getByRole("button", { name: /Check List 5维度自检/ })); expect(intent()).toBeNull(); expect(m.mutate).not.toHaveBeenCalled();
  });
  it("QA checks full ordered items plus current unsaved addition without coercing priorities", () => {
    mount(<StepQA {...props} />, { qa: { qaItems: [{ question: "First?", answer: "Full first", priority: 1 }, { question: "Last?", answer: "Full last", priority: "high", sourceInsight: "RESEARCH, NOT FACT" }] } });
    fireEvent.click(screen.getByRole("button", { name: "新增QA" })); fireEvent.change(screen.getByPlaceholderText("输入问题 (Question)..."), { target: { value: "UNSAVED NEW?" } }); fireEvent.change(screen.getByPlaceholderText("输入回答 (Answer)..."), { target: { value: "UNSAVED ANSWER" } }); fireEvent.click(screen.getByRole("button", { name: /Check List 8维度自检/ }));
    expect(intent().payload.items).toEqual([{ question: "First?", answer: "Full first", priority: 1, category: "", sourceInsight: "" }, { question: "Last?", answer: "Full last", priority: "high", category: "", sourceInsight: "RESEARCH, NOT FACT" }, { question: "UNSAVED NEW?", answer: "UNSAVED ANSWER", category: "custom", priority: 3, sourceInsight: "手动添加（未保存稿）" }]); expect(m.mutate).not.toHaveBeenCalled(); expect(m.complete).not.toHaveBeenCalled();
  });
  it("a later edit cannot receive the original request's score or confirmation", () => {
    mount(<StepSearchTerms {...props} />, { searchTerms: { searchTerms: "INITIAL terms" } }); fireEvent.click(screen.getByRole("button", { name: /Check List 5维度自检/ })); fireEvent.click(screen.getByText("Capture request")); fireEvent.change(screen.getByDisplayValue("INITIAL terms"), { target: { value: "CHANGED AFTER REQUEST" } }); fireEvent.click(screen.getByText("Apply reviewed report"));
    expect(screen.queryByText("FULL REASON")).not.toBeInTheDocument(); expect(screen.getByDisplayValue("CHANGED AFTER REQUEST")).toBeInTheDocument(); expect(m.mutate).not.toHaveBeenCalled(); expect(m.lock).not.toHaveBeenCalled();
  });
});
