// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EmperorAgentLibrary from "./EmperorAgentLibrary";

const controls = vi.hoisted(() => {
  const list = vi.fn(), skills = vi.fn(), models = vi.fn();
  return {
    auth: { loading: false, error: null as Error | null, user: { id: 7, defaultWorkspaceId: 11 as number | null, role: "admin" } as { id: number; defaultWorkspaceId: number | null; role: string } | null },
    permissions: { isLoading: false, canRead: vi.fn(), canEdit: vi.fn() },
    list, skills, models, bridgeMount: vi.fn(), bridgeUnmount: vi.fn(), conversationMount: vi.fn(), conversationUnmount: vi.fn(),
    client: { emperor: { agents: { list: { query: list }, getAvailableSkills: { query: skills }, getAvailableModels: { query: models } } } },
  };
});
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => controls.auth }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => controls.permissions }));
// Only the direct client exists: this page must not read shared useQuery caches.
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: controls.client }) } }));
vi.mock("./AssistantConfigurationBridge", async () => {
  const { useEffect } = await import("react");
  return { default: function Bridge(props: { agentKey: string; scopeKey: string; workspaceId: number; canEdit: boolean }) {
    const { agentKey, scopeKey, workspaceId, canEdit } = props;
    useEffect(() => {
      const snapshot = { agentKey, scopeKey, workspaceId, canEdit };
      controls.bridgeMount(snapshot);
      return () => { controls.bridgeUnmount(snapshot); };
    }, [agentKey, scopeKey, workspaceId, canEdit]);
    return <div data-testid="configuration-bridge" data-agent={props.agentKey} data-scope={props.scopeKey} data-workspace={props.workspaceId} data-can-edit={String(props.canEdit)}>配置插槽</div>;
  } };
});
vi.mock("./AssistantConversationBridge", async () => {
  const { useEffect } = await import("react");
  return { default: function Conversation(props: { agentKey: string; scopeKey: string; workspaceId: number; userId: number; role: string; onDirtyChange?: (dirty: boolean) => void }) {
    const { agentKey, scopeKey, workspaceId, userId, role } = props;
    useEffect(() => {
      const owner = { agentKey, scopeKey, workspaceId, userId, role };
      controls.conversationMount(owner);
      return () => { controls.conversationUnmount(owner); };
    }, [agentKey, scopeKey, workspaceId, userId, role]);
    return <div data-testid="conversation-bridge" data-agent={agentKey} data-user={userId} data-workspace={workspaceId}>
      <button type="button" onClick={() => props.onDirtyChange?.(true)}>模拟未发送草稿</button>
    </div>;
  } };
});

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function workflow(name: string) {
  return { id: 1, slug: "listing.saved", name, status: "active", triggerType: "manual", dagDefinition: { nodes: [], edges: [] } };
}
const queries = () => [controls.list, controls.skills, controls.models];
const refresh = () => screen.getByRole("button", { name: "刷新资源目录" });
async function settled() { await waitFor(() => expect(refresh()).toHaveAttribute("aria-busy", "false")); }
function noBusinessReads() {
  for (const query of queries()) expect(query).not.toHaveBeenCalled();
  expect(controls.bridgeMount).not.toHaveBeenCalled();
  expect(controls.conversationMount).not.toHaveBeenCalled();
  expect(screen.queryByTestId("configuration-bridge")).not.toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  controls.auth = { loading: false, error: null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } };
  controls.permissions.isLoading = false;
  controls.permissions.canRead.mockReset().mockReturnValue(true);
  controls.permissions.canEdit.mockReset().mockReturnValue(true);
  for (const query of queries()) query.mockReset().mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("private conversation slot ownership", () => {
  it("conversation directory revocation immediately unmounts private content without removing configuration", async () => {
    const view = render(<EmperorAgentLibrary />); await settled();
    fireEvent.click(screen.getByRole("button", { name: "模拟未发送草稿" }));
    controls.permissions.canRead.mockImplementation((_module: string, subModule: string) => subModule !== "emperor_conversations");
    view.rerender(<EmperorAgentLibrary />);
    expect(screen.queryByTestId("conversation-bridge")).not.toBeInTheDocument();
    expect(screen.getByTestId("configuration-bridge")).toBeInTheDocument();
    expect(controls.conversationUnmount).toHaveBeenCalledTimes(1);
    expect(controls.bridgeUnmount).not.toHaveBeenCalled();
    expect(screen.getByText(/当前没有私有对话读取权限/)).toBeVisible();
  });
  it("requires confirmation to discard a dirty conversation on Agent switch", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<EmperorAgentLibrary />); await settled();
    fireEvent.click(screen.getByRole("button", { name: "模拟未发送草稿" }));
    fireEvent.click(screen.getByRole("button", { name: /图片策划助手/ }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("conversation-bridge")).toHaveAttribute("data-agent", "listing");
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: /图片策划助手/ }));
    expect(screen.getByTestId("conversation-bridge")).toHaveAttribute("data-agent", "images");
    expect(controls.conversationUnmount).toHaveBeenCalledWith(expect.objectContaining({ agentKey: "listing" }));
  });
  it("identity change clears dirty private content immediately without old-owner confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const view = render(<EmperorAgentLibrary />); await settled();
    fireEvent.click(screen.getByRole("button", { name: "模拟未发送草稿" }));
    controls.auth.user = { id: 8, defaultWorkspaceId: 12, role: "admin" };
    view.rerender(<EmperorAgentLibrary />); await settled();
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByTestId("conversation-bridge")).toHaveAttribute("data-user", "8");
    expect(screen.getByTestId("conversation-bridge")).toHaveAttribute("data-workspace", "12");
    expect(controls.conversationUnmount).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, workspaceId: 11 }));
  });
  it("resource refresh preserves the owned conversation and dirty state", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<EmperorAgentLibrary />); await settled();
    fireEvent.click(screen.getByRole("button", { name: "模拟未发送草稿" }));
    fireEvent.click(refresh()); await settled();
    expect(controls.conversationMount).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /图片策划助手/ }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/对话引用 Skill 不代表执行了业务任务/)).toBeVisible();
  });
});

