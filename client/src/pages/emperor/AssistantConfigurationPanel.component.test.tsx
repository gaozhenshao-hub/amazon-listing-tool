// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { TextEncoder } from "node:util";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_LIBRARY_LIMITS } from "@shared/agentLibraryContracts";
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

  it("preserves multiline rule arrays exactly when changing the model, name and instructions", async () => {
    const saved = record();
    const rules = ["1. 第一条\n  - 说明  保留空格", "2. 第二条\r\n  - 条件\r\n  - 反例"];
    saved.config.rules = rules;
    const input = props({ writesEnabled: true, detail: ready({ status: "configured", record: saved }) });
    render(<AssistantConfigurationPanel {...input} />);
    expect(screen.getByRole("textbox", { name: "长期规则 1" })).toHaveValue(rules[0]);
    expect(screen.getByRole("textbox", { name: "长期规则 2" })).toHaveValue(rules[1].replace(/\r\n/g, "\n"));
    fireEvent.change(screen.getByRole("combobox", { name: "专属模型" }), { target: { value: "plain" } });
    fireEvent.change(screen.getByRole("textbox", { name: "助手名称" }), { target: { value: "只改名称" } });
    fireEvent.change(screen.getByRole("textbox", { name: "长期指令" }), { target: { value: "只改指令" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置为新版本" }));
    await waitFor(() => expect(input.onSave).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ name: "只改名称", modelSlug: "plain", instructions: "只改指令", rules }) })));
  });

  it("edits one multiline rule while preserving its separators and all other rule entries", async () => {
    const saved = record();
    saved.config.rules = ["1. 保留第一条\n  - 原有空格", "2. 原第二条\r\n  条件一\r\n  条件二"];
    const input = props({ writesEnabled: true, detail: ready({ status: "configured", record: saved }) });
    render(<AssistantConfigurationPanel {...input} />);
    fireEvent.change(screen.getByRole("textbox", { name: "长期规则 2" }), { target: { value: "2. 修改第二条\n  条件一\n  条件二" } });
    expect(screen.getByRole("textbox", { name: "长期规则 1" })).toHaveValue(saved.config.rules[0]);
    fireEvent.click(screen.getByRole("button", { name: "保存配置为新版本" }));
    await waitFor(() => expect(input.onSave).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ rules: [saved.config.rules[0], "2. 修改第二条\r\n  条件一\r\n  条件二"] }) })));
  });

  it("requires explicit completion or removal of blank rules and saves an explicitly cleared list", async () => {
    const input = props({ writesEnabled: true });
    render(<AssistantConfigurationPanel {...input} />);
    fireEvent.click(screen.getByRole("button", { name: "添加长期规则" }));
    expect(screen.getByRole("textbox", { name: "长期规则 2" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "保存配置为新版本" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "保存配置为新版本" }));
    expect(input.onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "长期规则 2" }), { target: { value: "新增规则\n  一条规则内的说明" } });
    fireEvent.click(screen.getByRole("button", { name: "移除规则 1" }));
    expect(screen.getByRole("textbox", { name: "长期规则 1" })).toHaveValue("新增规则\n  一条规则内的说明");
    expect(screen.queryByRole("textbox", { name: "长期规则 2" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "移除规则 1" }));
    expect(screen.queryByRole("textbox", { name: /^长期规则 / })).not.toBeInTheDocument();
    expect(screen.getByText(/保存空列表将明确清空本助手的长期规则/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "保存配置为新版本" }));
    await waitFor(() => expect(input.onSave).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ rules: [] }) })));
  });

  it("retains dirty multiline rules during a newer refetch until the draft is explicitly discarded", () => {
    const saved = record();
    saved.config.rules = ["旧规则\r\n  说明", "第二条保留规则"];
    const input = props({ writesEnabled: true, detail: ready({ status: "configured", record: saved }) });
    const { rerender } = render(<AssistantConfigurationPanel {...input} />);
    fireEvent.change(screen.getByRole("textbox", { name: "长期规则 1" }), { target: { value: "我的草稿规则\n  继续说明" } });
    const refreshed = record(2);
    refreshed.config.rules = ["服务器最新规则\n  服务端说明"];
    rerender(<AssistantConfigurationPanel {...input} detail={ready({ status: "configured", record: refreshed })} />);
    expect(screen.getByText(/服务器已有版本 2/)).toBeVisible();
    expect(screen.getByRole("textbox", { name: "长期规则 1" })).toHaveValue("我的草稿规则\n  继续说明");
    expect(screen.getByRole("textbox", { name: "长期规则 2" })).toHaveValue("第二条保留规则");
    expect(screen.getByRole("button", { name: "保存配置为新版本" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "放弃草稿并载入最新已读配置" }));
    expect(screen.getByRole("textbox", { name: "长期规则 1" })).toHaveValue(refreshed.config.rules[0]);
    expect(screen.queryByRole("textbox", { name: "长期规则 2" })).not.toBeInTheDocument();
  });

  it("blocks overlong rules using shared limits without sending a save request", () => {
    const input = props({ writesEnabled: true });
    render(<AssistantConfigurationPanel {...input} />);
    const rule = screen.getByRole("textbox", { name: "长期规则 1" });
    expect(rule).toHaveAttribute("maxlength", String(AGENT_LIBRARY_LIMITS.ruleCharacters));
    fireEvent.change(rule, { target: { value: "x".repeat(AGENT_LIBRARY_LIMITS.ruleCharacters + 1) } });
    expect(screen.getByText(/配置校验未通过/)).toBeVisible();
    expect(screen.getByRole("button", { name: "保存配置为新版本" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "保存配置为新版本" }));
    expect(input.onSave).not.toHaveBeenCalled();
  });

  it("stops adding rules at the shared count limit", () => {
    const saved = record();
    saved.config.rules = Array.from({ length: AGENT_LIBRARY_LIMITS.rules }, (_, index) => `规则 ${index + 1}`);
    render(<AssistantConfigurationPanel {...props({ writesEnabled: true, detail: ready({ status: "configured", record: saved }) })} />);
    expect(screen.getAllByRole("textbox", { name: /^长期规则 / })).toHaveLength(AGENT_LIBRARY_LIMITS.rules);
    expect(screen.getByRole("button", { name: "添加长期规则" })).toBeDisabled();
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
    const restored = record(3);
    restored.config.rules = ["历史多行规则\r\n  继续说明", "历史第二条\n  说明"];
    const input = props({ writesEnabled: true, detail: ready({ status: "configured", record: record(2) }), onRestore: vi.fn(async () => restored) });
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
    expect(screen.getByRole("textbox", { name: "长期规则 1" })).toHaveValue(restored.config.rules[0].replace(/\r\n/g, "\n"));
    expect(screen.getByRole("textbox", { name: "长期规则 2" })).toHaveValue(restored.config.rules[1]);
  });

  it("does not describe a rules-only source link as restoring every historical field", () => {
    const input = props({ history: ready({ versions: [{ revision: 3, sourceRevision: 1, createdAt: record().updatedAt, createdBy: 1 }], nextBeforeRevision: null }) });
    render(<AssistantConfigurationPanel {...input} />);
    expect(screen.getByText(/关联来源版本 1（完整内容以本版配置为准）/)).toBeVisible();
    expect(screen.queryByText(/从版本 1 恢复/)).not.toBeInTheDocument();
    expect(input.onRestore).not.toHaveBeenCalled();
  });

  it("blocks malformed full configuration without rendering a fabricated empty editor", () => {
    const malformed = { ...record(), config: { ...record().config, skills: [{ ...record().config.skills[0], version: 0 }] } };
    render(<AssistantConfigurationPanel {...props({ detail: ready({ status: "configured", record: malformed }) })} />);
    expect(screen.getByText(/配置格式错误，无法安全编辑/)).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "长期指令" })).not.toBeInTheDocument();
  });
});
