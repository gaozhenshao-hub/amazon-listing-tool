// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, it, expect, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
const f = vi.hoisted(() => ({ save: vi.fn(), switched: vi.fn() }));
vi.mock("@/contexts/ProjectContext", () => ({
  useProject: () => ({ selectedProjectId: 1 }),
}));
vi.mock("@/components/ProjectSelector", () => ({
  default: ({ beforeChange }: any) => (
    <button onClick={async () => f.switched(await beforeChange())}>
      切换项目
    </button>
  ),
}));
vi.mock("./listing/ImageBriefingPanel", () => ({
  default: () => <p>策划对话</p>,
}));
vi.mock("./listing/ImageReferenceStep", async () => {
  const { useEffect } = await import("react");
  return {
    default: function ReferenceMock({ registerSave }: any) {
      useEffect(() => {
        registerSave(f.save);
        return () => registerSave(null);
      }, [registerSave]);
      return <p>参考套图选择</p>;
    },
  };
});
vi.mock("./listing/SuiteDocumentWorkspace", () => ({
  default: ({ production }: any) => <p>{production ? "图片制作工作台" : "模块与图片方案文档"}</p>,
}));
import ImagePlanningPage from "./ImagePlanningPage";
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("使用四步工作流，提示词与制图在独立的第四步", () => {
  render(<ImagePlanningPage />);
  const steps = screen.getByRole("navigation", { name: "图片生成步骤" });
  expect(steps.textContent).toMatch(/图片策划.*找参考图.*套图文档.*AI提示词与图片制作/);
  fireEvent.click(screen.getByRole("button", { name: /3套图文档/ }));
  expect(screen.getByText("模块与图片方案文档")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /4AI提示词与图片制作/ }));
  expect(screen.getByText("图片制作工作台")).toBeInTheDocument();
});
it("切换步骤先保存，保存失败停留原页避免丢失人工选择", async () => {
  f.save.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<ImagePlanningPage />);
  fireEvent.click(screen.getByRole("button", { name: /2找参考图/ }));
  fireEvent.click(screen.getByRole("button", { name: /3套图文档/ }));
  await waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
  expect(screen.getByText("参考套图选择")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /3套图文档/ }));
  await screen.findByText("模块与图片方案文档");
  expect(f.save).toHaveBeenCalledTimes(2);
});

it("切换项目也先等待当前步骤保存，失败时保留当前项目和编辑内容", async () => {
  f.save.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<ImagePlanningPage />);
  fireEvent.click(screen.getByRole("button", { name: /2找参考图/ }));
  fireEvent.click(screen.getByRole("button", { name: "切换项目" }));
  await waitFor(() => expect(f.switched).toHaveBeenCalledWith(false));
  fireEvent.click(screen.getByRole("button", { name: "切换项目" }));
  await waitFor(() => expect(f.switched).toHaveBeenLastCalledWith(true));
  expect(f.save).toHaveBeenCalledTimes(2);
});
