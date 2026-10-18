import { requireDb, type AppDb } from "../../repositories/dbClient";
import { authorizeVideoWorkflow } from "./videoWorkflowRepository";
import { withVideoWorkflowTransaction } from "./videoWorkflowTransaction";
import { assertVideoWorkflowSchema, captureVideoWorkflowSource, captureVideoWorkflowTables, videoWorkflowFail as fail, videoWorkflowRows, videoWorkflowStatement } from "./videoWorkflowSource";
import { saveVideoWorkflowVersion } from "./videoWorkflowPublication";
import { projectVideoWorkflowAgent } from "./videoWorkflowAgentProjection";
import { videoWorkflowHash, videoWorkflowCanonical, VideoWorkflowIdentitySchema, VIDEO_WORKFLOW_DEFINITIONS, type VideoWorkflowScope, type VideoWorkflowOperation } from "../../../shared/videoWorkflow";

type LegacyOwner = { userId: number; workspaceId: number | null };
type LegacyScope = { projectId: number; videoScriptId: number };
type LegacySourceScope = LegacyScope & { operation: VideoWorkflowOperation; competitorScriptId?: number; rawContent?: string };
/** Old jobs retain their original provider protocol. This bridge only adds
 * current business locks/source CAS to prevent a late old response overwriting
 * newer human work; it never overlays the new saved Agent configuration. */
