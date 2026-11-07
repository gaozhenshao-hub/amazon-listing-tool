import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { ImageDocument } from "../../../shared/imageDocument";
import {
  planningReferenceKey,
  planningImageRoleLabel,
  type PlanningImageReference,
} from "../../../shared/planningImageReference";
import { acquisitionReviewHash } from "../../../shared/acquisitionReview";
import { loadAsset } from "../knowledge/assetTargets";
import { createManualKbImageDeliveryGate } from "../acquisition/kbManualImageDelivery";
import { readJson } from "../../../shared/competitorPresentation";
import { resolveStoredObjectUrl } from "../../storage";
import { assertResourceAction } from "../../services/securityGovernance";
import { requireDb } from "../../repositories/dbClient";
import { planningRows, type PlanningScope } from "./imagePlanningStore";
import * as repository from "../../repositories";
export type DocumentMaterial = {
  key: string;
  reference: PlanningImageReference;
  title: string;
  imageUrl: string;
  storageKey?: string;
  imagePosition?: string;
  version: string;
  tags: Record<string, unknown>;
  unavailable?: string;
};
const hash = (value: unknown) =>
  acquisitionReviewHash(JSON.parse(JSON.stringify(value)));
export function documentReferences(data: ImageDocument) {
  return [
    ...new Map(
      data.entries.flatMap(e =>
        Object.values(e.references)
          .flat()
          .map(r => [planningReferenceKey(r.reference), r.reference] as const)
      )
    ).values(),
  ];
}
export async function documentActor(scope: PlanningScope) {
  const [user] = await planningRows(
    await requireDb("read document owner"),
    sql`SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=${scope.userId}`
  );
  if (!user || user.status !== "active")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "当前账号不可使用套图文档",
    });
  return {
    id: Number(user.id),
    role: String(user.role),
    defaultWorkspaceId: Number(user.defaultWorkspaceId),
  };
}
export async function resolveDocumentMaterials(
  scope: PlanningScope,
  references: PlanningImageReference[],
  options: {
    strict?: boolean;
    referenceSetIds?: number[];
    previous?: PlanningImageReference[];
  } = {}
) {
  const unique = [
    ...new Map(references.map(r => [planningReferenceKey(r), r])).values(),
  ];
  if (unique.length > 400)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "参考图片较多，请按模块分别整理",
    });
  const actor = await documentActor(scope);
  await assertResourceAction({
    actor,
    resource: "project",
    action: "read",
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
  });
  let knowledgeAllowed = true;
  try {
    if (unique.some(r => r.source !== "competitor"))
      await assertResourceAction({
        actor,
        resource: "knowledge",
        action: "read",
        workspaceId: scope.workspaceId,
      });
  } catch {
    knowledgeAllowed = false;
  }
  const records = unique.some(r => r.source === "competitor")
      ? await repository.getCompetitorAnalysesByProject(scope.projectId)
      : [],
    gate = createManualKbImageDeliveryGate(scope),
    previous = new Set(options.previous?.map(planningReferenceKey)),
    output: DocumentMaterial[] = [];
  for (const reference of unique) {
    const key = planningReferenceKey(reference);
    try {
      if (reference.source === "competitor") {
        const record = records.find(r => r.id === reference.analysisId),
          raw = readJson(record?.rawData),
          asset = raw?.imageAssets?.find(
            (a: any) =>
              a.sourceUrlHash === reference.hash &&
              a.storageKey &&
              !/video/.test(a.role || "")
          );
        if (!record || !asset) throw new Error("竞品图片已移除或不可读取");
        output.push({
          key,
          reference,
          title: reference.label || record.asin + " · " + planningImageRoleLabel(asset.role),
          imageUrl: await resolveStoredObjectUrl(asset.storageKey),
          storageKey: asset.storageKey,
          imagePosition: asset.role,
          version: hash({
            analysisId: record.id,
            hash: reference.hash,
            storageKey: asset.storageKey,
            snapshotId: raw?.confirmedSnapshotId || null,
          }),
          tags: { asin: record.asin, role: asset.role },
        });
        continue;
      }
      if (!knowledgeAllowed) throw new Error("当前账号没有知识库读取权限");
      if (
        reference.source === "reference" &&
        options.referenceSetIds &&
        !options.referenceSetIds.includes(reference.setId) &&
        !previous.has(key)
      )
        throw new Error("请从当前项目已选的参考套图中选择图片");
      const asset = await loadAsset(
          { ...scope, role: actor.role },
          "image",
          reference.imageId
        ),
        image = asset.images.find(i => i.id === reference.imageId);
      if (!image || (reference.setId && image.imageSetId !== reference.setId))
        throw new Error("图片与套图来源不匹配");
      if (image.imageSetId) await gate.selection([image]);
      output.push({
        key,
        reference,
        title: reference.label || (asset.set?.asin ? asset.set.asin + " · " : "") + asset.title,
        imageUrl: await resolveStoredObjectUrl(image.imageUrl),
        storageKey: image.imageUrl,
        imagePosition: image.imagePosition,
        version: hash({
          id: image.id,
          url: image.imageUrl,
          updatedAt: image.updatedAt || null,
          tags: asset.result,
        }),
        tags: asset.result || {},
      });
    } catch {
      if (options.strict)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "参考图片已移除或暂时无权访问，请重新选择",
        });
      output.push({
        key,
        reference,
        title: reference.label || "参考图片",
        imageUrl: "",
        version: "unavailable",
        tags: {},
        unavailable: "参考图片暂时无法读取，已保留原有选择",
      });
    }
  }
  return output;
}
export const publicDocumentMaterials = (items: DocumentMaterial[]) =>
  items.map(({ storageKey: _storageKey, ...rest }) => rest);
