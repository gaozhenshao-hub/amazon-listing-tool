import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { Router } from "express";
import {
  defaultDesignParams,
  designOptions,
} from "../../../shared/designStudio";
import type { DocumentEntry } from "../../../shared/imageDocument";
import {
  compositionSketchInput,
  compositionSketchPrompt,
} from "../../../shared/compositionSketch";
import { acquisitionReviewHash } from "../../../shared/acquisitionReview";
import { designModel } from "../design/provider";
import { assetDirectory, assetBytes } from "../design/assets";
import { createContext } from "../../_core/context";
import { getProjectById } from "../../repositories";
import {
  assertResourceAction,
  actorFromContext,
} from "../../services/securityGovernance";
import { requireDb } from "../../repositories/dbClient";
import {
  lockPlanningProject,
  planningRows,
  type PlanningScope,
} from "./imagePlanningStore";
import {
  readImageDocument,
  assertDocumentEditable,
  documentConflict,
} from "./imageDocumentStore";
const hashEntry = (entry: DocumentEntry) =>
  acquisitionReviewHash(compositionSketchInput(entry));
const aspectRatio = (entry: DocumentEntry) =>
  designOptions.aspect_ratio
    .filter(([r]) => r !== "auto" && !["1:4", "4:1", "1:8", "8:1"].includes(r))
    .map(([r]) => ({
      r,
      d: Math.abs(
        Math.log(
          Number(r.split(":")[0]) /
            Number(r.split(":")[1]) /
            (entry.width / entry.height)
        )
      ),
    }))
    .sort((a, b) => a.d - b.d)[0].r;