export function createVideoWorkflowLegacyJobBridge(getDb: () => Promise<AppDb> = () => requireDb("Video legacy execution"), permission?: Parameters<typeof authorizeVideoWorkflow>[4]) {
  async function session<T>(owner: LegacyOwner, target: LegacyScope, body: (tx: Parameters<Parameters<AppDb["transaction"]>[0]>[0], scope: VideoWorkflowScope) => Promise<T>) {
    const identity = VideoWorkflowIdentitySchema.parse({userId:owner.userId,workspaceId:owner.workspaceId}), scope = { projectId:target.projectId,videoScriptId:target.videoScriptId, expectedWorkspaceId: identity.workspaceId };
    return (await getDb()).transaction(async tx => {
      await assertVideoWorkflowSchema(tx); await authorizeVideoWorkflow(tx, identity, scope, "update", permission);
      const active = await videoWorkflowRows(tx, "SELECT runId FROM ai_jobs WHERE kind=? AND workspaceId=? AND projectId=? AND JSON_EXTRACT(input,'$.request.videoScriptId')=? AND (status IN ('queued','running') OR JSON_UNQUOTE(JSON_EXTRACT(output,'$.state'))='outcome_unknown') ORDER BY id LIMIT 2 FOR SHARE", ["video.workflow.configured.v1", identity.workspaceId, target.projectId, target.videoScriptId], 1);
      if (active.length) fail("ACTIVE_OPERATION_EXISTS");
      return body(tx, scope);
    });
  }
  const capture = async (tx: Parameters<Parameters<AppDb["transaction"]>[0]>[0], owner: LegacyOwner, scope: VideoWorkflowScope, target: LegacySourceScope) => {
    const source = await captureVideoWorkflowSource(tx, { userId: owner.userId, workspaceId: scope.expectedWorkspaceId },
      { ...scope, operation: target.operation, competitorScriptId: target.competitorScriptId ?? null, operationId: "00000000-0000-4000-8000-000000000000" }, permission);
    if (target.operation === "competitor_analysis" && source.tables.video_competitor_scripts.find(row => row.id === target.competitorScriptId)?.rawContent !== target.rawContent) fail("LEGACY_SOURCE_CHANGED");
    return source;
  };
  return {
    reserve<T>(owner: LegacyOwner, target: LegacyScope, body: () => Promise<T>) { return session(owner, target, (tx) => {
      if (process.env.ENABLE_VIDEO_WORKFLOW_WRITES === "true") fail("USE_CONFIGURED_WORKFLOW");
      return withVideoWorkflowTransaction(tx, body);
    }); },
    capture(owner: LegacyOwner, target: LegacySourceScope) { return session(owner, target, (tx, scope) => capture(tx, owner, scope, target)); },
    verify(owner: LegacyOwner, target: LegacySourceScope, expected: string) { return session(owner, target, async (tx, scope) => {
      if ((await capture(tx, owner, scope, target)).sourceHash !== expected) fail("LEGACY_SOURCE_CHANGED");
    }); },
    failCurrent(owner: LegacyOwner, target: LegacySourceScope, expected: string, status: string) {
      return session(owner, target, async (tx, scope) => {
        if (!["failed", "canceled"].includes(status)) fail("LEGACY_STATUS_INVALID");
        if ((await capture(tx, owner, scope, target)).sourceHash !== expected) fail("LEGACY_SOURCE_CHANGED");
        const before = await captureVideoWorkflowTables(tx, scope), script = before.video_scripts[0];
        const statuses = { ...(script.stageStatus as Record<string, unknown>), [VIDEO_WORKFLOW_DEFINITIONS[target.operation].node]: status };
        const updated = await tx.execute(videoWorkflowStatement("UPDATE video_scripts SET version=version+1,stageStatus=?,updatedAt=NOW() WHERE id=? AND projectId=? AND version=?", [videoWorkflowCanonical(statuses), scope.videoScriptId, scope.projectId, script.version]));
        if (!Array.isArray(updated) || updated[0].affectedRows !== 1 || updated[0].warningStatus !== 0) fail("WRITE_UNCONFIRMED");
        await saveVideoWorkflowVersion(tx, before, owner.userId, `Before legacy terminal state: ${target.operation}`);
        await projectVideoWorkflowAgent(tx, { userId: owner.userId, workspaceId: scope.expectedWorkspaceId }, scope, await captureVideoWorkflowTables(tx, scope), false);
      });
    },
    publish<T>(owner: LegacyOwner, target: LegacySourceScope, expected: string, operation: VideoWorkflowOperation, body: () => Promise<T>) {
      return session(owner, target, async (tx, scope) => {
        const frozen = await capture(tx, owner, scope, target); if (frozen.sourceHash !== expected) fail("LEGACY_SOURCE_CHANGED");
        const before = await captureVideoWorkflowTables(tx, scope);
        await saveVideoWorkflowVersion(tx, before, owner.userId, `Before legacy result: ${operation}`);
        const result = await withVideoWorkflowTransaction(tx, body), after = await captureVideoWorkflowTables(tx, scope), currentVersion = after.video_scripts[0].version;
        if (currentVersion !== before.video_scripts[0].version) fail("LEGACY_VERSION_CHANGED");
        const statuses={...(after.video_scripts[0].stageStatus as Record<string,unknown>),[VIDEO_WORKFLOW_DEFINITIONS[operation].node]:"generated"};
        const update = await tx.execute(videoWorkflowStatement("UPDATE video_scripts SET version=version+1,stageStatus=?,updatedAt=NOW() WHERE id=? AND projectId=? AND version=?", [videoWorkflowCanonical(statuses), scope.videoScriptId, scope.projectId, currentVersion]));
        if (!Array.isArray(update) || update[0].affectedRows !== 1 || update[0].warningStatus !== 0) fail("WRITE_UNCONFIRMED");
        const complete = await captureVideoWorkflowTables(tx, scope);
        if (complete.video_scripts[0].version !== Number(currentVersion) + 1) fail("WRITE_UNCONFIRMED");
        await saveVideoWorkflowVersion(tx, complete, owner.userId, `After legacy result: ${operation}`);
        await projectVideoWorkflowAgent(tx, { userId: owner.userId, workspaceId: scope.expectedWorkspaceId }, scope, complete, false);
        return result;
      });
    },
  };
}
export const videoWorkflowLegacyJobBridge = createVideoWorkflowLegacyJobBridge();
