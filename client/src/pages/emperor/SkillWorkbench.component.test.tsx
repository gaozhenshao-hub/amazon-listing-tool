// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillWorkbenchDraft } from "@shared/skillWorkbench";

const mocks = vi.hoisted(() => ({
  route: "workbench=review",
  navigate: vi.fn(),
  api: {
    detail: { query: vi.fn() },
    products: { query: vi.fn() },
    catalog: { query: vi.fn() },
    save: { mutate: vi.fn() },
    run: { mutate: vi.fn() },
    approve: { mutate: vi.fn() },
    publish: { mutate: vi.fn() },
    create: { mutate: vi.fn() },
    newSkill: { mutate: vi.fn() },
  },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ client: { emperor: { skillWorkbench: mocks.api } } }),
  },
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, defaultWorkspaceId: 7, role: "admin" },
    loading: false,
  }),
}));
vi.mock("wouter", () => ({
  useSearch: () => mocks.route,
  useLocation: () => ["/emperor/skills", mocks.navigate],
}));
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: string }) => <div>{children}</div>,
}));
import SkillWorkbench from "./SkillWorkbench";

const initial: SkillWorkbenchDraft = {
  id: "id",
  revision: 1,
  baseHash: "base",
  baseVersion: 2,
  skillSlug: "review",
  name: "评论分析",
  content: { systemPrompt: "引用原文", userPromptTemplate: "{{context}}" },
  input: { context: "真实评论样本", productId: null },
  tests: [],
  feedback: [],
  status: "draft",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.route = "workbench=review";
  mocks.api.detail.query.mockResolvedValue({
    skill: { name: "评论分析", slug: "review", version: 2, status: "Released" },
    drafts: [structuredClone(initial)],
    versions: [],
  });
  mocks.api.products.query.mockResolvedValue([
    { id: 8, asin: "B000000001", title: "产品一", projectName: "项目一" },
  ]);
  mocks.api.save.mutate.mockImplementation(async value => ({
    ...initial,
    ...value,
    revision: 2,
  }));
  mocks.api.run.mutate.mockResolvedValue({ ...initial, revision: 3 });
});
afterEach(cleanup);
describe("Skill workbench business interaction", () => {
  it("keeps formal data untouched while saving changed input before testing", async () => {
    render(<SkillWorkbench />);
    await screen.findByRole("button", { name: "测试草稿" });
    fireEvent.change(screen.getByPlaceholderText(/粘贴上一阶段/), {
      target: { value: "补充的评论内容" },
    });
    fireEvent.click(screen.getByRole("button", { name: "测试草稿" }));
    await waitFor(() => expect(mocks.api.run.mutate).toHaveBeenCalledOnce());
    expect(mocks.api.save.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        revision: 1,
        input: { context: "补充的评论内容", productId: null },
      })
    );
    expect(mocks.api.run.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        revision: 2,
        baseline: false,
        expectedWorkspaceId: 7,
      })
    );
    expect(mocks.api.publish.mutate).not.toHaveBeenCalled();
  });
  it("keeps unsaved method changes when tabs change and refuses a test after a save conflict", async () => {
    mocks.api.save.mutate.mockRejectedValue(new Error("其他窗口已修改"));
    render(<SkillWorkbench />);
    await screen.findByRole("button", { name: "测试草稿" });
    fireEvent.click(screen.getByRole("tab", { name: "技能内容" }));
    fireEvent.change(screen.getByRole("textbox", { name: "技能方法" }), {
      target: { value: "新方法" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "试用与调教" }));
    fireEvent.click(screen.getByRole("button", { name: "测试草稿" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "其他窗口已修改"
    );
    expect(mocks.api.run.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "技能内容" }));
    expect(screen.getByRole("textbox", { name: "技能方法" })).toHaveValue(
      "新方法"
    );
  });
  it("does not discard a saved draft when the product catalog fails", async () => {
    mocks.api.products.query.mockRejectedValue(new Error("offline"));
    render(<SkillWorkbench />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "可以先粘贴资料测试"
    );
    expect(screen.getByPlaceholderText(/粘贴上一阶段/)).toHaveValue(
      "真实评论样本"
    );
  });
});
