import { describe, expect, it } from "vitest";
import type { AssistantConfigurationRecord } from "@shared/assistantConfigurations";
import {
  assistantConfigurationDraftIsStale, createAssistantConfigurationDraft, createAssistantConfigurationRequestGuard,
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
    expect(state.form).toMatchObject({ enabled: false, modelSlug: "", skills: [], rulesText: "" });
    expect(state.dirty).toBe(false);
  });

  it("keeps an unsaved draft and its original CAS revision after a newer refetch", () => {
    const initial = createAssistantConfigurationDraft("listing", record());
    const dirty = updateAssistantConfigurationDraft(initial, { ...initial.form, instructions: "我的未保存指令" });
    const refreshed = observeAssistantConfiguration(dirty, record(2));
    expect(refreshed.form.instructions).toBe("我的未保存指令");
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

  it("normalizes rule separators while retaining exact Skill version, digest and disabled fields", () => {
    const state = createAssistantConfigurationDraft("listing", record());
    const parsed = parseAssistantConfigurationDraft({ ...state.form, rulesText: " 首条规则 \r\n\n第二条规则\n" });
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw parsed.error;
    expect(parsed.data.rules).toEqual(["首条规则", "第二条规则"]);
    expect(parsed.data.skills).toEqual(record().config.skills);
    expect(state.form.rulesText).toBe("保留规则");
  });

  it("uses shared schema limits and rejects invalid exact references", () => {
    const state = createAssistantConfigurationDraft("listing", record());
    expect(parseAssistantConfigurationDraft({ ...state.form, name: "" }).success).toBe(false);
    expect(parseAssistantConfigurationDraft({ ...state.form, rulesText: Array.from({ length: 31 }, (_, index) => `规则 ${index}`).join("\n") }).success).toBe(false);
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
