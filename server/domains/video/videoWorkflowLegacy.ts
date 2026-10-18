import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { requireDb, type AppDb } from "../../repositories/dbClient";
import type { TrpcContext } from "../../_core/context";
import { assertAssistantRuleConfirmationJournalSchema } from "../ai_os/repositories/assistantRuleConfirmationJournal";
import { authorizeVideoWorkflow } from "./videoWorkflowRepository";
import { withVideoWorkflowTransaction } from "./videoWorkflowTransaction";
import { assertVideoWorkflowSchema, captureVideoWorkflowTables, videoWorkflowRows as rows, videoWorkflowStatement as statement, videoWorkflowFail as fail } from "./videoWorkflowSource";
import { VideoWorkflowIdSchema, videoWorkflowHash, videoWorkflowCanonical } from "../../../shared/videoWorkflow";
import { saveVideoWorkflowVersion } from "./videoWorkflowPublication";
import { projectVideoWorkflowAgent } from "./videoWorkflowAgentProjection";

const generated = new Set(["analyzeCompetitorScript", "generateCompetitorSummary", "extractProductInfo", "generateSections", "generateSubtopics", "generateShots", "generateEditScripts"]);
const childTables: Record<string, string> = { deleteCompetitorScript: "video_competitor_scripts", updateCompetitorScriptEdits: "video_competitor_scripts",
  updateSection: "video_script_sections", updateShot: "video_script_shots", deleteShot: "video_script_shots", updateEditScript: "video_edit_scripts", rollbackVersion: "video_script_versions" };
const stages = ["stage_0a", "stage_0b", "stage_1", "stage_2", "stage_3", "stage_4"];
const stageForRoute: Record<string, string> = { addCompetitorScript: "stage_0a", deleteCompetitorScript: "stage_0a", updateCompetitorScriptEdits: "stage_0a", updateCompetitorSummary: "stage_0a",
  updateProductSnapshot: "stage_0b", updateSection: "stage_1", reorderSections: "stage_1", updateShot: "stage_3", deleteShot: "stage_3", addShot: "stage_3", reorderShots: "stage_3", updateEditScript: "stage_4" };
function reject(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  const value = error && typeof error === "object" && "code" in error ? error.code : "UNAVAILABLE";
  throw new TRPCError({ code: value === "ACCESS_DENIED" ? "FORBIDDEN" : "PRECONDITION_FAILED", message: `VIDEO_WORKFLOW_${typeof value === "string" && /^[A-Z_]{1,100}$/u.test(value) ? value : "UNAVAILABLE"}` });
}
/** The legacy UI keeps its operations, but no request may write a child without
 * fresh parent authority and the same project→script locks as governed apply. */
