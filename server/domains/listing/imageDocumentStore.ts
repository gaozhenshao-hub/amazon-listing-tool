import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { acquisitionReviewHash } from "../../../shared/acquisitionReview";
import {
  imageDocumentSchema,
  emptyImageDocument,
  recordManualDocument,
  documentOutlineFingerprint,
  makeDocumentEntry,
  type ImageDocument,
} from "../../../shared/imageDocument";
import type { ImageOutline } from "../../../shared/imagePlanning";
import { setResearchLock } from "./researchLocks";
import { documentForOutline } from "../../../shared/modulePlanning";
import { planningReferenceKey } from "../../../shared/planningImageReference";
import { requireDb, type DbExecutor } from "../../repositories/dbClient";
import {
  lockPlanningProject,
  planningRows,
  planningJson,
  readImagePlan,
  type PlanningScope,
} from "./imagePlanningStore";
export const outlineDocumentHash = (outline: ImageOutline) =>
  acquisitionReviewHash(
    JSON.parse(
      JSON.stringify({
        groups: outline.groups.map(g => ({
          ...g,
          items: g.items.map(({ manualFields, manualChangedAt, ...i }) => i),
        })),
        referenceSets: outline.referenceSets,
      })
    )
  );
export function synchronizeDocument(
  data: ImageDocument,
  outline: ImageOutline
) {
  const next = documentForOutline(data, outline),
    entries = new Map(next.entries.map(e => [e.imageId, e]));
  for (const group of outline.groups)
    for (const item of group.items) {
      const current = entries.get(item.id),
        fingerprint = acquisitionReviewHash(documentOutlineFingerprint(item));
      if (!current) {
        const entry = makeDocumentEntry(
          item,
          !(group.family === "品牌故事" && group.moduleType === "轮播背景")
        );
        entry.outlineFingerprint = fingerprint;
        next.entries.push(entry);
        continue;
      }
      if (current.outlineFingerprint !== fingerprint)
        for (const key of ["title", "content", "width", "height"] as const)
          if (!current.manualFields?.includes(key))
            (current as any)[key] = item[key] ?? "";
      current.outlineFingerprint = fingerprint;
      if (!current.manualFields?.includes("references.composition"))
        for (const ref of makeDocumentEntry(item).references.composition) {
          if (
            !current.references.composition.some(
              r =>
                planningReferenceKey(r.reference) ===
                planningReferenceKey(ref.reference)
            ) &&
            current.references.composition.length < 20
          )
            current.references.composition.push(ref);
        }
    }
  next.sourceOutlineHash = outlineDocumentHash(outline);
  return imageDocumentSchema.parse(next);
}
export const documentConflict = () =>
  new TRPCError({
    code: "CONFLICT",
    message: "套图文档或上一步资料已更新，请刷新后重试，避免覆盖人工修改",
  });
export function assertDocumentEditable(value: { locked: boolean }) {
  if (value.locked)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "套图文档已锁定，请先点击编辑解锁",
    });
}
export async function readImageDocument(scope: PlanningScope, tx?: DbExecutor) {
  const db = tx || (await requireDb("read image document")),
    [row] = await planningRows(
      db,
      sql`SELECT data,revision,locked,job_run_id FROM listing_image_documents WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId}`
    );
  if (row)
    return {
      data: imageDocumentSchema.parse(planningJson(row.data)),
      revision: Number(row.revision),
      locked: !!row.locked,
      jobRunId: row.job_run_id as string | null,
    };
  const plan = await readImagePlan(scope, db),
    data = synchronizeDocument(emptyImageDocument(plan.data), plan.data);
  return { data, revision: 0, locked: false, jobRunId: null };
}
export async function saveImageDocument(
  scope: PlanningScope,
  expectedRevision: number,
  incoming: ImageDocument,
  executor?: DbExecutor,
  options: { generated?: boolean; baseline?: ImageDocument; acceptPreview?: boolean } = {}
) {
  const value = imageDocumentSchema.parse(incoming),
    write = async (tx: DbExecutor) => {
      await lockPlanningProject(tx, scope);
      const current = await readImageDocument(scope, tx);
      if (!options.acceptPreview) assertDocumentEditable(current);
      if (current.revision !== expectedRevision) throw documentConflict();
      const plan = await readImagePlan(scope, tx),
        allowed = new Set([
          ...plan.data.groups.flatMap(g => g.items.map(i => i.id)),
          ...current.data.entries.map(e => e.imageId),
        ]);
      if (value.entries.some(e => !allowed.has(e.imageId)))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "图片已不属于当前大纲，请同步后重试",
        });
      const data = options.generated
          ? value
          : recordManualDocument(options.baseline || current.data, value),
        encoded = JSON.stringify(data);
      if (current.revision)
        await tx.execute(
          sql`UPDATE listing_image_documents SET data=${encoded},revision=revision+1 WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId}`
        );
      else
        await tx.execute(
          sql`INSERT INTO listing_image_documents(project_id,workspace_id,data,revision) VALUES(${scope.projectId},${scope.workspaceId},${encoded},1)`
        );
      return { ...current, data, revision: current.revision + 1 };
    };
  return executor
    ? write(executor)
    : (await requireDb("save image document")).transaction(write);
}
export async function lockImageDocument(
  scope: PlanningScope,
  expectedRevision: number,
  locked: boolean
) {
  return (await requireDb("lock image document")).transaction(async tx => {
    await lockPlanningProject(tx, scope);
    const current = await readImageDocument(scope, tx);
    if (current.revision !== expectedRevision) throw documentConflict();
    await setResearchLock(scope, "outline", locked, tx);
    if (!current.revision)
      await tx.execute(
        sql`INSERT INTO listing_image_documents(project_id,workspace_id,data,revision,locked) VALUES(${scope.projectId},${scope.workspaceId},${JSON.stringify(current.data)},1,${locked})`
      );
    else
      await tx.execute(
        sql`UPDATE listing_image_documents SET locked=${locked},revision=revision+1 WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId}`
      );
    return { ...current, locked, revision: current.revision + 1 };
  });
}
