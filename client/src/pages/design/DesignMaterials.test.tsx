// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const f = vi.hoisted(() => ({
  save: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ canEdit: () => true, canDelete: () => true }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      designMaterials: {
        invalidate: f.refresh,
        projects: { invalidate: f.refresh },
      },
    }),
    designMaterials: {
      projects: {
        useQuery: () => ({
          data: [
            { id: "my-project", name: "我的产品", fileCount: 2, bytes: 1024 },
          ],
          isLoading: false,
        }),
      },
      list: { useQuery: f.list },
      saveGenerated: {
        useMutation: () => ({ mutateAsync: f.save, isPending: false }),
      },
      saveProject: {
        useMutation: () => ({ mutateAsync: f.create, isPending: false }),
      },
      rename: { useMutation: () => ({}) },
      trash: { useMutation: () => ({}) },
    },
  },
}));
import DesignMaterials, { SaveMaterialDialog } from "./DesignMaterials";
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  f.list.mockReturnValue({ data: { items: [], hasMore: false } });
  f.save.mockResolvedValue({ id: "saved", duplicate: false });
  f.refresh.mockResolvedValue(undefined);
});
it("opens private projects first without silently reading or uploading to the public library", () => {
  render(<DesignMaterials />);
  expect(
    screen
      .getByRole("button", { name: /项目素材/ })
      .getAttribute("aria-pressed")
  ).toBe("true");
  expect(f.list).toHaveBeenLastCalledWith(expect.anything(), {
    enabled: false,
  });
  expect(screen.queryByRole("button", { name: "上传素材" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /我的产品.*份素材/ }));
  expect(f.list).toHaveBeenLastCalledWith(
    expect.objectContaining({ projectId: "my-project" }),
    { enabled: true }
  );
  expect(screen.getByRole("button", { name: "上传素材" })).toBeTruthy();
});
it("requires an explicit target before saving a generated image publicly", async () => {
  const source = {
      generationId: "generation",
      assetId: "asset",
      name: "作品.png",
    },
    close = vi.fn();
  render(<SaveMaterialDialog source={source} onClose={close} />);
  expect(
    (screen.getByRole("button", { name: "保存素材" }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "public" },
  });
  expect(screen.getByText(/此图片将共享给美工团队/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "保存素材" }));
  await waitFor(() =>
    expect(f.save).toHaveBeenCalledWith({ ...source, projectId: null })
  );
  expect(close).toHaveBeenCalled();
});
it("can save a generated result to a newly created private project", async () => {
  f.create.mockResolvedValue({ id: "created-project" });
  render(
    <SaveMaterialDialog
      source={{
        generationId: "generation",
        assetId: "asset",
        name: "作品.png",
      }}
      onClose={vi.fn()}
    />
  );
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "new" } });
  fireEvent.change(screen.getByLabelText("新项目名称"), {
    target: { value: "养蜂服" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存素材" }));
  await waitFor(() =>
    expect(f.save).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "created-project" })
    )
  );
});
