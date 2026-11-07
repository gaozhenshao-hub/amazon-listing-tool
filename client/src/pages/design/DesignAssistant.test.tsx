// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import DesignAssistant from "./DesignAssistant";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  chat: vi.fn(),
  generate: vi.fn(),
  invalidate: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      designStudio: {
        history: { invalidate: mocks.invalidate },
        conversations: { invalidate: mocks.invalidate },
      },
    }),
    designStudio: {
      conversations: { useQuery: () => ({ data: { items: [] } }) },
      history: { useQuery: () => ({ data: { items: [], chats: [] } }) },
      create: { useMutation: () => ({ mutateAsync: mocks.create }) },
      chat: { useMutation: () => ({ mutateAsync: mocks.chat }) },
      generate: { useMutation: () => ({ mutateAsync: mocks.generate }) },
      check: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      sceneImprovement: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toast } }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({});
  mocks.chat.mockResolvedValue({});
  mocks.invalidate.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("only shows chat controls in pure conversation", () => {
  render(<DesignAssistant mode="chat" />);
  expect(screen.getByText("美工 AI 对话")).toBeTruthy();
  expect(screen.queryByLabelText("产品主体")).toBeNull();
  expect(screen.queryByText("确认并生成")).toBeNull();
});

it("requires all reference roles and submits their original order", async () => {
  let index = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        id: `00000000-0000-4000-8000-00000000000${++index}`,
        name: `图片${index}`,
        bytes: 1,
      }),
    }))
  );
  render(<DesignAssistant mode="scene" />);
  fireEvent.change(screen.getByPlaceholderText(/描述希望呈现/), {
    target: { value: "摆放在客厅" },
  });
  fireEvent.click(screen.getByRole("button", { name: "策划场景图" }));
  expect(mocks.toast).toHaveBeenCalledWith("请上传三组参考图");
  for (const group of ["产品主体", "构图参考", "效果图参考"]) {
    fireEvent.change(screen.getByLabelText(group), {
      target: {
        files: [new File(["x"], `${group}.png`, { type: "image/png" })],
      },
    });
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(index));
  }
  fireEvent.click(screen.getByRole("button", { name: "策划场景图" }));
  await waitFor(() => expect(mocks.chat).toHaveBeenCalledOnce());
  const sent = mocks.chat.mock.calls[0][0];
  expect(sent.references).toEqual([
    sent.scene.products[0],
    sent.scene.composition,
    sent.scene.effect,
  ]);
  expect(sent.referenceMode).toBe("replace");
});