export async function queueCompositionSketch(
  scope: PlanningScope,
  input: {
    entry: DocumentEntry;
    revision: number;
    candidateId?: string;
    requestId?: string;
    retry?: boolean;
  }
) {
  const entry = input.entry;
  if (entry.references.composition.length)
    throw new TRPCError({ code: "BAD_REQUEST", message: "已有构图参考；只有找不到合适参考图时，才手动生成布局线框" });
  if (
    !entry.width ||
    !entry.height ||
    !entry.layout ||
    !entry.layoutNote.trim()
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "请先填写图片尺寸、构图方式和区域安排",
    });
  const model = await designModel(scope);
  await assetDirectory();
  const db = await requireDb("queue composition sketch"),
    inputHash = hashEntry(entry);
  return db.transaction(async tx => {
    await lockPlanningProject(tx, scope);
    const current = await readImageDocument(scope, tx);
    assertDocumentEditable(current);
    if (current.revision !== input.revision) throw documentConflict();
    if (
      !input.candidateId &&
      !current.data.entries.some(
        e => e.imageId === entry.imageId && hashEntry(e) === inputHash
      )
    )
      throw documentConflict();
    const [previous] = await planningRows(
      tx,
      sql`SELECT s.id,s.generation_id,g.status FROM listing_image_composition_sketches s JOIN design_generations g ON g.id=s.generation_id WHERE s.workspace_id=${scope.workspaceId} AND s.project_id=${scope.projectId} AND s.user_id=${scope.userId} AND s.image_id=${entry.imageId} AND s.input_hash=${inputHash} ORDER BY s.created_at DESC,s.id DESC LIMIT 1`
    );
    if (
      previous &&
      (!input.retry || !["failed", "unknown"].includes(previous.status))
    )
      return { id: String(previous.id) };
    if (previous?.status === "unknown")
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "上次提交结果尚未确认，请先检查进度，避免重复生成",
      });
    const [pending] = await planningRows(
      tx,
      sql`SELECT COUNT(*) n FROM listing_image_composition_sketches s JOIN design_generations g ON g.id=s.generation_id WHERE s.workspace_id=${scope.workspaceId} AND s.user_id=${scope.userId} AND g.status IN ('queued','submitting','running')`
    );
    if (Number(pending.n) >= 60)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "已有较多布局草图等待生成，请稍后再试",
      });
    const id = randomUUID(),
      generationId = randomUUID(),
      conversationId = randomUUID(),
      params = {
        ...defaultDesignParams,
        resolution: "1K",
        aspect_ratio: aspectRatio(entry),
        quality: "low",
        planningSketch: { projectId: scope.projectId, imageId: entry.imageId },
      };
    await tx.execute(
      sql`INSERT INTO design_conversations(id,workspaceId,userId,title,kind) VALUES(${conversationId},${scope.workspaceId},${scope.userId},${("布局草图 · " + entry.title).slice(0, 120)},'layout')`
    );
    await tx.execute(
      sql`INSERT INTO design_generations(id,conversationId,workspaceId,userId,requestId,prompt,params,referenceIds,providerId) VALUES(${generationId},${conversationId},${scope.workspaceId},${scope.userId},${input.requestId || randomUUID()},${compositionSketchPrompt(entry)},${JSON.stringify(params)},'[]',${model.id})`
    );
    await tx.execute(
      sql`INSERT INTO listing_image_composition_sketches(id,project_id,workspace_id,user_id,image_id,input_hash,generation_id,source_revision,candidate_id) VALUES(${id},${scope.projectId},${scope.workspaceId},${scope.userId},${entry.imageId},${inputHash},${generationId},${input.revision},${input.candidateId || null})`
    );
    return { id };
  });
}
export async function compositionSketchStatus(scope: PlanningScope) {
  const rows = await planningRows(
    await requireDb("composition sketch status"),
    sql`SELECT s.id,s.image_id,s.input_hash,s.generation_id,g.status,g.progress,g.assetIds,g.providerTaskId FROM listing_image_composition_sketches s JOIN design_generations g ON g.id=s.generation_id AND g.workspaceId=s.workspace_id AND g.userId=s.user_id WHERE s.workspace_id=${scope.workspaceId} AND s.project_id=${scope.projectId} AND s.user_id=${scope.userId} ORDER BY s.created_at DESC,s.id DESC LIMIT 120`
  );
  return rows.map(row => {
    const assets =
      typeof row.assetIds === "string"
        ? JSON.parse(row.assetIds)
        : row.assetIds;
    return {
      id: String(row.id),
      imageId: String(row.image_id),
      inputHash: String(row.input_hash),
      status: String(row.status),
      progress: Number(row.progress || 0),
      url:
        row.status === "succeeded" && assets?.length
          ? `/api/listing/composition-sketches/${scope.projectId}/${row.id}`
          : "",
      canCheck: row.status === "unknown" && !!row.providerTaskId,
    };
  });
}
export async function checkCompositionSketch(scope: PlanningScope, id: string) {
  const db = await requireDb("check sketch progress"),
    [row] = await planningRows(
      db,
      sql`SELECT generation_id FROM listing_image_composition_sketches WHERE id=${id} AND project_id=${scope.projectId} AND workspace_id=${scope.workspaceId} AND user_id=${scope.userId}`
    );
  if (!row)
    throw new TRPCError({ code: "NOT_FOUND", message: "布局草图不存在" });
  await db.execute(
    sql`UPDATE design_generations SET status='running',errorText=NULL,nextPollAt=NOW(3),submittedAt=NOW(3) WHERE id=${row.generation_id} AND workspaceId=${scope.workspaceId} AND userId=${scope.userId} AND status='unknown' AND providerTaskId IS NOT NULL`
  );
  return { ok: true };
}
export const compositionSketchHttp = Router();
compositionSketchHttp.get("/:projectId/:id", async (req, res) => {
  try {
    const projectId = Number(req.params.projectId),
      id = req.params.id,
      ctx = await createContext({ req, res } as any);
    if (
      !ctx.user ||
      !ctx.workspaceId ||
      !Number.isSafeInteger(projectId) ||
      !/^[-a-f0-9]{36}$/.test(id) ||
      !(await getProjectById(projectId, ctx.user.id, ctx.workspaceId))
    )
      return void res.sendStatus(404);
    await assertResourceAction({
      actor: actorFromContext(ctx),
      workspaceId: ctx.workspaceId,
      projectId,
      resource: "project",
      action: "read",
    });
    const [row] = await planningRows(
      await requireDb("read composition sketch asset"),
      sql`SELECT g.assetIds FROM listing_image_composition_sketches s JOIN design_generations g ON g.id=s.generation_id AND g.workspaceId=s.workspace_id AND g.userId=s.user_id WHERE s.id=${id} AND s.project_id=${projectId} AND s.workspace_id=${ctx.workspaceId} AND s.user_id=${ctx.user.id} AND g.status='succeeded'`
    );
    const assets =
      typeof row?.assetIds === "string"
        ? JSON.parse(row.assetIds)
        : row?.assetIds;
    if (!assets?.[0]) return void res.sendStatus(404);
    const [asset] = await planningRows(
      await requireDb("read owned sketch bytes"),
      sql`SELECT * FROM design_assets WHERE id=${assets[0]} AND workspaceId=${ctx.workspaceId} AND userId=${ctx.user.id}`
    );
    if (!asset) return void res.sendStatus(404);
    res
      .set("Content-Type", asset.mime)
      .set("X-Content-Type-Options", "nosniff")
      .set("Cache-Control", "private, no-store")
      .send(await assetBytes(asset));
  } catch {
    res.status(404).json({ error: "布局草图暂时无法读取" });
  }
});
