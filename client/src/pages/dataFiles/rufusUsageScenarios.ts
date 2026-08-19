export type RufusUsageScenario = {
  scenario?: string | null;
  detail?: string | null;
};

export function getRufusUsageScenarios(value: unknown): Array<{ scenario: string; detail: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      scenario: typeof item?.scenario === "string" ? item.scenario.trim() : "",
      detail: typeof item?.detail === "string" ? item.detail.trim() : "",
    }))
    .filter((item) => item.scenario || item.detail);
}
