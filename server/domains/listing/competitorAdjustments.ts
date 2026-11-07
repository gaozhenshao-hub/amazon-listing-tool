import { sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { requireDb, type DbExecutor } from "../../repositories/dbClient";
import {
  competitorStudyFields,
  competitorCurrentValues,
} from "../../../shared/competitorStudyFields";
import { acquisitionReviewHash } from "../../../shared/acquisitionReview";
import {
  listingAggregationSchema,
  emptyListingAggregation,
} from "../../../shared/listingAggregation";
import { richModuleTargets } from "../../../shared/richModuleSellingPoints";
import { createSkillImprovementDraft } from "../ai_os/services/skillWorkbench";
import { runCompetitorSkill } from "./runCompetitorSkill";
import { safeParseSkillJSON } from "../ai_os/services/skillRunner";
import { VIDEO_SKILL } from "./listingSkillPrompts";
import { MEDIA_TRANSLATION_SKILL } from "../knowledge/richContentTranslation";
import { resolveStoredObjectUrl } from "../../storage";
import { updateCompetitorMark } from "./aggregationStore";

export const competitorEditKey = z
  .string()
  .regex(
    /^(title:translation|video:[a-f0-9]{64}:sellingPoints|subtitle:[a-f0-9]{64}:[A-Za-z0-9_-]{1,100}:translation|module:M[a-f0-9]{24}:sellingPoints|image:[a-f0-9]{64}:(translation|sellingPoints)|text:[A-Za-z0-9_-]{1,120}:(translation|sellingPoints)|region:[a-f0-9]{64}:\d+:translation|bullet:\d+:(translation|sellingPoints)|review:\d+:(name|reason|percentage))$/
  );
export const competitorEditSchema = z.object({
  key: competitorEditKey,
  original: z.string().max(30000),
  value: z.string().max(30000),
});
const baselineSchema = z.object({
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  revision: z.number().int().nonnegative(),
});
export const competitorAdjustmentInput = z.object({
  projectId: z.number().int().positive(),
  analysisId: z.number().int().positive(),
  message: z.string().trim().min(1).max(4000),
  target: z.enum(["study", "translation", "video"]).default("study"),
  fieldKeys: z.array(competitorEditKey).max(3000).default([]),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(6000),
      })
    )
    .max(40)
    .default([]),
  proposed: z.array(competitorEditSchema).max(100).default([]),
  baseline: baselineSchema.optional(),
});
export const competitorConfirmationInput = competitorAdjustmentInput
  .omit({ message: true })
  .extend({
    baseline: baselineSchema,
    operationId: z.string().uuid(),
    improve: z.boolean(),
  });
type Scope = { userId: number; workspaceId: number; role?: string };
const parse = (v: any) => (typeof v === "string" ? JSON.parse(v) : v);
const fail = (message = "资料或人工修改已变化，请关闭对话后重新打开") =>
  new TRPCError({ code: "CONFLICT", message });