describe("Agent library authenticated scope admission", () => {
  it.each([
    ["auth pending", () => { controls.auth.loading = true; }],
    ["auth error", () => { controls.auth.error = new Error("private-auth-detail"); }],
    ["no user", () => { controls.auth.user = null; }],
    ["invalid user", () => { controls.auth.user!.id = 0; }],
    ["unsafe user id", () => { controls.auth.user!.id = Number.MAX_SAFE_INTEGER + 1; }],
    ["no workspace", () => { controls.auth.user!.defaultWorkspaceId = null; }],
    ["invalid workspace", () => { controls.auth.user!.defaultWorkspaceId = 0; }],
    ["fractional workspace", () => { controls.auth.user!.defaultWorkspaceId = 1.5; }],
    ["out-of-range workspace", () => { controls.auth.user!.defaultWorkspaceId = 2_147_483_648; }],
    ["missing role", () => { controls.auth.user!.role = ""; }],
    ["permissions pending", () => { controls.permissions.isLoading = true; }],
    ["read denied", () => { controls.permissions.canRead.mockReturnValue(false); }],
  ] as const)("does not mount business readers for %s", (_name, arrange) => {
    arrange();
    render(<EmperorAgentLibrary />);
    noBusinessReads();
    expect(screen.queryByText("private-auth-detail")).not.toBeInTheDocument();
  });

  it.each([
    ["admin", true, true], ["super_admin", true, true], ["admin", false, false],
    ["ops_manager", true, false], ["finance", true, false], ["readonly", true, false],
  ] as const)("keeps edit admission for role=%s / permission=%s explicit", async (role, permission, expected) => {
    controls.auth.user!.role = role;
    controls.permissions.canEdit.mockReturnValue(permission);
    render(<EmperorAgentLibrary />);
    await settled();
    expect(controls.permissions.canRead).toHaveBeenCalledWith("emperor", "emperor_agents");
    if (role === "admin" || role === "super_admin") expect(controls.permissions.canEdit).toHaveBeenCalledWith("emperor", "emperor_agents");
    else expect(controls.permissions.canEdit).not.toHaveBeenCalled();
    expect(screen.getByTestId("configuration-bridge")).toHaveAttribute("data-can-edit", String(expected));
    expect(screen.getByTestId("configuration-bridge")).toHaveAttribute("data-scope", JSON.stringify([7, 11, role, expected]));
  });

  it("fresh-reads all three existing directories with one abort signal and preserves management links", async () => {
    controls.list.mockResolvedValue([workflow("当前工作区编排")]);
    controls.skills.mockResolvedValue([{ slug: "listing.copy", name: "当前发布 Skill" }]);
    controls.models.mockResolvedValue([{ slug: "model", name: "当前模型目录", provider: "provider", modelId: "id", isDefault: false }]);
    render(<EmperorAgentLibrary />);
    await settled();
    const signal = controls.list.mock.calls[0][1].signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    for (const query of queries()) {
      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(undefined, { signal });
    }
    expect(screen.getByText("当前工作区编排")).toBeVisible();
    expect(screen.getByText("当前发布 Skill")).toBeVisible();
    expect(screen.getByText("当前模型目录")).toBeVisible();
    expect(screen.getByRole("link", { name: "原 Agent 编排" })).toHaveAttribute("href", "/emperor/agents");
    expect(screen.getByRole("link", { name: "打开原编排画布" })).toHaveAttribute("href", "/emperor/agents/listing.saved/canvas");
    expect(screen.queryByText("未知，未设置默认值")).not.toBeInTheDocument();
  });
});

