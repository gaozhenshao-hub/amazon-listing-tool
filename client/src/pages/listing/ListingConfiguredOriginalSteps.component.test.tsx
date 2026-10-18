// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StepTitle from "./StepTitle";
import StepDescription from "./StepDescription";
import StepSearchTerms from "./StepSearchTerms";
import StepQA from "./StepQA";
import { ListingConfiguredGenerationProvider, useListingConfiguredGeneration } from "./ListingConfiguredGenerationContext";
const m = vi.hoisted(() => ({ mutate: vi.fn(), start: vi.fn(), get: vi.fn(), history: vi.fn(), complete: vi.fn(), lock: vi.fn(), toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 3, defaultWorkspaceId: 7, role: "admin" }, loading: false, error: null }) }));
vi.mock("sonner", () => ({ toast: m.toast }));
vi.mock("@/components/ChecklistPanel", () => ({ default: () => null }));
vi.mock("@/components/LockedContentBar", () => ({ default: () => null }));
vi.mock("@/lib/trpc", () => {
  const listing = new Proxy({}, { get: (_, key: string) => ({ useMutation: () => ({ mutate: m.mutate, mutateAsync: key === "startGenerationJob" ? m.start : m.mutate, isPending: false }) }) });
  const client = { listing: { getGenerationRun: { query: m.get }, listGenerationRuns: { query: m.history } } };
  return { trpc: { listing, useUtils: () => ({ client }) } };
});
const props = { projectId: 8, emphasis: "", onComplete: m.complete, onLock: m.lock };
function Fixture({ children, outputs }: { children: ReactNode; outputs: Record<string, unknown> }) {
  const bridge = useListingConfiguredGeneration()!;
  return <><button onClick={() => bridge.setEnabled(true)}>Enter new lane</button><button onClick={() => bridge.deliver(outputs, bridge.capture())}>Explicit validated apply</button><button onClick={() => bridge.setEnabled(false)}>Return old lane</button>{children}</>;
}
function mount(children: ReactNode, outputs: Record<string, unknown>) { render(<ListingConfiguredGenerationProvider><Fixture outputs={outputs}>{children}</Fixture></ListingConfiguredGenerationProvider>); fireEvent.click(screen.getByText("Enter new lane")); fireEvent.click(screen.getByText("Explicit validated apply")); }
beforeEach(() => { vi.clearAllMocks(); m.get.mockResolvedValue(null); m.history.mockResolvedValue([]); }); afterEach(cleanup);
describe("configured candidates use original editors without hidden paid follow-up", () => {
  it("restores all title candidates to the original two-layer editor without picking or locking one", async () => {
    mount(<StepTitle {...props} />, { title: { titles: [{ title: "SYNTHETIC title A", itemHighlights: "layer A" }, { title: "SYNTHETIC title B", itemHighlights: "layer B", strategy: "retained strategy" }] } });
    expect(await screen.findByText("SYNTHETIC title A")).toBeInTheDocument(); expect(screen.getByText("SYNTHETIC title B")).toBeInTheDocument();
    expect(m.mutate).not.toHaveBeenCalled(); expect(m.lock).not.toHaveBeenCalled(); expect(m.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Return old lane")); expect(m.mutate).not.toHaveBeenCalled();
  });
  it("places full description in the existing sanitized preview/editor without implicit checklist", async () => {
    mount(<StepDescription {...props} />, { description: { description: "<p>SYNTHETIC full human-review description</p>" } });
    await waitFor(() => expect(screen.getByText("SYNTHETIC full human-review description")).toBeInTheDocument()); expect(m.mutate).not.toHaveBeenCalled(); expect(m.lock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("源码")); expect(screen.getByDisplayValue("<p>SYNTHETIC full human-review description</p>")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Return old lane")); expect(m.mutate).not.toHaveBeenCalled();
  });
  it("places search terms and category metadata in the existing editable workflow", async () => {
    mount(<StepSearchTerms {...props} />, { searchTerms: { searchTerms: "SYNTHETIC complete terms", categories: [{ category: "完整分组", keywords: ["SYNTHETIC term"] }] } });
    expect(await screen.findByDisplayValue("SYNTHETIC complete terms")).toBeInTheDocument(); expect(m.mutate).not.toHaveBeenCalled(); expect(m.complete).not.toHaveBeenCalled();
  });
  it("preserves every QA item and original manual confirmation instead of raw JSON", async () => {
    mount(<StepQA {...props} />, { qa: { qaItems: [{ question: "SYNTHETIC first question?", answer: "First complete answer", sourceInsight: "First reviewed source" }, { question: "SYNTHETIC last question?", answer: "Last complete answer", sourceInsight: "Last reviewed source" }] } });
    expect(await screen.findByText("Q: SYNTHETIC first question?")).toBeInTheDocument(); expect(screen.getByText("Q: SYNTHETIC last question?")).toBeInTheDocument(); expect(screen.getByText("A: Last complete answer")).toBeInTheDocument(); expect(m.mutate).not.toHaveBeenCalled(); expect(m.complete).not.toHaveBeenCalled();
  });
});
