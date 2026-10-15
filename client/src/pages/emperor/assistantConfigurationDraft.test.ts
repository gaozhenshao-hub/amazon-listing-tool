import { describe, expect, it } from "vitest";
import { AGENT_LIBRARY_LIMITS } from "@shared/agentLibraryContracts";
import type { AssistantConfigurationRecord } from "@shared/assistantConfigurations";
import {
  assistantConfigurationDraftIsStale, assistantRuleTextFromTextarea, createAssistantConfigurationDraft, createAssistantConfigurationRequestGuard,
  discardAssistantConfigurationDraft, emptyAssistantConfiguration, observeAssistantConfiguration,
  parseAssistantConfigurationDraft, updateAssistantConfigurationDraft,
} from "./assistantConfigurationDraft";

const hash = "a".repeat(64);
const record = (revision = 1): AssistantConfigurationRecord => ({
  agentKey: "listing", revision, updatedAt: "2026-10-15T01:00:00.000Z",
  config: { ...emptyAssistantConfiguration("listing"), name: `配置 ${revision}`, instructions: "已保存指令", rules: ["保留规则"],
    skills: [{ slug: "listing.copy", version: 2, manifestSha256: hash, enabled: false, trigger: "人工选择", instructions: "保留停用绑定" }] },
});

describe("assistant configuration drafts", () => {
  it("starts unconfigured drafts at revision zero without enabling or selecting resources", () => {
    const state = createAssistantConfigurationDraft("listing", null);
    expect(state.expectedRevision).toBe(0);
    expect(state.form).toMatchObject({ enabled: false, modelSlug: "", skills: [], rules: [] });
    expect(state.dirty).toBe(false);
  });

  it("keeps an unsaved draft and its original CAS revision after a newer refetch", () => {
    const initial = createAssistantConfigurationDraft("listing", record());
    const dirty = updateAssistantConfigurationDraft(initial, { ...initial.form, instructions: "我的未保存指令", rules: ["未保存规则\r\n  继续说明"] });
    const refreshed = observeAssistantConfiguration(dirty, record(2));
    expect(refreshed.form.instructions).toBe("我的未保存指令");
    expect(refreshed.form.rules).toEqual(["未保存规则\r\n  继续说明"]);
    expect(refreshed.expectedRevision).toBe(1);
    expect(refreshed.latest?.revision).toBe(2);
    expect(assistantConfigurationDraftIsStale(refreshed)).toBe(true);
    expect(discardAssistantConfigurationDraft(refreshed)).toMatchObject({ expectedRevision: 2, dirty: false, form: { name: "配置 2" } });
  });

  it("adopts a new saved revision only when the editor is pristine", () => {
    const state = observeAssistantConfiguration(createAssistantConfigurationDraft("listing", record()), record(2));
    expect(state).toMatchObject({ expectedRevision: 2, dirty: false, form: { name: "配置 2" } });
  });

  it("ignores older reads, unconfigured reads after saving, and another agent's response", () => {
    const state = createAssistantConfigurationDraft("listing", record(3));
    expect(observeAssistantConfiguration(state, record(2))).toBe(state);
    expect(observeAssistantConfiguration(state, null)).toBe(state);
    expect(observeAssistantConfiguration(state, { ...record(4), agentKey: "images" })).toBe(state);
  });

  it("retains exact rule boundaries, internal LF/CRLF, numbering and spacing when other fields change", () => {
    const saved = record();
    const rules = ["1. 首条规则\n  - 子项  保留空格", "2. 第二条规则\r\n  继续说明", "3. JSON 示例：\n  {\"instruction\": \"作为规则文本保留\"}"];
    saved.config.rules = rules;
    const state = createAssistantConfigurationDraft("listing", saved);
    const parsed = parseAssistantConfigurationDraft({ ...state.form, name: "修改名称", modelSlug: "server-option", instructions: "仅改指令" });
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw parsed.error;
    expect(parsed.data.rules).toEqual(rules);
    expect(parsed.data.skills).toEqual(record().config.skills);
    expect(state.form.rules).toEqual(rules);
    expect(state.form.rules).not.toBe(rules);
  });

  it("retains a modified rule's existing line-ending styles without changing its siblings", () => {
    const previous = "1. 原文\r\n  - 子项一\n  - 子项二\r\n  - 子项三";
    const value = "1. 修改原文\n  - 子项一\n  - 子项二\n  - 子项三";
    expect(assistantRuleTextFromTextarea(previous, value)).toBe("1. 修改原文\r\n  - 子项一\n  - 子项二\r\n  - 子项三");
    expect(assistantRuleTextFromTextarea("第一行\r\n第二行", "第一行\n第二行\n新增行")).toBe("第一行\r\n第二行\r\n新增行");
    expect(assistantRuleTextFromTextarea("第一行\n第二行", "修改后\n第二行")).toBe("修改后\n第二行");
    expect(assistantRuleTextFromTextarea(previous, "显式输入\r\n新行")).toBe("显式输入\r\n新行");
  });

  it("treats an empty array as an explicit clear and refuses empty entries instead of dropping them", () => {
    const state = createAssistantConfigurationDraft("listing", record());
    expect(parseAssistantConfigurationDraft({ ...state.form, rules: [] }).success).toBe(true);
    expect(parseAssistantConfigurationDraft({ ...state.form, rules: [""] }).success).toBe(false);
    expect(parseAssistantConfigurationDraft({ ...state.form, rules: [" \n\t "] }).success).toBe(false);
    const parsed = parseAssistantConfigurationDraft({ ...state.form, rules: ["  规则外侧沿用契约 trim\r\n  内部空格保留  "] });
    expect(parsed.success && parsed.data.rules).toEqual(["规则外侧沿用契约 trim\r\n  内部空格保留"]);
  });

  it("uses shared schema limits and rejects invalid exact references", () => {
    const state = createAssistantConfigurationDraft("listing", record());
    expect(parseAssistantConfigurationDraft({ ...state.form, name: "" }).success).toBe(false);
    expect(parseAssistantConfigurationDraft({ ...state.form, rules: Array.from({ length: AGENT_LIBRARY_LIMITS.rules + 1 }, (_, index) => `规则 ${index}`) }).success).toBe(false);
    expect(parseAssistantConfigurationDraft({ ...state.form, rules: ["x".repeat(AGENT_LIBRARY_LIMITS.ruleCharacters + 1)] }).success).toBe(false);
    const totalLengthRules = Array.from({ length: AGENT_LIBRARY_LIMITS.rules }, () => "x".repeat(AGENT_LIBRARY_LIMITS.ruleCharacters));
    expect(totalLengthRules.join("\n").length).toBeGreaterThan(AGENT_LIBRARY_LIMITS.totalRuleCharacters);
    expect(parseAssistantConfigurationDraft({ ...state.form, rules: totalLengthRules }).success).toBe(false);
    expect(parseAssistantConfigurationDraft({ ...state.form, skills: state.form.skills.map(skill => ({ ...skill, manifestSha256: "guessed" })) }).success).toBe(false);
  });

  it("rejects superseded and unmounted callbacks even across a StrictMode reactivation", () => {
    const guard = createAssistantConfigurationRequestGuard();
    const first = guard.begin();
    const second = guard.begin();
    expect(guard.accepts(first)).toBe(false);
    expect(guard.accepts(second)).toBe(true);
    guard.dispose();
    expect(guard.accepts(second)).toBe(false);
    guard.activate();
    expect(guard.accepts(second)).toBe(false);
    expect(guard.accepts(guard.begin())).toBe(true);
  });
});