async function rows(db: DbExecutor, query: ReturnType<typeof sql>) {
  return ((await db.execute(query)) as any)[0] as any[];
}
async function source(
  db: DbExecutor,
  scope: Scope,
  projectId: number,
  analysisId: number,
  lock = false
) {
  const [record] = await rows(
    db,
    sql`SELECT c.rawData,c.asin,c.title,c.bulletPoints FROM competitorAnalyses c JOIN projects p ON p.id=c.projectId WHERE c.id=${analysisId} AND c.projectId=${projectId} AND p.workspaceId=${scope.workspaceId} AND p.userId=${scope.userId}${lock ? sql` FOR UPDATE` : sql``}`
  );
  if (!record)
    throw new TRPCError({ code: "NOT_FOUND", message: "竞品不存在或不可编辑" });
  const raw = parse(record.rawData) || {};
  if (!raw.comparisonAnalysis || raw.analysisStale)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "请先完成当前竞品分析",
    });
  return {
    record,
    raw,
    sourceHash: acquisitionReviewHash({
      study: raw.comparisonAnalysis,
      layout: raw.sourceLayout || null,
      snapshot: raw.confirmedSnapshotId || null,
    }),
  };
}
async function aggregation(
  db: DbExecutor,
  scope: Scope,
  projectId: number,
  lock = false
) {
  const [row] = await rows(
    db,
    sql`SELECT data,revision FROM listing_aggregations WHERE project_id=${projectId} AND workspace_id=${scope.workspaceId}${lock ? sql` FOR UPDATE` : sql``}`
  );
  return {
    data: row
      ? listingAggregationSchema.parse(parse(row.data))
      : emptyListingAggregation(),
    revision: row ? Number(row.revision) : 0,
  };
}
function selectedFields(
  raw: any,
  input: { target: string; fieldKeys: string[] }
) {
  const all = competitorStudyFields(raw.comparisonAnalysis, raw.sourceLayout);
  const fields = Object.fromEntries(
    Object.entries(all)
      .filter(
        ([key]) =>
          (input.target !== "video" || /^(video:|subtitle:)/.test(key)) &&
          (input.target !== "translation" ||
            /^(region:|text:|module:|video:|subtitle:|image:.*:sellingPoints$)/.test(key
            ))
      )
      .filter(
        ([key]) => !input.fieldKeys.length || input.fieldKeys.includes(key)
      )
  );
  if (!Object.keys(fields).length)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "当前模块还没有可以调整的结果",
    });
  return fields;
}
export function validateCompetitorChanges(
  changes: z.infer<typeof competitorEditSchema>[],
  fields: Record<string, string>
) {
  const seen = new Set<string>();
  for (const change of changes) {
    if (fields[change.key] !== change.original || seen.has(change.key))
      throw fail("调整结果引用了已变化、重复或不属于当前模块的字段");
    seen.add(change.key);
    if (
      /^(text:|region:|subtitle:)/.test(change.key) &&
      change.key.endsWith(":translation") &&
      !change.value.trim()
    )
      throw fail("中文翻译不能为空");
    if (/^(module:|video:)/.test(change.key)) {
      const values = change.value
        .split(/[、，,\n]+/)
        .map(v => v.trim())
        .filter(Boolean);
      if (values.length > 12 || values.some(v => v.length > 200))
        throw fail("每个模块最多12个简短卖点");
    }
    if (
      change.key.endsWith(":percentage") &&
      (!change.value.trim() ||
        !Number.isFinite(Number(change.value)) ||
        Number(change.value) < 0 ||
        Number(change.value) > 100)
    )
      throw fail("比例必须在0到100之间");
  }
  return changes;
}
function scopedSources(raw: any, fields: Record<string, string>) {
  const keys = Object.keys(fields),
    rich = raw.comparisonAnalysis.richContent;
  const modules = richModuleTargets(raw.sourceLayout, rich?.images).filter(t =>
    keys.includes(`module:${t.id}:sellingPoints`)
  );
  const hashes = new Set([
    ...modules.flatMap(t => t.imageHashes),
    ...keys.flatMap(k => {
      const m = /^(?:region|image):([a-f0-9]{64}):/.exec(k);
      return m ? [m[1]] : [];
    }),
  ]);
  return {
    modules,
    texts: (rich?.texts || [])
      .filter(
        (t: any) =>
          modules.some(m => m.blocks.some(b => b.id === t.id)) ||
          keys.some(k => k.startsWith(`text:${t.id}:`))
      )
      .map((t: any) => ({ id: t.id, source: t.source })),
    videos: (raw.comparisonAnalysis.videoAnalyses || []).filter(
      (v: any) =>
        modules.some(m => m.videoHashes?.includes(v.hash)) ||
        keys.some(
          k =>
            k.startsWith("video:" + v.hash + ":") ||
            k.startsWith("subtitle:" + v.hash + ":")
        )),
    images: [...hashes].map(hash => ({
      hash,
      observations: raw.comparisonAnalysis.images?.find(
        (i: any) => i.hash === hash
      )?.sellingPoints,
      regions: rich?.images?.find((i: any) => i.sourceHash === hash)?.regions,
    })),
  };
}

export async function adjustCompetitorResult(
  scope: Scope,
  input: z.infer<typeof competitorAdjustmentInput>
) {
  const db = await requireDb("adjust competitor result"),
    data = await source(db, scope, input.projectId, input.analysisId),
    aggregate = await aggregation(db, scope, input.projectId);
  if (
    input.baseline &&
    (input.baseline.sourceHash !== data.sourceHash ||
      input.baseline.revision !== aggregate.revision)
  )
    throw fail();
  const fields = selectedFields(data.raw, input),
    edits =
      aggregate.data.marks.find(m => m.analysisId === input.analysisId)
        ?.edits || {};
  validateCompetitorChanges(input.proposed, fields);
  const sources = scopedSources(data.raw, fields),
    attachments = [];
  const currentValues = competitorCurrentValues(
    data.raw.comparisonAnalysis,
    data.raw.sourceLayout,
    edits
  );
  if (sources.images.length <= 8)
    for (const image of sources.images) {
      const asset = data.raw.imageAssets?.find(
        (a: any) => a.sourceUrlHash === image.hash && a.storageKey
      );
      if (asset)
        attachments.push({
          type: "image_url" as const,
          image_url: { url: await resolveStoredObjectUrl(asset.storageKey) },
        });
    }
  const context = JSON.stringify({
    mode: "adjust",
    asin: data.record.asin,
    fields,
    sources,
    currentEdits: Object.fromEntries(
      Object.entries(fields)
        .filter(([key, value]) => currentValues[key] !== value)
        .map(([key, value]) => [
          key,
          { original: value, value: currentValues[key] },
        ])
    ),
    proposed: input.proposed,
    history: input.history,
    message: input.message,
  });
  const schema = z.object({
    reply: z.string().min(1).max(6000),
    changes: z.array(competitorEditSchema).max(100),
  });
  const response = await runCompetitorSkill({
    skillSlug:
      input.target === "video"
        ? VIDEO_SKILL
        :
      input.target === "translation"
        ? MEDIA_TRANSLATION_SKILL
        : "listing.competitor.study.v2",
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    projectId: input.projectId,
    context,
    variables: { context },
    attachments,
    validate: content => {
      const value = schema.parse(safeParseSkillJSON(content));
      validateCompetitorChanges(value.changes, fields);
      return value;
    },
  });
  const merged = new Map(input.proposed.map(c => [c.key, c]));
  for (const change of response.parsed.changes) merged.set(change.key, change);
  const changes = [...merged.values()].filter(
    c => c.value !== currentValues[c.key]
  );
  return {
    reply: response.parsed.reply,
    changes,
    baseline: { sourceHash: data.sourceHash, revision: aggregate.revision },
  };
}