describe("Agent library read failures and owned request lifetime", () => {
  it("keeps a failed directory distinct from empty, without displaying raw error details", async () => {
    controls.list.mockRejectedValue(new Error("private-server-error"));
    controls.skills.mockResolvedValue([{ slug: "listing.copy", name: "成功的 Skill" }]);
    render(<EmperorAgentLibrary />);
    await settled();
    expect(screen.getByRole("alert")).toHaveTextContent("编排读取失败");
    expect(screen.getByRole("alert")).toHaveTextContent("未将失败视为空记录");
    expect(screen.queryByText(/没有归入此角色的编排记录/)).not.toBeInTheDocument();
    expect(screen.queryByText("private-server-error")).not.toBeInTheDocument();
    expect(screen.getByText("成功的 Skill")).toBeVisible();
  });

  it("rejects non-array API results instead of describing them as empty", async () => {
    controls.models.mockResolvedValue(null);
    render(<EmperorAgentLibrary />);
    await settled();
    expect(screen.getByRole("alert")).toHaveTextContent("模型读取失败");
    expect(screen.queryByText("当前权限范围内没有可见的启用模型记录。")).not.toBeInTheDocument();
  });

  it("immediately removes previous workspace data and configuration when scope changes", async () => {
    const next = deferred<ReturnType<typeof workflow>[]>();
    controls.list.mockResolvedValueOnce([workflow("旧工作区私有编排")]).mockReturnValueOnce(next.promise);
    const view = render(<EmperorAgentLibrary />);
    await settled();
    expect(screen.getByText("旧工作区私有编排")).toBeVisible();
    const oldSignal = controls.list.mock.calls[0][1].signal;
    controls.auth.user = { id: 7, defaultWorkspaceId: 12, role: "admin" };
    view.rerender(<EmperorAgentLibrary />);
    expect(screen.queryByText("旧工作区私有编排")).not.toBeInTheDocument();
    expect(oldSignal.aborted).toBe(true);
    expect(controls.bridgeUnmount).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 11 }));
    expect(screen.getByTestId("configuration-bridge")).toHaveAttribute("data-workspace", "12");
    await act(async () => { next.resolve([workflow("新工作区编排")]); });
    await settled();
    expect(screen.getByText("新工作区编排")).toBeVisible();
  });

  it("ignores all old scope responses even when the transport resolves after abort", async () => {
    const old = [deferred<unknown[]>(), deferred<unknown[]>(), deferred<unknown[]>()];
    queries().forEach((query, index) => query.mockReturnValueOnce(old[index].promise));
    const view = render(<EmperorAgentLibrary />);
    controls.auth.user = { id: 8, defaultWorkspaceId: 12, role: "admin" };
    controls.list.mockResolvedValue([workflow("新用户数据")]);
    view.rerender(<EmperorAgentLibrary />);
    await settled();
    await act(async () => {
      old[0].resolve([workflow("旧响应不能闪回")]);
      old[1].resolve([{ slug: "listing.old", name: "旧 Skill" }]);
      old[2].resolve([{ slug: "old", name: "旧模型", provider: "old", modelId: "old", isDefault: false }]);
    });
    expect(screen.getByText("新用户数据")).toBeVisible();
    for (const oldText of ["旧响应不能闪回", "旧 Skill", "旧模型"]) expect(screen.queryByText(oldText)).not.toBeInTheDocument();
    for (const query of queries()) expect(query.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it.each(["role", "edit permission"])("remounts configuration and directories when %s changes", async change => {
    controls.list.mockResolvedValueOnce([workflow("旧权限编排")]);
    const view = render(<EmperorAgentLibrary />);
    await settled();
    fireEvent.click(screen.getByRole("button", { name: /图片策划助手/ }));
    expect(screen.getByTestId("configuration-bridge")).toHaveAttribute("data-agent", "images");
    const next = deferred<unknown[]>();
    controls.list.mockReturnValueOnce(next.promise);
    if (change === "role") controls.auth.user = { id: 7, defaultWorkspaceId: 11, role: "ops_manager" };
    else controls.permissions.canEdit.mockReturnValue(false);
    view.rerender(<EmperorAgentLibrary />);
    expect(screen.getByTestId("configuration-bridge")).toHaveAttribute("data-agent", "listing");
    expect(screen.getByTestId("configuration-bridge")).toHaveAttribute("data-can-edit", "false");
    expect(screen.queryByText("旧权限编排")).not.toBeInTheDocument();
    expect(controls.bridgeUnmount).toHaveBeenCalledWith(expect.objectContaining({ agentKey: "images", canEdit: true }));
    await act(async () => { next.resolve([]); });
    await settled();
  });

  it("revoking read permission unmounts both the data and configuration readers immediately", async () => {
    controls.list.mockResolvedValue([workflow("撤权前编排")]);
    const view = render(<EmperorAgentLibrary />);
    await settled();
    controls.permissions.canRead.mockReturnValue(false);
    view.rerender(<EmperorAgentLibrary />);
    expect(screen.getByRole("alert")).toHaveTextContent("没有读取 Agent 库的权限");
    expect(screen.queryByText("撤权前编排")).not.toBeInTheDocument();
    expect(screen.queryByTestId("configuration-bridge")).not.toBeInTheDocument();
    expect(controls.bridgeUnmount).toHaveBeenCalledTimes(1);
    for (const query of queries()) { expect(query).toHaveBeenCalledTimes(1); expect(query.mock.calls[0][1].signal.aborted).toBe(true); }
  });

  it("refreshes from fresh requests, clears old rows and does not turn a failed refresh into empty", async () => {
    controls.list.mockResolvedValueOnce([workflow("刷新前编排")]).mockRejectedValueOnce(new Error("sensitive-refresh-error"));
    render(<EmperorAgentLibrary />);
    await settled();
    fireEvent.click(refresh());
    expect(screen.queryByText("刷新前编排")).not.toBeInTheDocument();
    await settled();
    for (const query of queries()) expect(query).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert")).toHaveTextContent("编排读取失败");
    expect(screen.queryByText(/没有归入此角色的编排记录/)).not.toBeInTheDocument();
    expect(controls.bridgeMount).toHaveBeenCalledTimes(1);
  });

  it("allows a new refresh to cancel a pending generation and accepts only the latest result", async () => {
    const first = deferred<unknown[]>(), second = deferred<unknown[]>();
    controls.list.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValueOnce([workflow("最新刷新结果")]);
    render(<EmperorAgentLibrary />);
    fireEvent.click(refresh());
    expect(controls.list.mock.calls[0][1].signal.aborted).toBe(true);
    fireEvent.click(refresh());
    await settled();
    expect(controls.list.mock.calls[1][1].signal.aborted).toBe(true);
    await act(async () => { first.resolve([workflow("最旧刷新结果")]); second.resolve([workflow("中间刷新结果")]); });
    expect(screen.getByText("最新刷新结果")).toBeVisible();
    expect(screen.queryByText("最旧刷新结果")).not.toBeInTheDocument();
    expect(screen.queryByText("中间刷新结果")).not.toBeInTheDocument();
    for (const query of queries()) expect(query).toHaveBeenCalledTimes(3);
  });

  it("keys configuration by the selected role without rereading the existing resource directories", async () => {
    render(<EmperorAgentLibrary />);
    await settled();
    fireEvent.click(screen.getByRole("button", { name: /图片策划助手/ }));
    expect(screen.getByTestId("configuration-bridge")).toHaveAttribute("data-agent", "images");
    expect(controls.bridgeUnmount).toHaveBeenCalledWith(expect.objectContaining({ agentKey: "listing" }));
    expect(controls.bridgeMount).toHaveBeenCalledTimes(2);
    for (const query of queries()) expect(query).toHaveBeenCalledTimes(1);
  });

  it("aborts owned reads on unmount and ignores later resolution or rejection", async () => {
    const pending = [deferred<unknown[]>(), deferred<unknown[]>(), deferred<unknown[]>()];
    queries().forEach((query, index) => query.mockReturnValueOnce(pending[index].promise));
    const view = render(<EmperorAgentLibrary />);
    view.unmount();
    for (const query of queries()) expect(query.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { pending[0].resolve([workflow("unmounted")]); pending[1].reject(new Error("late")); pending[2].resolve([]); });
    expect(screen.queryByTestId("configuration-bridge")).not.toBeInTheDocument();
    expect(controls.bridgeMount).toHaveBeenCalledTimes(1);
    expect(controls.bridgeUnmount).toHaveBeenCalledTimes(1);
  });
});
