/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: "ops_specialist" as string | null,
  trigger: vi.fn(), testConnection: vi.fn(), save: vi.fn(), refresh: vi.fn(),
  status: { enabled: true, lastSync: null, pendingConflicts: 0, failuresLast24h: 0 },
  config: { peerApiUrl: "https://peer.example.test", peerApiKey: "••••••••", peerSyncEnabled: true, source: "database" },
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: mocks.role === null ? null : { id: 7, role: mocks.role } }) }));
vi.mock("@/lib/trpc", () => ({ trpc: { deploymentConfig: {
  getSyncStatus: { useQuery: () => ({ data: mocks.status, isLoading: false, refetch: mocks.refresh }) },
  triggerSync: { useMutation: () => ({ mutateAsync: mocks.trigger, isPending: false }) },
  getSyncConfig: { useQuery: () => ({ data: mocks.config, isLoading: false, refetch: mocks.refresh }) },
  updateSyncConfig: { useMutation: () => ({ mutate: mocks.save, isPending: false }) },
  testPeerConnection: { useMutation: () => ({ mutateAsync: mocks.testConnection, isPending: false }) },
} } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SyncConfigCard, SyncStatusCard } from "./SyncManagement";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.role = "ops_specialist";
  mocks.status.enabled = true;
  mocks.trigger.mockResolvedValue({ success: true });
  mocks.testConnection.mockResolvedValue({ success: true, message: "Synthetic connection" });
});
afterEach(cleanup);

const cards = () => <><SyncStatusCard /><SyncConfigCard /></>;

describe("sync page administrator action controls", () => {
  it.each([null, "ops_specialist", "ops_manager", "finance"])("keeps role %s read-only without mutation calls", async role => {
    mocks.role = role;
    const user = userEvent.setup({ document });
    render(cards());
    expect(screen.getByText("知识库P2P双向同步")).toBeVisible();
    expect(screen.getByText("从未同步")).toBeVisible();
    for (const name of ["手动同步", "测试连接", "保存配置", "生成随机密钥"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeDisabled();
      await user.click(button);
    }
    expect(screen.getByLabelText("对端API地址")).toBeDisabled();
    expect(screen.getByLabelText("同步密钥")).toBeDisabled();
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(mocks.trigger).not.toHaveBeenCalled();
    expect(mocks.testConnection).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "刷新" }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it.each(["admin", "super_admin"])("preserves %s actions and does not submit the masked key", async role => {
    mocks.role = role;
    const user = userEvent.setup({ document });
    render(cards());
    for (const name of ["手动同步", "测试连接", "保存配置"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeEnabled();
      await user.click(button);
    }
    expect(mocks.trigger).toHaveBeenCalledOnce();
    expect(mocks.testConnection).toHaveBeenCalledOnce();
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.save).toHaveBeenCalledWith({
      peerApiUrl: "https://peer.example.test", peerApiKey: undefined, peerSyncEnabled: true,
    });
  });

  it("relocks already-mounted controls when the current role is no longer admin", async () => {
    mocks.role = "admin";
    const view = render(cards());
    mocks.role = "ops_specialist";
    view.rerender(cards());
    const user = userEvent.setup({ document });
    for (const name of ["手动同步", "测试连接", "保存配置"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeDisabled();
      await user.click(button);
    }
    expect(mocks.trigger).not.toHaveBeenCalled();
    expect(mocks.testConnection).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("does not enable manual synchronization for an admin while synchronization is disabled", () => {
    mocks.role = "admin";
    mocks.status.enabled = false;
    render(cards());
    expect(screen.getByRole("button", { name: "手动同步" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存配置" })).toBeEnabled();
  });
});
