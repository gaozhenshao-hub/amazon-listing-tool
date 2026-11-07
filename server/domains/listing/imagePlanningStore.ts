import { assertResearchEditable } from "./researchLocks";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  clearMainImageAssociations,
  emptyImageOutline,
  imageOutlineSchema,
  type ImageOutline,
} from "../../../shared/imagePlanning";
import { requireDb, type DbExecutor } from "../../repositories/dbClient";
import { recordManualOutline } from "../../../shared/imageOutlineEditing";
export type PlanningScope = {
  projectId: number;
  workspaceId: number;
  userId: number;
  role?: string;
};
export const planningRows = async (
  tx: DbExecutor,
  query: ReturnType<typeof sql>
) => (await tx.execute(query))[0] as Record<string, any>[];
export const planningJson = (v: unknown) =>
  typeof v === "string" ? JSON.parse(v) : v;
export async function lockPlanningProject(
  tx: DbExecutor,
  scope: PlanningScope
) {
  const [project] = await planningRows(
    tx,
    sql`SELECT * FROM projects WHERE id=${scope.projectId} AND workspaceId=${scope.workspaceId} AND userId=${scope.userId} FOR UPDATE`
  );
  if (!project)
    throw new TRPCError({ code: "NOT_FOUND", message: "项目不可访问" });
  return project;
}
export async function readImagePlan(
  scope: PlanningScope,
  executor?: DbExecutor
) {
  const tx = executor || (await requireDb("read image plan"));
  const [row] = await planningRows(
    tx,
    sql`SELECT data,revision,job_run_id FROM listing_image_plans WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId}`
  );
  let data = row
    ? imageOutlineSchema.parse(planningJson(row.data))
    : emptyImageOutline();
  if (row && !data.manualTrackingVersion) {
    const [baseline] = await planningRows(
      tx,
      sql`SELECT id FROM listing_image_plan_candidates WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId} AND status='confirmed' ORDER BY created_at DESC,id DESC LIMIT 1`
    );
    const [original] = baseline
      ? await planningRows(
          tx,
          sql`SELECT data FROM listing_image_plan_candidates WHERE id=${baseline.id}`
        )
      : [];
    data = recordManualOutline(
      original
        ? imageOutlineSchema.parse(planningJson(original.data))
        : emptyImageOutline(),
      data
    );
  }
  return row
    ? {
        data,
        revision: Number(row.revision),
        jobRunId: row.job_run_id as string | null,
      }
    : { data: emptyImageOutline(), revision: 0, jobRunId: null };
}
export async function saveImagePlan(
  scope: PlanningScope,
  revision: number,
  value: ImageOutline,
  executor?: DbExecutor,
  options: {
    generated?: boolean;
    validateOutline?: (data: ImageOutline) => void;
    baseline?: ImageOutline;
  } = {}
) {
  let data = clearMainImageAssociations(imageOutlineSchema.parse(value));
  const write = async (tx: DbExecutor) => {
    await lockPlanningProject(tx, scope);
    const current = await readImagePlan(scope, tx);
    if (current.revision !== revision)
      throw new TRPCError({
        code: "CONFLICT",
        message: "大纲已被其他操作修改，请刷新后再保存",
      });
    data.activeVersionId = current.data.activeVersionId;
    // Legacy reads infer manual-change metadata. Its timestamp can differ on
    // each read; selecting references must not be treated as editing the outline.
    const outlineContent = (plan: ImageOutline) =>
      JSON.stringify({
        groups: plan.groups.map(({ manualFields: _manual, ...g }) => ({
          ...g,
          items: g.items.map(
            ({ references, manualFields, manualChangedAt, ...item }) => item
          ),
        })),
        sourceRevision: plan.sourceRevision,
        sourceHash: plan.sourceHash,
      });
    const referenceContent = (plan: ImageOutline) =>
      JSON.stringify({
        slots: plan.referenceSlots,
        sets: plan.referenceSets,
        pending: plan.pendingAsins,
        // Empty slots and outline ordering do not change any reference selection.
        items: plan.groups
          .flatMap(g => g.items)
          .filter(i => i.references.length)
          .map(i => ({ id: i.id, references: i.references }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      });
    const outlineChanged =
      outlineContent(current.data) !== outlineContent(data);
    if (outlineChanged) {
      await assertResearchEditable(scope, "outline", tx);
      options.validateOutline?.(data);
      data = imageOutlineSchema.parse(data);
    } else {
      // Preserve the authoritative outline, including its manual protections.
      // Reference-only saves also leave upstream links untouched until the
      // operator explicitly synchronizes them on the outline page.
      const references = new Map(
        data.groups.flatMap(g => g.items).map(i => [i.id, i.references])
      );
      data = {
        ...current.data,
        referenceSlots: data.referenceSlots,
        referenceSets: data.referenceSets,
        pendingAsins: data.pendingAsins,
        groups: current.data.groups.map(g => ({
          ...g,
          items: g.items.map(i => ({
            ...i,
            references: references.get(i.id) || [],
          })),
        })),
      };
    }
    if (referenceContent(current.data) !== referenceContent(data))
      await assertResearchEditable(scope, "references", tx);
    if (!options.generated)
      data = recordManualOutline(options.baseline || current.data, data);
    else data.manualTrackingVersion = 1;
    if (!current.revision)
      await tx.execute(
        sql`INSERT INTO listing_image_plans(project_id,workspace_id,data,revision) VALUES(${scope.projectId},${scope.workspaceId},${JSON.stringify(data)},1)`
      );
    else
      await tx.execute(
        sql`UPDATE listing_image_plans SET data=${JSON.stringify(data)},revision=revision+1 WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId}`
      );
    return { data, revision: revision + 1, jobRunId: current.jobRunId };
  };
  return executor
    ? write(executor)
    : (await requireDb("save image plan")).transaction(write);
}
