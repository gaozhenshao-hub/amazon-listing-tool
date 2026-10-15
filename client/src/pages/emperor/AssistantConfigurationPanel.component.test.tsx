// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { TextEncoder } from "node:util";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantConfigurationRecord } from "@shared/assistantConfigurations";
import AssistantConfigurationPanel, { type AssistantConfigurationPanelProps, type AssistantConfigurationReadState } from "./AssistantConfigurationPanel";
import { emptyAssistantConfiguration } from "./assistantConfigurationDraft";

const scopeKey = "workspace:1/user:1";
const hashA = "a".repeat(64), hashB = "b".repeat(64);
const ready = <T,>(data: T, scope = scopeKey): AssistantConfigurationReadState<T> => ({ status: "ready", scopeKey: scope, data });
const record = (revision = 1, agentKey: "listing" | "images" = "listing"): AssistantConfigurationRecord => ({
  agentKey, revision, updatedAt: "2026-10-15T01:00:00.000Z",
  config: { ...emptyAssistantConfiguration(agentKey), name: `保存配置 ${revision}`, instructions: "完整私有指令", rules: ["完整私有规则"],
    skills: [{ slug: "listing.copy", version: 2, manifestSha256: hashA, enabled: false, trigger: "手动指定", instructions: "停用绑定的补充指令" }] },
});

function props(overrides: Partial<AssistantConfigurationPanelProps> = {}): AssistantConfigurationPanelProps {
  const saved = record();
  return {
    agentKey: "listing", scopeKey, canEdit: true,
    metadata: ready({ agentKey: "listing", status: "configured", revision: 1, name: "已保存摘要", description: "摘要描述", enabled: false, modelSlug: "", skillCount: 1, ruleCount: 1, updatedAt: saved.updatedAt }),
    detail: ready({ status: "configured", record: saved }),
    options: ready({ writeEnabled: true, models: [
      { slug: "plain", name: "通用模型", modelId: "model-with-vision-in-name", capabilityTags: ["text"] },
      { slug: "visual", name: "视觉模型", modelId: "verified-model", capabilityTags: ["text", "vision"] },
    ], skills: [{ slug: "listing.copy", name: "文案 Skill", version: 2, manifestSha256: hashA }] }),
    history: ready({ versions: [{ revision: 1, sourceRevision: null, createdAt: saved.updatedAt, createdBy: 1 }], nextBeforeRevision: null }),
    onSave: vi.fn(async input => ({ ...record(input.expectedRevision + 1), config: input.config })),
    onRestore: vi.fn(async input => record(input.expectedRevision + 1)),
    onReadVersion: vi.fn(async input => ({ revision: input.revision, config: record(input.revision).config })),
    onReload: vi.fn(), ...overrides,
  };
}

