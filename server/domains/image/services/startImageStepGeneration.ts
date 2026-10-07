import {
  asImageWorkflowVersionTrpcError,
  db,
  ensureWriteAccess,
  requireCurrentImageWorkflowUpstream,
  resolveProjectAccess,
  resolveSessionAccess,
} from "../routerContext";
import { ensureImageWorkflowAgentRun } from "../imageWorkflowAgentBridge";
import { startImageStepGenerationJob, type ImageGenerationStep } from "./stepGenerationJob";

export async function startImageStepGenerationForUser(input: {
  projectId: number;
  step: ImageGenerationStep;
  user: { id: number; role: string };
  workspaceId?: number | null;
  agentRunId?: string | null;
  distillationBinding?: { ledgerKey?: string | null; skillSlugs?: string[] };
}) {
  const project = await resolveProjectAccess(input.projectId, input.user, input.workspaceId);
  ensureWriteAccess(project, input.user);
  let session = await resolveSessionAccess(input.projectId, input.user, input.workspaceId);
  if (!session) {
    session = await db.createImageWorkflowSession({
      projectId: input.projectId,
      userId: input.user.id,
      currentStep: input.step,
    });
  }
  if (input.step > 0) {
    await requireCurrentImageWorkflowUpstream({
      workspaceId: Number(input.workspaceId || 0), projectId: input.projectId, sessionId: session.id,
      actorId: input.user.id, actorRole: input.user.role, targetStep: input.step,
    }).catch(asImageWorkflowVersionTrpcError);
  }
  const agentRunId = input.agentRunId || session.agentRunId || await ensureImageWorkflowAgentRun({
    projectId: input.projectId,
    userId: input.user.id,
    workspaceId: input.workspaceId ?? null,
  });
  if (agentRunId && agentRunId !== session.agentRunId) {
    await db.updateImageWorkflowSession(session.id, { agentRunId });
  }
  return startImageStepGenerationJob({
    projectId: input.projectId,
    sessionId: session.id,
    step: input.step,
    userId: input.user.id,
    actorRole: input.user.role,
    workspaceId: input.workspaceId,
    agentRunId,
    distillationBinding: input.distillationBinding,
  });
}