export async function videoWorkflowLegacyRequest<T>(ctx: TrpcContext, path: string, type: string, raw: unknown, next: () => Promise<T>,
  dependencies: { getDb?: () => Promise<AppDb>; permission?: Parameters<typeof authorizeVideoWorkflow>[4] } = {}): Promise<T> {
  const route = path.split(".").at(-1)!;
  if (["getVideoTypeSpecs", "getVideoTypeSpec", "getFullScript", "exportToExcel"].includes(route) || route.startsWith("workflow")) return next();
  try {
    if (!ctx.user) fail("ACCESS_DENIED");
    const workspaceId = ctx.workspaceId === undefined ? ctx.user.defaultWorkspaceId : ctx.workspaceId;
    if (!VideoWorkflowIdSchema.safeParse(workspaceId).success || !raw || typeof raw !== "object" || Array.isArray(raw)) fail("ACCESS_DENIED");
    const input = raw as Record<string, unknown>;
    if ("expectedWorkspaceId" in input && input.expectedWorkspaceId !== workspaceId) fail("ACCESS_DENIED");
    const db = await (dependencies.getDb ?? (() => requireDb("Video workflow request")))();
    const perform = async (defer: boolean): Promise<T | undefined> => db.transaction(async tx => {
      await assertVideoWorkflowSchema(tx);
      let videoScriptId = input.videoScriptId as number | undefined, projectId = input.projectId as number | undefined;
      const id = input.versionId ?? input.id;
      if (childTables[route]) {
        const table = childTables[route]; if (!VideoWorkflowIdSchema.safeParse(id).success) fail("ACCESS_DENIED");
        const select = table === "video_script_shots" ? "SELECT s.videoScriptId FROM video_script_shots r JOIN video_script_sections s ON s.id=r.sectionId WHERE r.id=?" : `SELECT videoScriptId FROM ${table} WHERE id=?`;
        const found = await rows(tx, select, [id], 1); if (found.length !== 1) fail("ACCESS_DENIED"); videoScriptId = Number(found[0].videoScriptId);
      } else if (input.competitorScriptId !== undefined) {
        const found = await rows(tx, "SELECT videoScriptId FROM video_competitor_scripts WHERE id=?", [input.competitorScriptId], 1); if (found.length !== 1) fail("ACCESS_DENIED"); videoScriptId = Number(found[0].videoScriptId);
      } else if (input.subtopicId !== undefined) {
        const found = await rows(tx, "SELECT s.videoScriptId,s.id AS sectionId FROM video_script_subtopics r JOIN video_script_sections s ON s.id=r.sectionId WHERE r.id=?", [input.subtopicId], 1);
        if (found.length !== 1 || input.sectionId !== undefined && input.sectionId !== found[0].sectionId) fail("ACCESS_DENIED"); videoScriptId = Number(found[0].videoScriptId);
      } else if (["getById", "update", "delete"].includes(route)) videoScriptId = Number(input.id);
      if (videoScriptId !== undefined) {
        if (!VideoWorkflowIdSchema.safeParse(videoScriptId).success) fail("ACCESS_DENIED");
        const found = await rows(tx, "SELECT projectId FROM video_scripts WHERE id=?", [videoScriptId], 1);
        if (found.length !== 1 || projectId !== undefined && projectId !== found[0].projectId) fail("ACCESS_DENIED"); projectId = Number(found[0].projectId);
      }
      if (!VideoWorkflowIdSchema.safeParse(projectId).success) fail("ACCESS_DENIED");
      const identity = { userId: ctx.user!.id, workspaceId: Number(workspaceId) }, scope = { expectedWorkspaceId: Number(workspaceId), projectId: projectId!, videoScriptId };
      const actor = await authorizeVideoWorkflow(tx, identity, scope, type === "query" ? "read" : generated.has(route) ? "run" : route === "confirmStage" ? "confirm" : "update", dependencies.permission);
      if (generated.has(route)) {
        if (process.env.ENABLE_VIDEO_WORKFLOW_WRITES === "true") fail("USE_CONFIGURED_WORKFLOW");
        const active = await rows(tx, "SELECT id FROM ai_jobs WHERE kind='video.workflow.configured.v1' AND workspaceId=? AND projectId=? AND JSON_EXTRACT(input,'$.request.videoScriptId')=? AND (status IN ('queued','running') OR JSON_UNQUOTE(JSON_EXTRACT(output,'$.state'))='outcome_unknown') LIMIT 1 FOR SHARE", [workspaceId, projectId, videoScriptId], 1);
        if (active.length) fail("ACTIVE_OPERATION_EXISTS"); return undefined;
      }
      if (defer) return undefined;
      const exactScope = videoScriptId === undefined ? null : { ...scope, videoScriptId };
      const before = exactScope ? await captureVideoWorkflowTables(tx, exactScope) : null;
      if (before && childTables[route] && !before[childTables[route]]?.some(row => row.id === id) && route !== "rollbackVersion") fail("ACCESS_DENIED");
      if (before && input.subtopicId !== undefined && !before.video_script_subtopics.some(row => row.id === input.subtopicId && (input.sectionId === undefined || row.sectionId === input.sectionId))) fail("ACCESS_DENIED");
      if (before && input.sectionIds !== undefined && (!Array.isArray(input.sectionIds) || videoWorkflowHash([...input.sectionIds].sort()) !== videoWorkflowHash(before.video_script_sections.map(row => row.id).sort()))) fail("REORDER_SCOPE_INVALID");
      if (before && input.shotIds !== undefined && (!Array.isArray(input.shotIds) || videoWorkflowHash([...input.shotIds].sort()) !== videoWorkflowHash(before.video_script_shots.filter(row => row.subtopicId === input.subtopicId).map(row => row.id).sort()))) fail("REORDER_SCOPE_INVALID");
      if (before && route === "confirmStage") {
        const stage = String(input.stage), index = stages.indexOf(stage), statuses = before.video_scripts[0].stageStatus as Record<string, unknown>;
        if (index < 0 || index >= 2 && statuses[stages[index - 1]] !== "confirmed") fail("HUMAN_UPSTREAM_REQUIRED");
        const table = ["video_competitor_scripts", "video_product_snapshots", "video_script_sections", "video_script_subtopics", "video_script_shots", "video_edit_scripts"][index];
        if (!before[table].length) fail("HUMAN_CONTENT_REQUIRED");
      }
      if (before && route === "advanceStage") {
        const from = stages.indexOf(String(input.fromStage)), to = input.toStage === "completed" ? stages.length : stages.indexOf(String(input.toStage));
        if (from < 0 || to !== from + 1 || (before.video_scripts[0].stageStatus as Record<string, unknown>)[String(input.fromStage)] !== "confirmed") fail("HUMAN_UPSTREAM_REQUIRED");
      }
      const deletedVersion = before && route === "delete" ? await saveVideoWorkflowVersion(tx, before, identity.userId, "Before explicit script deletion") : null;
      const result = await withVideoWorkflowTransaction(tx, next);
      if (result && typeof result === "object" && "ok" in result && result.ok === false && "error" in result) throw result.error;
      if (type === "mutation" && before && exactScope && route === "delete") {
        const remains = await rows(tx, "SELECT id FROM video_scripts WHERE id=? FOR UPDATE", [videoScriptId], 1);
        if (remains.length) fail("WRITE_UNCONFIRMED");
        const operationId = randomUUID(), metadata = videoWorkflowCanonical({ version: 1, operationId, scope: exactScope, route, beforeHash: videoWorkflowHash(before), deletedVersion });
        const saved = await tx.execute(statement("INSERT INTO security_audit_logs (auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,projectId,status,riskLevel,metadata) VALUES (?,?,?,?,'video.workflow.manual','video_workflow',?,?,'success','medium',?)", [`vidw_man_${videoWorkflowHash({ identity, operationId })}`, workspaceId, identity.userId, actor.role, String(videoScriptId), projectId, metadata]));
        if (!Array.isArray(saved) || saved[0].affectedRows !== 1 || saved[0].warningStatus !== 0) fail("WRITE_UNCONFIRMED");
      }
      if (type === "mutation" && before && exactScope && route !== "delete") {
        await assertAssistantRuleConfirmationJournalSchema(tx);
        const after = await captureVideoWorkflowTables(tx, exactScope);
        if (videoWorkflowHash(before) !== videoWorkflowHash(after) || route === "confirmStage") {
          const script = after.video_scripts[0], statuses = { ...(script.stageStatus as Record<string, unknown>) };
          if (!["confirmStage", "createVersion", "advanceStage", "rollbackVersion"].includes(route)) {
            const stage = stageForRoute[route], from = stage ? stages.indexOf(stage) : 0;
            for (const item of stages.slice(from)) statuses[item] = "stale";
          }
          const currentVersion = Number(script.version), nextVersion = Math.max(Number(before.video_scripts[0].version) + 1, currentVersion);
          const update = await tx.execute(statement("UPDATE video_scripts SET version=?,stageStatus=?,updatedAt=NOW() WHERE id=? AND projectId=? AND version=?", [nextVersion, videoWorkflowCanonical(statuses), videoScriptId, projectId, currentVersion]));
          if (!Array.isArray(update) || update[0].affectedRows !== 1 || update[0].warningStatus !== 0) fail("WRITE_UNCONFIRMED");
          const final = await captureVideoWorkflowTables(tx, exactScope), operationId = randomUUID(), body = { schema: "video-workflow-full-version/v1", tables: before, afterTables: final };
          await projectVideoWorkflowAgent(tx, identity, exactScope, final, route === "confirmStage",
            route === "confirmStage" ? input.stage as keyof typeof import("./videoWorkflowDag").VIDEO_STAGE_NODE_MAP : undefined);
          if (Buffer.byteLength(videoWorkflowCanonical(body)) > 8 * 1024 * 1024) fail("VERSION_LIMIT");
          const saved = await tx.execute(statement("INSERT INTO video_script_versions (videoScriptId,version,versionNote,snapshotData,createdBy) VALUES (?,?,?,?,?)", [videoScriptId, before.video_scripts[0].version, `Before ${route}`, videoWorkflowCanonical(body), identity.userId]));
          if (!Array.isArray(saved) || saved[0].affectedRows !== 1 || saved[0].warningStatus !== 0) fail("WRITE_UNCONFIRMED");
          const metadata = videoWorkflowCanonical({ version: 1, operationId, scope: exactScope, route, beforeHash: videoWorkflowHash(before), afterHash: videoWorkflowHash(final), versionId: saved[0].insertId });
          const audit = await tx.execute(statement("INSERT INTO security_audit_logs (auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,projectId,status,riskLevel,metadata) VALUES (?,?,?,?,'video.workflow.manual','video_workflow',?,?,'success','medium',?)", [`vidw_man_${videoWorkflowHash({ identity, operationId })}`, workspaceId, identity.userId, actor.role, String(videoScriptId), projectId, metadata]));
          if (!Array.isArray(audit) || audit[0].affectedRows !== 1 || audit[0].warningStatus !== 0) fail("WRITE_UNCONFIRMED");
        }
      }
      return result;
    });
    if (generated.has(route)) { await perform(true); return next(); }
    return (await perform(false))!;
  } catch (error) { return reject(error); }
}