beforeEach(() => vi.stubGlobal("TextEncoder", TextEncoder));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("AssistantConfigurationPanel", () => {
  it("shows ordinary readers only truthful metadata, without complete configuration or actions", () => {
    render(<AssistantConfigurationPanel {...props({ canEdit: false })} />);
    expect(screen.getByText("已保存摘要 · 已保存版本 1 · 配置设为停用（尚未接入业务执行）")).toBeVisible();
    expect(screen.getByText(/本页长期规则以专属配置的 rules 为唯一来源/)).toHaveTextContent("本批未自动迁移或双写旧图像记忆。Skill 摘要仅标识 manifest 内容，不是完整运行快照。");
    expect(screen.getByText("继承业务模型策略；独立对话未配置")).toBeVisible();
    expect(screen.queryByText("完整私有指令")).not.toBeInTheDocument();
    expect(screen.queryByText("完整私有规则")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "配置版本历史" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "重新读取配置摘要" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /保存|恢复|执行|聊天/ })).not.toBeInTheDocument();
  });

  it("lets ordinary readers retry the configuration summary exactly once", () => {
    const input = props({ canEdit: false, metadata: { status: "error", message: "摘要暂时读取失败" } });
    render(<AssistantConfigurationPanel {...input} />);
    fireEvent.click(screen.getByRole("button", { name: "重新读取配置摘要" }));
    expect(input.onReload).toHaveBeenCalledTimes(1);
    expect(input.onSave).not.toHaveBeenCalled();
    expect(input.onRestore).not.toHaveBeenCalled();
  });

  it("distinguishes a missing schema from an unconfigured assistant", () => {
    render(<AssistantConfigurationPanel {...props({ canEdit: false, metadata: { status: "error", message: "ASSISTANT_SCHEMA_UNAVAILABLE" } })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("ASSISTANT_SCHEMA_UNAVAILABLE");
    expect(screen.queryByText(/此助手尚未配置/)).not.toBeInTheDocument();
  });

  it.each([undefined, false])("keeps saving and restoration off when writesEnabled is %s while allowing authorized reads and local edits", async writesEnabled => {
    const input = props({ writesEnabled, detail: ready({ status: "configured", record: record(2) }) });
    render(<AssistantConfigurationPanel {...input} />);
    expect(screen.getByText(/本环境配置保存未启用/)).toBeVisible();
    expect(screen.getByRole("textbox", { name: "长期指令" })).toHaveValue("完整私有指令");
    const restore = screen.getByRole("button", { name: "恢复版本 1 为新版本" });
    expect(restore).toBeDisabled();
    fireEvent.click(restore);
    fireEvent.click(screen.getByRole("button", { name: "查看版本 1" }));
    expect(await screen.findByRole("region", { name: "版本 1 配置预览" })).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "长期指令" }), { target: { value: "允许本地编辑，尚未保存" } });
    expect(screen.getByRole("textbox", { name: "长期指令" })).toHaveValue("允许本地编辑，尚未保存");
    const save = screen.getByRole("button", { name: "保存配置为新版本" });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(input.onSave).not.toHaveBeenCalled();
    expect(input.onRestore).not.toHaveBeenCalled();
  });

  it("keeps unconfigured state explicit and creates revision zero only on an administrator save", async () => {
    const input = props({
      writesEnabled: true,
      metadata: ready({ agentKey: "listing", status: "not-configured", revision: null, name: null, description: null, enabled: null, modelSlug: null, skillCount: 0, ruleCount: 0, updatedAt: null }),
      detail: ready({ agentKey: "listing", status: "not-configured" }),
      history: ready({ versions: [], nextBeforeRevision: null }),
    });
    render(<AssistantConfigurationPanel {...input} />);
    expect(screen.getByText(/此助手尚未配置，没有已保存版本或已启用状态/)).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "配置设为启用（尚未接入业务执行）" })).not.toBeChecked();
    expect(screen.getByRole("combobox", { name: "专属模型" })).toHaveValue("");
    expect(input.onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保存配置为新版本" }));
    await waitFor(() => expect(input.onSave).toHaveBeenCalledWith(expect.objectContaining({ agentKey: "listing", expectedRevision: 0, config: expect.objectContaining({ enabled: false, modelSlug: "", skills: [] }) })));
    expect(screen.queryByRole("button", { name: /聊天|执行|运行/ })).not.toBeInTheDocument();
  });

  it("preserves a dirty draft and original CAS revision on refetch, then saves disabled exact bindings", async () => {
    const input = props({ writesEnabled: true });
    const { rerender } = render(<AssistantConfigurationPanel {...input} />);
    fireEvent.change(screen.getByRole("textbox", { name: "长期指令" }), { target: { value: "未保存修改" } });
    rerender(<AssistantConfigurationPanel {...input} detail={ready({ status: "configured", record: record() })} />);
    expect(screen.getByRole("textbox", { name: "长期指令" })).toHaveValue("未保存修改");
    fireEvent.click(screen.getByRole("button", { name: "保存配置为新版本" }));
    await waitFor(() => expect(input.onSave).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1, config: expect.objectContaining({ instructions: "未保存修改", skills: record().config.skills }) })));
    expect(await screen.findByText("已保存版本 2。")).toBeVisible();
  });

  it("keeps conflicts and subsequent read errors from discarding unsaved instructions", async () => {
    const input = props({ writesEnabled: true, onSave: vi.fn(async () => { throw new Error("ASSISTANT_REVISION_CONFLICT"); }) });
    const { rerender } = render(<AssistantConfigurationPanel {...input} />);
    fireEvent.change(screen.getByRole("textbox", { name: "长期指令" }), { target: { value: "保留我的草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置为新版本" }));
    expect(await screen.findByText(/保存失败，草稿已保留/)).toHaveTextContent("ASSISTANT_REVISION_CONFLICT");
    rerender(<AssistantConfigurationPanel {...input} detail={{ status: "error", message: "读取暂时失败" }} />);
    expect(screen.getByRole("textbox", { name: "长期指令" })).toHaveValue("保留我的草稿");
    expect(screen.getByRole("button", { name: "保存配置为新版本" })).toBeDisabled();
    rerender(<AssistantConfigurationPanel {...input} detail={ready({ status: "configured", record: record(2) })} />);
    expect(screen.getByText(/服务器已有版本 2/)).toBeVisible();
    expect(screen.getByRole("textbox", { name: "长期指令" })).toHaveValue("保留我的草稿");
    expect(screen.getByRole("button", { name: "保存配置为新版本" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "放弃草稿并载入最新已读配置" }));
    expect(screen.getByRole("textbox", { name: "助手名称" })).toHaveValue("保存配置 2");
  });

  it("uses server capability tags and requires vision even when the model name suggests it", () => {
    render(<AssistantConfigurationPanel {...props({ writesEnabled: true, agentKey: "images", detail: ready({ status: "configured", record: record(1, "images") }) })} />);
    expect(screen.getByRole("option", { name: /通用模型/ })).toBeDisabled();
    expect(screen.getByRole("option", { name: /视觉模型/ })).not.toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "助手名称" }), { target: { value: "视觉助手" } });
    fireEvent.change(screen.getByRole("combobox", { name: "专属模型" }), { target: { value: "plain" } });
    expect(screen.getByText(/此角色需要视觉能力，请选择服务器已验证/)).toBeVisible();
    expect(screen.getByRole("button", { name: "保存配置为新版本" })).toBeDisabled();
  });

  it("does not silently replace the saved Skill digest when server options change", async () => {
    const input = props({ writesEnabled: true });
    const { rerender } = render(<AssistantConfigurationPanel {...input} />);
    fireEvent.change(screen.getByRole("textbox", { name: "长期指令" }), { target: { value: "我的草稿" } });
    rerender(<AssistantConfigurationPanel {...input} options={ready({ writeEnabled: true, models: [], skills: [{ slug: "listing.copy", name: "新发布内容", version: 2, manifestSha256: hashB }] })} />);
    expect(screen.getByRole("combobox", { name: "Skill 1 版本" })).toHaveValue(`listing.copy:2:${hashA}`);
    expect(screen.getByRole("textbox", { name: "长期指令" })).toHaveValue("我的草稿");
    expect(screen.getByRole("button", { name: "保存配置为新版本" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Skill 1 版本" }), { target: { value: `listing.copy:2:${hashB}` } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置为新版本" }));
    await waitFor(() => expect(input.onSave).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ skills: [expect.objectContaining({ manifestSha256: hashB, version: 2, enabled: false })] }) })));
  });

  it("clears drafts on role or scope changes and ignores a late save from the old scope", async () => {
    let resolve!: (value: AssistantConfigurationRecord) => void;
    const input = props({ writesEnabled: true, onSave: vi.fn(() => new Promise<AssistantConfigurationRecord>(done => { resolve = done; })) });
    const { rerender } = render(<AssistantConfigurationPanel {...input} />);
    fireEvent.change(screen.getByRole("textbox", { name: "长期指令" }), { target: { value: "旧范围草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置为新版本" }));
    rerender(<AssistantConfigurationPanel {...input} scopeKey="workspace:2/user:1" />);
    expect(screen.queryByRole("textbox", { name: "长期指令" })).not.toBeInTheDocument();
    await act(async () => resolve(record(2)));
    expect(input.onReload).not.toHaveBeenCalled();
    rerender(<AssistantConfigurationPanel {...input} agentKey="images" detail={ready({ status: "configured", record: record(1, "images") })} />);
    expect(screen.getByRole("textbox", { name: "长期指令" })).toHaveValue("完整私有指令");
    expect(screen.queryByText("已保存版本 2。")).not.toBeInTheDocument();
  });

  it("previews history through its callback and restores into a new revision with CAS", async () => {
    const input = props({ writesEnabled: true, detail: ready({ status: "configured", record: record(2) }) });
    render(<StrictMode><AssistantConfigurationPanel {...input} /></StrictMode>);
    fireEvent.click(screen.getByRole("button", { name: "查看版本 1" }));
    expect(await screen.findByRole("region", { name: "版本 1 配置预览" })).toHaveTextContent("配置设为停用（尚未接入业务执行）");
    expect(input.onReadVersion).toHaveBeenCalledWith({ agentKey: "listing", revision: 1 });
    fireEvent.change(screen.getByRole("textbox", { name: "助手名称" }), { target: { value: "未保存名称" } });
    expect(screen.getByRole("button", { name: "恢复版本 1 为新版本" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "放弃草稿并载入最新已读配置" }));
    fireEvent.click(screen.getByRole("button", { name: "恢复版本 1 为新版本" }));
    await waitFor(() => expect(input.onRestore).toHaveBeenCalledWith({ agentKey: "listing", expectedRevision: 2, targetRevision: 1 }));
    expect(await screen.findByText("已将历史版本 1 恢复为新版本 3。")).toBeVisible();
  });

  it("blocks malformed full configuration without rendering a fabricated empty editor", () => {
    const malformed = { ...record(), config: { ...record().config, skills: [{ ...record().config.skills[0], version: 0 }] } };
    render(<AssistantConfigurationPanel {...props({ detail: ready({ status: "configured", record: malformed }) })} />);
    expect(screen.getByText(/配置格式错误，无法安全编辑/)).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "长期指令" })).not.toBeInTheDocument();
  });
});
