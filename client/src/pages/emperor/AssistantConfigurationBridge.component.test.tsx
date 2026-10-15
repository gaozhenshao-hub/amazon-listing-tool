// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AssistantConfiguration, AssistantConfigurationHistory, AssistantConfigurationMetadata,
  AssistantConfigurationOptions, AssistantConfigurationRecord,
} from "@shared/assistantConfigurations";
import type { AssistantConfigurationPanelProps } from "./AssistantConfigurationPanel";
import AssistantConfigurationBridge from "./AssistantConfigurationBridge";

const mocks = vi.hoisted(() => {
  const api = {
    listMetadata: { query: vi.fn() }, get: { query: vi.fn() }, options: { query: vi.fn() },
    history: { query: vi.fn() }, getVersion: { query: vi.fn() }, save: { mutate: vi.fn() }, rollback: { mutate: vi.fn() },
  };
  return { api, client: { emperor: { assistantConfigurations: api } }, panels: [] as AssistantConfigurationPanelProps[], callbackErrors: vi.fn() };
});

vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: mocks.client }) } }));
vi.mock("./AssistantConfigurationPanel", () => ({
  default: function CapturedPanel(props: AssistantConfigurationPanelProps) {
    mocks.panels.push(props);
    return <div>
      <p data-testid="bridge-agent">{props.agentKey}</p><p data-testid="bridge-scope">{props.scopeKey}</p>
      <p data-testid="bridge-metadata">{props.metadata.status}</p>
      {props.canEdit && <section aria-label="捕获的敏感编辑器">
        <p data-testid="bridge-write-state">{String(props.writesEnabled)}</p>
        <p data-testid="bridge-detail-state">{props.detail?.status}</p>
        {props.detail?.status === "ready" && props.detail.data.status === "configured" && <p>{props.detail.data.record.config.instructions}</p>}
        <button type="button" onClick={() => void props.onSave({ agentKey: props.agentKey, expectedRevision: 2, config: config() }).catch(mocks.callbackErrors)}>调用保存回调</button>
        <button type="button" onClick={() => void props.onRestore({ agentKey: props.agentKey, expectedRevision: 2, targetRevision: 1 }).catch(mocks.callbackErrors)}>调用恢复回调</button>
      </section>}
    </div>;
  },
}));

const scopeKey = "workspace:9/user:1/admin";
const owner = { agentKey: "listing" as const, scopeKey, workspaceId: 9, canEdit: true };
const timestamp = "2026-10-15T01:00:00.000Z";

