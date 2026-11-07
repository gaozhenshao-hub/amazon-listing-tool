// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
Element.prototype.scrollIntoView = vi.fn();
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: any) => <div>{children}</div>,
}));
const f = vi.hoisted(() => ({ send: vi.fn(), next: vi.fn(), generate: vi.fn(), select: vi.fn() }));
vi.mock("./ResearchLock", () => ({
  useResearchLock: () => ({ locked: false, loading: false }),
  ResearchLockButton: () => null,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      imagePlanning: { get: { invalidate: async () => {} } },
      imageDocument: { get: { invalidate: async () => {} } },
      analysis: { researchLocks: { invalidate: async () => {} } },
    }),
    imagePlanning: {
      versions: { useQuery: () => ({
        data: { revision: 1, versions: [
          { id: "version-a", legacy: true, selected: true, text: "原有主图" },
          { id: "version-b", legacy: false, selected: false, text: "新的主图大纲" },
        ] },
        refetch: async () => {},
      }) },
      generate: { useMutation: () => ({ mutateAsync: f.generate }) },
      useVersion: { useMutation: () => ({ mutateAsync: f.select }) },
      briefing: {
        useQuery: () => ({
          data: { opened: false, messages: [], job: null },
          refetch: async () => {},
        }),
      },
      sendBriefing: { useMutation: () => ({ mutateAsync: f.send }) },
      clearBriefing: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      improveBriefing: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
  },
}));
import ImageBriefingPanel from "./ImageBriefingPanel";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("shows an introduction without running AI on mount or rerender and allows skipping chat", () => {
  const view = render(
    <ImageBriefingPanel projectId={14} onContinue={f.next} />
  );
  expect(screen.getByRole("button", { name: "开始对话" })).toBeEnabled();
  view.rerender(<ImageBriefingPanel projectId={14} onContinue={f.next} />);
  expect(f.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "继续：找参考图" }));
  expect(f.next).toHaveBeenCalledOnce();
  expect(f.send).not.toHaveBeenCalled();
});
it("starts the real opener only after clicking start", async () => {
  render(<ImageBriefingPanel projectId={14} onContinue={f.next} />);
  fireEvent.click(screen.getByRole("button", { name: "开始对话" }));
  await waitFor(() =>
    expect(f.send).toHaveBeenCalledWith({
      projectId: 14,
      message: "",
      opener: true,
    })
  );
});

it("keeps outline versions separate and only switches after clicking use", async () => {
  render(<ImageBriefingPanel projectId={14} onContinue={f.next} />);
  expect(screen.getByText("新的主图大纲")).toBeVisible();
  expect(screen.getByText("使用中")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "一键生成图片大纲" }));
  await waitFor(() => expect(f.generate).toHaveBeenCalledWith({
    projectId: 14, revision: 1, mode: "generate", saveAsVersion: true,
  }));
  expect(f.select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "使用该版本" }));
  await waitFor(() => expect(f.select).toHaveBeenCalledWith({
    projectId: 14, revision: 1, versionId: "version-b",
  }));
});