export async function confirmCompetitorAdjustment(
  scope: Scope,
  input: z.infer<typeof competitorConfirmationInput>,
  executor?: DbExecutor
) {
  const write = async (tx: DbExecutor) => {
    const [parent] = await rows(
      tx,
      sql`SELECT id FROM projects WHERE id=${input.projectId} AND workspaceId=${scope.workspaceId} AND userId=${scope.userId} FOR UPDATE`
    );
    if (!parent)
      throw new TRPCError({ code: "NOT_FOUND", message: "项目不可编辑" });
    const requestHash = acquisitionReviewHash(input);
    if (input.improve) {
      const [receipt] = await rows(
        tx,
        sql`SELECT payload FROM emperor_skill_workbench_drafts WHERE id=${input.operationId} AND workspaceId=${scope.workspaceId} AND userId=${scope.userId} FOR UPDATE`
      );
      if (receipt) {
        let context;
        try {
          context = JSON.parse(parse(receipt.payload).input.context);
        } catch {
          throw fail("本次确认记录已变化，请重新打开对话");
        }
        if (context.requestHash !== requestHash)
          throw fail("本次确认内容已变化，请重新打开对话");
        return { saved: true, improvementId: input.operationId };
      }
    }
    const data = await source(
        tx,
        scope,
        input.projectId,
        input.analysisId,
        true
      ),
      aggregate = await aggregation(tx, scope, input.projectId, true),
      fields = selectedFields(data.raw, input);
    if (data.sourceHash !== input.baseline.sourceHash) throw fail();
    const changes = validateCompetitorChanges(input.proposed, fields);
    if (!changes.length || !input.history.some(m => m.role === "assistant"))
      throw fail("请先与小酷完成调整，再确认保存");
    const edits =
      aggregate.data.marks.find(m => m.analysisId === input.analysisId)
        ?.edits || {};
    const alreadySaved = changes.every(
      c =>
        edits[c.key]?.original === c.original && edits[c.key]?.value === c.value
    );
    if (aggregate.revision !== input.baseline.revision && !alreadySaved)
      throw fail();
    let improvementId: string | undefined;
    if (input.improve) {
      const originalResult = fields;
      const currentResult = competitorCurrentValues(
        data.raw.comparisonAnalysis,
        data.raw.sourceLayout,
        edits
      );
      const beforeResult = Object.fromEntries(
        Object.keys(fields).map(key => [key, currentResult[key]])
      );
      const context = JSON.stringify({
        businessModule: "listing",
        sourceResultId: String(input.analysisId),
        projectId: input.projectId,
        productAsin: data.record.asin,
        input: scopedSources(data.raw, fields),
        originalResult,
        beforeResult,
        editedResult: {
          ...beforeResult,
          ...Object.fromEntries(changes.map(c => [c.key, c.value])),
        },
        feedback: input.history
          .filter(m => m.role === "user")
          .map(m => m.text)
          .join("\n"),
        history: input.history,
        scope: "current_result",
        requestHash,
        operationId: input.operationId,
      });
      if (context.length > 120000)
        throw fail("本次调整资料过多，请按单个模块确认");
      const actor = {
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        admin: ["admin", "super_admin"].includes(scope.role || ""),
        superAdmin: scope.role === "super_admin",
      };
      const draft = await createSkillImprovementDraft(
        actor,
        input.target === "video"
          ? VIDEO_SKILL
          : input.target === "translation"
          ? MEDIA_TRANSLATION_SKILL
          : "listing.competitor.study.v2",
        input.operationId,
        { context, productId: null },
        tx
      );
      improvementId = draft.id;
    }
    if (!alreadySaved)
      await updateCompetitorMark(
        { ...scope, projectId: input.projectId },
        input.analysisId,
        { type: "edits", items: changes.map(c => ({ type: "edit", ...c })) },
        tx
      );
    return { saved: true, improvementId };
  };
  return executor
    ? write(executor)
    : (await requireDb("confirm competitor adjustment")).transaction(write);
}
