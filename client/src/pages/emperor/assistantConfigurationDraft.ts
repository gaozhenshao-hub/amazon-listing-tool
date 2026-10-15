import { AGENT_LIBRARY_ROLES, type AgentLibraryKey } from "@shared/agentLibraryContracts";
import {
  AssistantConfigurationSchema, type AssistantConfiguration, type AssistantConfigurationRecord,
} from "@shared/assistantConfigurations";
export type { AssistantConfigurationRecord } from "@shared/assistantConfigurations";

export type AssistantConfigurationForm = AssistantConfiguration;
export type AssistantConfigurationDraft = {
  agentKey: AgentLibraryKey;
  expectedRevision: number;
  baseline: AssistantConfigurationForm;
  form: AssistantConfigurationForm;
  latest: AssistantConfigurationRecord | null;
  dirty: boolean;
};

export function emptyAssistantConfiguration(agentKey: AgentLibraryKey): AssistantConfiguration {
  return {
    name: AGENT_LIBRARY_ROLES.find(role => role.key === agentKey)!.name,
    description: "", enabled: false, modelSlug: "", instructions: "", rules: [], skills: [],
  };
}

function toForm(config: AssistantConfiguration): AssistantConfigurationForm {
  return { ...config, rules: [...config.rules], skills: config.skills.map(skill => ({ ...skill })) };
}

export function createAssistantConfigurationDraft(
  agentKey: AgentLibraryKey,
  record: AssistantConfigurationRecord | null,
): AssistantConfigurationDraft {
  const baseline = toForm(record?.config ?? emptyAssistantConfiguration(agentKey));
  return { agentKey, expectedRevision: record?.revision ?? 0, baseline, form: baseline, latest: record, dirty: false };
}

export function updateAssistantConfigurationDraft(
  state: AssistantConfigurationDraft,
  form: AssistantConfigurationForm,
): AssistantConfigurationDraft {
  return { ...state, form, dirty: JSON.stringify(form) !== JSON.stringify(state.baseline) };
}

/** A refetch can announce a conflict, but cannot replace unsaved work. */
export function observeAssistantConfiguration(
  state: AssistantConfigurationDraft,
  record: AssistantConfigurationRecord | null,
): AssistantConfigurationDraft {
  if (record && record.agentKey !== state.agentKey) return state;
  const revision = record?.revision ?? 0;
  // Ignore an older in-flight read after a successful save or restore.
  if (revision < state.expectedRevision || revision < (state.latest?.revision ?? 0)) return state;
  if (state.dirty) return { ...state, latest: record };
  return createAssistantConfigurationDraft(state.agentKey, record);
}

export function assistantConfigurationDraftIsStale(state: AssistantConfigurationDraft): boolean {
  return state.expectedRevision !== (state.latest?.revision ?? 0);
}

export function discardAssistantConfigurationDraft(state: AssistantConfigurationDraft): AssistantConfigurationDraft {
  return createAssistantConfigurationDraft(state.agentKey, state.latest);
}

export function parseAssistantConfigurationDraft(form: AssistantConfigurationForm) {
  return AssistantConfigurationSchema.safeParse(form);
}

/** Native textareas expose LF; retain the edited rule's existing CRLF separators. */
export function assistantRuleTextFromTextarea(previous: string, value: string): string {
  if (!previous.includes("\r\n") || value.includes("\r")) return value;
  const separators = previous.match(/\r\n|\n/g) ?? [];
  const addedSeparator = separators.every(separator => separator === "\r\n") ? "\r\n" : "\n";
  let index = 0;
  return value.replace(/\n/g, () => separators[index++] ?? addedSeparator);
}

/** Each mounted scope/role owns its callbacks; a later completion cannot cross it. */
export function createAssistantConfigurationRequestGuard() {
  let current = 0;
  let active = true;
  return {
    activate: () => { active = true; },
    begin: () => ++current,
    accepts: (request: number) => active && request === current,
    dispose: () => { active = false; current += 1; },
  };
}
