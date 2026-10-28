vi.mock("@/_core/hooks/useAuth",()=>({useAuth:()=>({user:{role:"operator"}})}));
// @vitest-environment jsdom
import { afterEach, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const state = vi.hoisted(() => ({ data: null as any }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      kbVideos: { get: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } },
    }),
    kbVideos: {
      get: { useQuery: () => ({ data: state.data, isLoading: false }) },
      save: { useMutation: () => ({ mutate: vi.fn() }) },
      runTags: { useMutation: () => ({ mutate: vi.fn() }) },
      improve: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));
vi.mock("./KnowledgeVideoPlayer", () => ({
  default: ({ seek }: { seek?: { seconds: number } }) => (
    <output data-testid="seek">{seek?.seconds ?? "none"}</output>
  ),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));
vi.mock("@/components/ai/AiResultActions", () => ({
  AiResultActions: () => null,
}));
import KnowledgeVideoDetail from "./KnowledgeVideoDetail";
afterEach(cleanup);
it("seeks a selected content label after a cached untagged record refreshes", () => {
  state.data = {
    id: 8,
    title: "压面器",
    video: { role: null },
    labels: null,
    labelStatus: "failed",
    canEdit: false,
  };
  const { rerender } = render(
    <KnowledgeVideoDetail id={8} initialLabel="安装上手" onClose={() => {}} />
  );
  expect(screen.getByTestId("seek").textContent).toBe("none");
  state.data = {
    ...state.data,
    labelStatus: "complete",
    labels: {
      type: "产品展示（侧重安操）",
      summary: "安装演示",
      segments: [
        { label: "安装上手", start: 9, end: 13, description: "安装支架" },
      ],
    },
  };
  rerender(
    <KnowledgeVideoDetail id={8} initialLabel="安装上手" onClose={() => {}} />
  );
  expect(screen.getByTestId("seek").textContent).toBe("9");
  expect(screen.getByRole("button", { name: /安装上手\s*0:09/ })).toBeTruthy();
});