function config(instructions = "当前范围的完整私有指令"): AssistantConfiguration {
  return { name: "助手配置", description: "", enabled: false, modelSlug: "", instructions, rules: [], skills: [] };
}
function saved(revision = 2, instructions?: string, agentKey: "listing" | "images" = "listing"): AssistantConfigurationRecord {
  return { agentKey, revision, config: config(instructions), updatedAt: timestamp };
}
function metadata(agentKey: "listing" | "images" = "listing"): AssistantConfigurationMetadata {
  return { agentKey, status: "configured", revision: 2, name: "配置摘要", description: "", enabled: false, modelSlug: "", skillCount: 0, ruleCount: 0, updatedAt: timestamp };
}
function options(writeEnabled = true): AssistantConfigurationOptions {
  return { writeEnabled, models: [], skills: [] };
}
function history(revisions = [2, 1], nextBeforeRevision: number | null = null): AssistantConfigurationHistory {
  return { versions: revisions.map(revision => ({ revision, createdAt: timestamp, createdBy: 1, sourceRevision: null })), nextBeforeRevision };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function latest(): AssistantConfigurationPanelProps {
  const value = mocks.panels.at(-1);
  if (!value) throw new Error("Panel has not rendered");
  return value;
}
async function ready() {
  await waitFor(() => {
    expect(latest().detail?.status).toBe("ready");
    expect(latest().options?.status).toBe("ready");
    expect(latest().history?.status).toBe("ready");
  });
}
function forbidden() {
  return Object.assign(new Error("policy 已撤销 agent.update"), { data: { code: "FORBIDDEN" } });
}

beforeEach(() => {
  mocks.panels.length = 0;
  mocks.callbackErrors.mockReset();
  for (const operation of Object.values(mocks.api)) Object.values(operation)[0].mockReset();
  mocks.api.listMetadata.query.mockResolvedValue({ items: [metadata(), metadata("images")] });
  mocks.api.get.query.mockResolvedValue({ status: "configured", record: saved() });
  mocks.api.options.query.mockResolvedValue(options());
  mocks.api.history.query.mockResolvedValue(history());
  mocks.api.getVersion.query.mockResolvedValue({ agentKey: "listing", revision: 1, config: config("历史私有指令"), createdAt: timestamp, sourceRevision: null });
  mocks.api.save.mutate.mockResolvedValue(saved(3));
  mocks.api.rollback.mutate.mockResolvedValue(saved(3));
});
afterEach(cleanup);

describe("AssistantConfigurationBridge owned reads", () => {
  it("retains the latest StrictMode effect generation, ignores old replies, and keeps default writes off", async () => {
    const oldMetadata = deferred<{ items: AssistantConfigurationMetadata[] }>(), newMetadata = deferred<{ items: AssistantConfigurationMetadata[] }>();
    const oldDetail = deferred<{ status: "configured"; record: AssistantConfigurationRecord }>(), newDetail = deferred<{ status: "configured"; record: AssistantConfigurationRecord }>();
    const oldOptions = deferred<AssistantConfigurationOptions>(), newOptions = deferred<AssistantConfigurationOptions>();
    const oldHistory = deferred<AssistantConfigurationHistory>(), newHistory = deferred<AssistantConfigurationHistory>();
    mocks.api.listMetadata.query.mockReturnValueOnce(oldMetadata.promise).mockReturnValueOnce(newMetadata.promise);
    mocks.api.get.query.mockReturnValueOnce(oldDetail.promise).mockReturnValueOnce(newDetail.promise);
    mocks.api.options.query.mockReturnValueOnce(oldOptions.promise).mockReturnValueOnce(newOptions.promise);
    mocks.api.history.query.mockReturnValueOnce(oldHistory.promise).mockReturnValueOnce(newHistory.promise);
    render(<StrictMode><AssistantConfigurationBridge {...owner} /></StrictMode>);
    for (const query of [mocks.api.listMetadata.query, mocks.api.get.query, mocks.api.options.query, mocks.api.history.query]) {
      expect(query).toHaveBeenCalledTimes(2);
      expect(query.mock.calls[0][1].signal.aborted).toBe(true);
      expect(query.mock.calls[1][1].signal.aborted).toBe(false);
    }
    await act(async () => {
      newMetadata.resolve({ items: [metadata()] }); newDetail.resolve({ status: "configured", record: saved(4, "StrictMode 最新代指令") });
      newOptions.resolve(options(false)); newHistory.resolve(history([4]));
    });
    await ready();
    expect(screen.getByText("StrictMode 最新代指令")).toBeVisible();
    await act(async () => {
      oldMetadata.resolve({ items: [metadata("images")] }); oldDetail.resolve({ status: "configured", record: saved(1, "StrictMode 旧代不得回填") });
      oldOptions.resolve(options(true)); oldHistory.resolve(history([1]));
    });
    expect(screen.queryByText("StrictMode 旧代不得回填")).not.toBeInTheDocument();
    expect(screen.getByText("StrictMode 最新代指令")).toBeVisible();
    expect(latest().metadata).toMatchObject({ status: "ready", data: { agentKey: "listing" } });
    expect(latest().history).toMatchObject({ status: "ready", data: { versions: [{ revision: 4 }] } });
    expect(latest().writesEnabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "调用保存回调" }));
    fireEvent.click(screen.getByRole("button", { name: "调用恢复回调" }));
    await waitFor(() => expect(mocks.callbackErrors).toHaveBeenCalledTimes(2));
    expect(mocks.api.save.mutate).not.toHaveBeenCalled();
    expect(mocks.api.rollback.mutate).not.toHaveBeenCalled();
  });

  it("issues fresh owned reads and attaches expected workspace to all seven API operations", async () => {
    mocks.api.history.query.mockResolvedValueOnce(history([3, 2], 2)).mockResolvedValueOnce(history([1]));
    render(<AssistantConfigurationBridge {...owner} />);
    expect(latest().metadata.status).toBe("loading");
    await ready();
    expect(mocks.api.listMetadata.query).toHaveBeenCalledTimes(1);
    expect(mocks.api.listMetadata.query).toHaveBeenCalledWith({ expectedWorkspaceId: 9 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(mocks.api.get.query).toHaveBeenCalledWith({ expectedWorkspaceId: 9, agentKey: "listing" }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(mocks.api.options.query).toHaveBeenCalledWith({ expectedWorkspaceId: 9 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(mocks.api.history.query).toHaveBeenNthCalledWith(1, { expectedWorkspaceId: 9, agentKey: "listing", limit: 10 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(latest().metadata).toMatchObject({ status: "ready", scopeKey });
    expect(latest().writesEnabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "调用保存回调" }));
    fireEvent.click(screen.getByRole("button", { name: "调用恢复回调" }));
    await waitFor(() => {
      expect(mocks.api.save.mutate).toHaveBeenCalledTimes(1);
      expect(mocks.api.rollback.mutate).toHaveBeenCalledTimes(1);
    });
    expect(mocks.api.save.mutate).toHaveBeenCalledWith({ agentKey: "listing", expectedRevision: 2, config: config(), expectedWorkspaceId: 9 });
    expect(mocks.api.rollback.mutate).toHaveBeenCalledWith({ agentKey: "listing", expectedRevision: 2, targetRevision: 1, expectedWorkspaceId: 9 });
    await act(async () => { await latest().onReadVersion!({ agentKey: "listing", revision: 1 }); });
    expect(mocks.api.getVersion.query).toHaveBeenCalledWith({ agentKey: "listing", revision: 1, expectedWorkspaceId: 9 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    act(() => latest().onLoadHistoryPage!(2));
    await waitFor(() => expect(latest().history).toMatchObject({ status: "ready", data: { versions: [{ revision: 3 }, { revision: 2 }, { revision: 1 }] } }));
    expect(mocks.api.history.query).toHaveBeenNthCalledWith(2, { agentKey: "listing", expectedWorkspaceId: 9, beforeRevision: 2, limit: 10 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("keeps non-administrators at metadata and blocks direct private callback invocations", async () => {
    render(<AssistantConfigurationBridge {...owner} canEdit={false} />);
    await waitFor(() => expect(latest().metadata.status).toBe("ready"));
    expect(screen.queryByRole("region", { name: "捕获的敏感编辑器" })).not.toBeInTheDocument();
    await expect(latest().onReadVersion!({ agentKey: "listing", revision: 1 })).rejects.toThrow("配置权限或保存开关不可用");
    await expect(latest().onSave({ agentKey: "listing", expectedRevision: 2, config: config() })).rejects.toThrow("配置权限或保存开关不可用");
    await expect(latest().onRestore({ agentKey: "listing", expectedRevision: 2, targetRevision: 1 })).rejects.toThrow("配置权限或保存开关不可用");
    expect(mocks.api.listMetadata.query).toHaveBeenCalledTimes(1);
    for (const name of ["get", "options", "history", "getVersion"] as const) expect(mocks.api[name].query).not.toHaveBeenCalled();
    expect(mocks.api.save.mutate).not.toHaveBeenCalled();
    expect(mocks.api.rollback.mutate).not.toHaveBeenCalled();
  });

  it("retains authorized sensitive reads while the server write switch blocks save and restore callbacks", async () => {
    mocks.api.options.query.mockResolvedValue(options(false));
    render(<AssistantConfigurationBridge {...owner} />);
    await ready();
    expect(screen.getByText("当前范围的完整私有指令")).toBeVisible();
    expect(latest().canEdit).toBe(true);
    expect(latest().writesEnabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "调用保存回调" }));
    fireEvent.click(screen.getByRole("button", { name: "调用恢复回调" }));
    await waitFor(() => expect(mocks.callbackErrors).toHaveBeenCalledTimes(2));
    expect(mocks.api.save.mutate).not.toHaveBeenCalled();
    expect(mocks.api.rollback.mutate).not.toHaveBeenCalled();
    await act(async () => { await latest().onReadVersion!({ agentKey: "listing", revision: 1 }); });
    expect(mocks.api.getVersion.query).toHaveBeenCalledTimes(1);
  });

  it.each(["scope", "agent", "permission"] as const)("clears the owner on %s change and ignores old parallel replies", async change => {
    const oldMetadata = deferred<{ items: AssistantConfigurationMetadata[] }>();
    const oldDetail = deferred<{ status: "configured"; record: AssistantConfigurationRecord }>();
    const oldOptions = deferred<AssistantConfigurationOptions>();
    const oldHistory = deferred<AssistantConfigurationHistory>();
    mocks.api.listMetadata.query.mockReturnValueOnce(oldMetadata.promise);
    mocks.api.get.query.mockReturnValueOnce(oldDetail.promise);
    mocks.api.options.query.mockReturnValueOnce(oldOptions.promise);
    mocks.api.history.query.mockReturnValueOnce(oldHistory.promise);
    const { rerender } = render(<AssistantConfigurationBridge {...owner} />);
    const oldPanel = latest();
    const oldSignals = [mocks.api.listMetadata.query, mocks.api.get.query, mocks.api.options.query, mocks.api.history.query].map(query => query.mock.calls[0][1].signal as AbortSignal);
    const next = change === "scope" ? { ...owner, workspaceId: 10, scopeKey: "workspace:10/user:2/admin" }
      : change === "agent" ? { ...owner, agentKey: "images" as const } : { ...owner, canEdit: false, scopeKey: "workspace:9/user:1/reader" };
    mocks.api.get.query.mockResolvedValue({ status: "configured", record: saved(2, "新范围私有指令", next.agentKey) });
    rerender(<AssistantConfigurationBridge {...next} />);
    await waitFor(() => expect(latest().metadata.status).toBe("ready"));
    if (next.canEdit) await ready();
    expect(oldSignals.every(signal => signal.aborted)).toBe(true);
    await act(async () => {
      oldMetadata.resolve({ items: [metadata()] }); oldDetail.resolve({ status: "configured", record: saved(8, "旧范围不得回填的指令") });
      oldOptions.resolve(options()); oldHistory.resolve(history([8]));
    });
    expect(latest().scopeKey).toBe(next.scopeKey);
    expect(latest().agentKey).toBe(next.agentKey);
    expect(screen.queryByText("旧范围不得回填的指令")).not.toBeInTheDocument();
    if (next.canEdit) expect(screen.getByText("新范围私有指令")).toBeVisible();
    else expect(screen.queryByRole("region", { name: "捕获的敏感编辑器" })).not.toBeInTheDocument();
    await expect(oldPanel.onReadVersion!({ agentKey: "listing", revision: 1 })).rejects.toThrow("配置权限或保存开关不可用");
    expect(mocks.api.getVersion.query).not.toHaveBeenCalled();
  });

  it("quarantines all private props after a policy 403 and ignores other successful parallel replies", async () => {
    const get = deferred<unknown>(), available = deferred<AssistantConfigurationOptions>(), versions = deferred<AssistantConfigurationHistory>();
    mocks.api.get.query.mockReturnValue(get.promise);
    mocks.api.options.query.mockReturnValue(available.promise);
    mocks.api.history.query.mockReturnValue(versions.promise);
    render(<AssistantConfigurationBridge {...owner} />);
    const previous = latest();
    await act(async () => get.reject(forbidden()));
    expect(await screen.findByRole("alert")).toHaveTextContent("完整配置和草稿已关闭");
    expect(latest()).toMatchObject({ canEdit: false, writesEnabled: false, detail: undefined, options: undefined, history: undefined });
    await act(async () => { available.resolve(options()); versions.resolve(history([12])); });
    expect(latest()).toMatchObject({ canEdit: false, writesEnabled: false, detail: undefined, options: undefined, history: undefined });
    expect(screen.queryByRole("region", { name: "捕获的敏感编辑器" })).not.toBeInTheDocument();
    await expect(previous.onReadVersion!({ agentKey: "listing", revision: 1 })).rejects.toThrow("配置权限或保存开关不可用");
    await expect(previous.onSave({ agentKey: "listing", expectedRevision: 2, config: config() })).rejects.toThrow("配置权限或保存开关不可用");
    act(() => latest().onReload!());
    await waitFor(() => expect(mocks.api.listMetadata.query).toHaveBeenCalledTimes(2));
    expect(mocks.api.get.query).toHaveBeenCalledTimes(1);
    expect(mocks.api.options.query).toHaveBeenCalledTimes(1);
    expect(mocks.api.history.query).toHaveBeenCalledTimes(1);
    expect(mocks.api.getVersion.query).not.toHaveBeenCalled();
    expect(mocks.api.save.mutate).not.toHaveBeenCalled();
  });

  it("shows a pending or failed re-read without fabricating not-configured data", async () => {
    render(<AssistantConfigurationBridge {...owner} />);
    await ready();
    const refreshed = deferred<unknown>();
    mocks.api.get.query.mockReturnValueOnce(refreshed.promise);
    act(() => latest().onReload!());
    await waitFor(() => expect(latest().detail?.status).toBe("loading"));
    expect(latest().detail).not.toHaveProperty("data");
    expect(latest().canEdit).toBe(true);
    await act(async () => refreshed.reject(new Error("ASSISTANT_SCHEMA_UNAVAILABLE")));
    expect(latest().detail).toMatchObject({ status: "error", message: "ASSISTANT_SCHEMA_UNAVAILABLE" });
    expect(latest().detail).not.toHaveProperty("data");
  });

  it("checks pagination cursors, suppresses duplicates, deduplicates pages, and ignores a late page after reload", async () => {
    const page = deferred<AssistantConfigurationHistory>();
    mocks.api.history.query.mockResolvedValueOnce(history([5, 4], 4)).mockReturnValueOnce(page.promise);
    render(<AssistantConfigurationBridge {...owner} />);
    await ready();
    act(() => latest().onLoadHistoryPage!(99));
    expect(mocks.api.history.query).toHaveBeenCalledTimes(1);
    act(() => { latest().onLoadHistoryPage!(4); latest().onLoadHistoryPage!(4); });
    expect(mocks.api.history.query).toHaveBeenCalledTimes(2);
    await act(async () => page.resolve(history([4, 3, 2], 2)));
    expect(latest().history).toMatchObject({ status: "ready", data: { versions: [{ revision: 5 }, { revision: 4 }, { revision: 3 }, { revision: 2 }], nextBeforeRevision: 2 } });
    const latePage = deferred<AssistantConfigurationHistory>();
    mocks.api.history.query.mockReturnValueOnce(latePage.promise).mockResolvedValueOnce(history([9]));
    act(() => latest().onLoadHistoryPage!(2));
    const lateSignal = mocks.api.history.query.mock.calls[2][1].signal as AbortSignal;
    act(() => latest().onReload!());
    await ready();
    expect(lateSignal.aborted).toBe(true);
    await act(async () => latePage.resolve(history([1])));
    expect(latest().history).toMatchObject({ status: "ready", data: { versions: [{ revision: 9 }], nextBeforeRevision: null } });
  });

  it("rejects a historical read completed after an owner switch", async () => {
    const version = deferred<unknown>();
    mocks.api.getVersion.query.mockReturnValueOnce(version.promise);
    const { rerender } = render(<AssistantConfigurationBridge {...owner} />);
    await ready();
    const read = latest().onReadVersion!({ agentKey: "listing", revision: 1 });
    const rejected = expect(read).rejects.toThrow("配置权限或保存开关不可用");
    const signal = mocks.api.getVersion.query.mock.calls[0][1].signal as AbortSignal;
    rerender(<AssistantConfigurationBridge {...owner} scopeKey="workspace:10/user:2/admin" workspaceId={10} />);
    expect(signal.aborted).toBe(true);
    await act(async () => version.resolve({ agentKey: "listing", revision: 1, config: config("不能返回旧历史指令"), createdAt: timestamp, sourceRevision: null }));
    await rejected;
    expect(screen.queryByText("不能返回旧历史指令")).not.toBeInTheDocument();
  });

  it("revokes sensitive access when getVersion returns policy 403 and aborts pending history reads", async () => {
    mocks.api.history.query.mockResolvedValueOnce(history([3, 2], 2));
    render(<AssistantConfigurationBridge {...owner} />);
    await ready();
    const previous = latest();
    const page = deferred<AssistantConfigurationHistory>();
    mocks.api.history.query.mockReturnValueOnce(page.promise);
    act(() => latest().onLoadHistoryPage!(2));
    const signal = mocks.api.history.query.mock.calls[1][1].signal as AbortSignal;
    mocks.api.getVersion.query.mockRejectedValueOnce(forbidden());
    await act(async () => { await expect(latest().onReadVersion!({ agentKey: "listing", revision: 1 })).rejects.toThrow("policy 已撤销"); });
    expect(signal.aborted).toBe(true);
    expect(latest()).toMatchObject({ canEdit: false, writesEnabled: false, detail: undefined, options: undefined, history: undefined });
    act(() => previous.onLoadHistoryPage!(2));
    expect(mocks.api.history.query).toHaveBeenCalledTimes(2);
    await act(async () => page.resolve(history([1])));
    expect(latest().history).toBeUndefined();
  });
});
