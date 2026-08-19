export type Step5AplusStrategyField = "overallStrategy" | "overallStory" | "consistency" | "modularDesign";

export function updateStep5AplusStrategy(
  data: any,
  field: Step5AplusStrategyField,
  value: string,
) {
  if (!data?.aPlusContent) return data;
  return {
    ...data,
    aPlusContent: {
      ...data.aPlusContent,
      [field]: value,
    },
  };
}
