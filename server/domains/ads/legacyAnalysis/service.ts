import { registerAdArtifact } from "../../ai_os/services/businessArtifactRegistry";
import {
  invokeBusinessSkill,
} from "../../ai_os/services/businessSkillGateway";
import type { InvokeParams } from "../../../_core/llm";

export function runAdsSkill(params: InvokeParams) {
  return invokeBusinessSkill(params);
}

export async function captureAdArtifact(
  ctx: { user: { id: number }; workspaceId: number },
  artifactKey: string,
  sourceTable: string,
  sourceRowId: number | string,
  content: unknown,
  sourceType: "ai_output" | "user_edit" = "ai_output",
  status: "draft" | "final" = "draft",
) {
  await registerAdArtifact({
    artifactKey,
    sourceTable,
    sourceRowId,
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
    content,
    sourceType,
    status,
  });
}
