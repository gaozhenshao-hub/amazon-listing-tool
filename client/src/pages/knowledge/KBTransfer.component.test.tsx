// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: 1, defaultWorkspaceId: 1, role: "super_admin" },
  previewExport: vi.fn(() => ({
    data: {
      totalItems: 5,
      counts: { products: 1, listings: 1, images: 1, skills: 1, videos: 1 },
      declaredAttachmentCandidates: 12,
      completenessRule: "完整包仅在附件可安全读取时生成",
    },
    isLoading: false,
  })),
  exportZip: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  confirmImport: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: mocks.user }),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/knowledge/transfer", vi.fn()],
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ kbSearch: { stats: { invalidate: vi.fn() } }, kbTransfer: { getStage: { fetch: vi.fn() } } }),
    kbSearch: { stats: { useQuery: vi.fn() } },
    kbTransfer: {
      previewExport: { useQuery: mocks.previewExport },
      exportZip: { useMutation: mocks.exportZip },
      confirmImport: { useMutation: mocks.confirmImport },
    },
  },
}));

import KBTransfer from "./KBTransfer";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mocks.user = { id: 1, defaultWorkspaceId: 1, role: "super_admin" };
});

describe("KBTransfer", () => {
  it("renders all product knowledge modules with real preview scope and complete-package warning", () => {
    render(<KBTransfer />);
    expect(screen.getByRole("heading", { name: "知识库流转" })).toBeInTheDocument();
    expect(screen.getByText("待导出 5 条")).toBeInTheDocument();
    expect(screen.getByText("声明附件候选约 12 个")).toBeInTheDocument();
    expect(screen.getByText("完整包不接受静默缺件")).toBeInTheDocument();
    expect(mocks.previewExport).toHaveBeenCalledWith(expect.objectContaining({
      modules: ["products", "listings", "images", "skills", "videos"],
      dateField: "updated_at",
    }), expect.anything());
  });

  it("updates the scoped export query when a module is deselected", () => {
    render(<KBTransfer />);
    fireEvent.click(screen.getByText("视频知识库"));
    expect(mocks.previewExport).toHaveBeenLastCalledWith(expect.objectContaining({
      modules: ["products", "listings", "images", "skills"],
    }), expect.anything());
  });

  it("shows a preflight preview and retains the default safe conflict policy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      stageId: "kbtx_0123456789abcdef0123456789abcdef",
      originalFileName: "product-knowledge-transfer.zip",
      expiresAt: "2026-08-28T00:00:00.000Z",
      packageSha256: "a".repeat(64),
      summary: { itemCount: 2, attachmentCount: 3, totalBytes: 1024 },
      items: [
        { itemRef: "products-000001", module: "products", label: "A", asin: "B000TEST01", contentHash: "b".repeat(64), action: "create" },
        { itemRef: "images-000002", module: "images", label: "B", asin: "B000TEST02", contentHash: "c".repeat(64), action: "conflict", reason: "目标知识库已存在ASIN B000TEST02" },
      ],
    }), { status: 200 })));
    render(<KBTransfer />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["zip-bytes"], "product-knowledge-transfer.zip", { type: "application/zip" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText("导入预览已就绪")).toBeInTheDocument());
    expect(screen.getByText("将新建 1")).toBeInTheDocument();
    expect(screen.getByText("冲突，不导入 1")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "ASIN等业务键冲突" })).toHaveTextContent("安全跳过冲突（默认）");
    expect(screen.getByRole("button", { name: "确认导入 1 条" })).toBeInTheDocument();
  });

  it("shows the workspace-wide shared scope but hides export for non-super-admin users", () => {
    mocks.user = { id: 2, defaultWorkspaceId: 1, role: "ops_specialist" };
    render(<KBTransfer />);
    expect(screen.getByText("导出范围为当前工作空间的全部已确认共享知识，仅超级管理员可预览或导出。")).toBeInTheDocument();
    expect(screen.getByRole("note", { name: "" })).toHaveTextContent("仅超级管理员可导出当前工作空间的完整共享知识包。");
    expect(screen.queryByRole("button", { name: "下载全部共享ZIP知识包" })).not.toBeInTheDocument();
  });
});
