import type { InvokeParams, InvokeResult } from "../../../_core/llm";
import { invokeViaEmperorSkill } from "../../../services/emperorInvocationGateway";

export class BusinessSkillRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessSkillRouteError";
  }
}

/**
 * Strict business-facing AI entry point. The system prompt always comes from
 * emperor_skills (scheme A); business code cannot fall back to the raw model.
 */
export async function invokeBusinessSkill(params: InvokeParams): Promise<InvokeResult> {
  if (params.bypassEmperor || params.emperorBypassReason) {
    throw new BusinessSkillRouteError("Business AI calls cannot bypass Emperor Skills");
  }
  if (params.tools?.length) {
    throw new BusinessSkillRouteError("Business tool calls must use the Emperor Tool Gateway");
  }

  const result = await invokeViaEmperorSkill({
    ...params,
    emperorSkill: {
      ...params.emperorSkill,
      fallbackToLegacy: false,
    },
  });
  if (!result) {
    throw new BusinessSkillRouteError(
      "No Emperor Skill route matched this business AI call; declare skillSlug before execution",
    );
  }
  return result;
}
