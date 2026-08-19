export function shouldApplyStep4RunOutput(input: {
  status?: string | null;
  wasStartedInCurrentView: boolean;
  hasImageReferences: boolean;
}) {
  return input.status === "succeeded" && input.wasStartedInCurrentView && input.hasImageReferences;
}
