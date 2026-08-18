import {
  db,
  ensureWriteAccess,
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
}) {
  const project = await resolveProjectAccess(input.projectId, input.user);
  ensureWriteAccess(project, input.user);
  let session = await resolveSessionAccess(input.projectId, input.user);
  if (!session) {
    session = await db.createImageWorkflowSession({
      projectId: input.projectId,
      userId: input.user.id,
      currentStep: input.step,
    });
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
    workspaceId: input.workspaceId,
    agentRunId,
  });
}
