import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  clearMainImageAssociations,
  imageOutlineSchema,
  type ImageOutline,
} from "../../../shared/imagePlanning";
import {
  emptyImageDocument,
  imageDocumentSchema,
} from "../../../shared/imageDocument";
import { hasOutlineResult } from "../../../shared/imageOutlineEditing";
import { requireDb, type DbExecutor } from "../../repositories/dbClient";
import {
  lockPlanningProject,
  planningJson,
  planningRows,
  readImagePlan,
  type PlanningScope,
} from "./imagePlanningStore";
import { readImageDocument, synchronizeDocument } from "./imageDocumentStore";
import { researchLocks, setResearchLock } from "./researchLocks";

const archiveSchema = z.object({
  outline: imageOutlineSchema,
  document: imageDocumentSchema,
  locked: z.boolean(),
  candidateId: z.string().uuid().nullable(),
});

function outlineText(outline: ImageOutline) {
  return outline.groups
    .map(group => {
      const heading = [group.family, group.moduleType, group.title]
        .filter((part, index, parts) => part && parts.indexOf(part) === index)
        .join(" · ");
      return [
        heading,
        group.brief && group.brief !== group.title ? group.brief : "",
        ...group.items.map((item, index) => {
          const label = `${index + 1}. ${item.title || "图片"}`;
          const size =
            item.width && item.height
              ? `（${item.width} × ${item.height}）`
              : "";
          return `${label}${size}\n${item.content}`.trimEnd();
        }),
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

export async function imageOutlineVersions(scope: PlanningScope) {
  const db = await requireDb("list image outline versions");
  return db.transaction(async tx => {
    const current = await readImagePlan(scope, tx);
    const rows = await planningRows(
      tx,
      sql`SELECT id,data,mode,created_at FROM listing_image_plan_candidates
          WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId}
            AND user_id=${scope.userId} AND status='version'
          ORDER BY (mode='legacy') DESC,created_at,id`
    );
    const versions = rows.map(row => ({
      id: String(row.id) as string | null,
      legacy: row.mode === "legacy",
      selected: current.data.activeVersionId === row.id,
      text: outlineText(imageOutlineSchema.parse(planningJson(row.data))),
    }));
    if (!current.data.activeVersionId && hasOutlineResult(current.data))
      versions.unshift({
        id: null,
        legacy: true,
        selected: true,
        text: outlineText(current.data),
      });
    const [job] = current.jobRunId
      ? await planningRows(
          tx,
          sql`SELECT status,progress FROM ai_jobs WHERE runId=${current.jobRunId}
          AND projectId=${scope.projectId} AND workspaceId=${scope.workspaceId} AND userId=${scope.userId}`
        )
      : [];
    return {
      revision: current.revision,
      versions,
      job: job
        ? { status: String(job.status), progress: Number(job.progress) }
        : null,
    };
  });
}

async function assertIdle(tx: DbExecutor, scope: PlanningScope) {
  const [job] = await planningRows(
    tx,
    sql`SELECT runId FROM ai_jobs
        WHERE projectId=${scope.projectId} AND workspaceId=${scope.workspaceId}
          AND userId=${scope.userId} AND status IN ('queued','running')
          AND kind IN ('listing.images.outline','listing.images.document') LIMIT 1`
  );
  const [image] = await planningRows(
    tx,
    sql`SELECT p.image_id FROM listing_image_productions p
        WHERE p.project_id=${scope.projectId} AND p.workspace_id=${scope.workspaceId}
          AND p.user_id=${scope.userId}
          AND (
            EXISTS (SELECT 1 FROM design_generations g WHERE g.workspaceId=p.workspace_id AND g.userId=p.user_id
                AND g.deletedAt IS NULL AND g.status IN ('queued','submitting','running')
                AND JSON_SEARCH(p.data,'one',g.conversationId,NULL,'$.stages.*.conversationId') IS NOT NULL)
            OR EXISTS (SELECT 1 FROM design_chat_turns c WHERE c.workspaceId=p.workspace_id AND c.userId=p.user_id
                AND c.status IN ('queued','submitting')
                AND JSON_SEARCH(p.data,'one',c.conversationId,NULL,'$.stages.*.conversationId') IS NOT NULL)
          ) LIMIT 1`
  );
  if (job || image)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "当前图片任务还在执行，完成后再切换大纲版本",
    });
}

export async function useImageOutlineVersion(
  scope: PlanningScope,
  id: string,
  revision: number
) {
  return (await requireDb("select image outline version")).transaction(
    async tx => {
      await lockPlanningProject(tx, scope);
      const current = await readImagePlan(scope, tx);
      if (current.data.activeVersionId === id)
        return { revision: current.revision };
      if (current.revision !== revision)
        throw new TRPCError({
          code: "CONFLICT",
          message: "图片大纲已有更新，请刷新后选择版本",
        });
      const [target] = await planningRows(
        tx,
        sql`SELECT id,data,selection FROM listing_image_plan_candidates
          WHERE id=${id} AND project_id=${scope.projectId} AND workspace_id=${scope.workspaceId}
            AND user_id=${scope.userId} AND status='version' FOR UPDATE`
      );
      if (!target)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "图片大纲版本不存在",
        });
      await assertIdle(tx, scope);
      const previous = await readImageDocument(scope, tx);
      const previousLock = !!(await researchLocks(scope, tx)).outline;
      const [pending] = await planningRows(
        tx,
        sql`SELECT id FROM listing_image_document_candidates
          WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId}
            AND user_id=${scope.userId} AND status='open' ORDER BY created_at DESC,id DESC LIMIT 1`
      );
      // The selection JSON of a version row stores its last workspace snapshot.
      // Legacy open candidates continue using the original selection schema.
      const archive = JSON.stringify({
        outline: current.data,
        document: previous.data,
        locked: previous.locked || previousLock,
        candidateId: pending?.id || null,
      });
      if (current.data.activeVersionId) {
        await tx.execute(
          sql`UPDATE listing_image_plan_candidates SET selection=${archive}
            WHERE id=${current.data.activeVersionId} AND project_id=${scope.projectId}
              AND workspace_id=${scope.workspaceId} AND user_id=${scope.userId} AND status='version'`
        );
      } else if (hasOutlineResult(current.data) || previous.data.organized) {
        const legacyId = randomUUID();
        const data = JSON.stringify(current.data);
        await tx.execute(
          sql`INSERT INTO listing_image_plan_candidates
            (id,project_id,workspace_id,user_id,base_revision,source_hash,mode,selection,original_data,input_data,data,history,reply,status)
            VALUES(${legacyId},${scope.projectId},${scope.workspaceId},${scope.userId},${current.revision},
            ${current.data.sourceHash || ""},'legacy',${archive},${data},'{}',${data},'[]','原有大纲','version')`
        );
      }
      const saved = target.selection
        ? archiveSchema.parse(planningJson(target.selection))
        : null;
      const source =
        saved?.outline ?? imageOutlineSchema.parse(planningJson(target.data));
      const { referenceSlots, referenceSets, pendingAsins } = current.data;
      const outline = clearMainImageAssociations(
        imageOutlineSchema.parse({
          ...source,
          activeVersionId: id,
          manualTrackingVersion: 1,
          referenceSlots,
          referenceSets,
          pendingAsins,
          groups: source.groups.map(group => ({
            ...group,
            items: group.items.map(item => ({
              ...item,
              references: item.references.filter(ref =>
                referenceSets.includes(ref.setId)
              ),
            })),
          })),
        })
      );
      const document = synchronizeDocument(
        saved?.document ?? emptyImageDocument(),
        outline
      );
      const locked = saved?.locked ?? false;
      await tx.execute(
        sql`UPDATE listing_image_plans SET data=${JSON.stringify(outline)},revision=revision+1,job_run_id=NULL
          WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId}`
      );
      if (previous.revision)
        await tx.execute(
          sql`UPDATE listing_image_documents SET data=${JSON.stringify(document)},revision=revision+1,
            locked=${locked},job_run_id=NULL WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId}`
        );
      else
        await tx.execute(
          sql`INSERT INTO listing_image_documents(project_id,workspace_id,data,revision,locked)
            VALUES(${scope.projectId},${scope.workspaceId},${JSON.stringify(document)},1,${locked})`
        );
      if (previousLock !== locked)
        await setResearchLock(scope, "outline", locked, tx);
      await tx.execute(
        sql`UPDATE listing_image_document_candidates SET status='version_archived'
          WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId}
            AND user_id=${scope.userId} AND status='open'`
      );
      if (saved?.candidateId)
        await tx.execute(
          sql`UPDATE listing_image_document_candidates SET status='open'
            WHERE id=${saved.candidateId} AND project_id=${scope.projectId} AND workspace_id=${scope.workspaceId}
              AND user_id=${scope.userId} AND status='version_archived'`
        );
      return { revision: current.revision + 1 };
    }
  );
}
