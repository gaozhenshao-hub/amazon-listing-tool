import type { InvokeParams } from "../../../_core/llm";
import { invokeBusinessSkill } from "../../ai_os/services/businessSkillGateway";

export function runOpsSkill(params: InvokeParams) {
  return invokeBusinessSkill(params);
}
