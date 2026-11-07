import { RESEARCH_SKILLS } from "./researchPrompts";
import { assertResearchEditable } from "./researchLocks";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  listingAggregationSchema,
  emptyListingAggregation,
  type ListingAggregation,
} from "../../../shared/listingAggregation";
import { acquisitionReviewHash } from "../../../shared/acquisitionReview";
import { readJson } from "../../../shared/competitorPresentation";
import { requireDb, type DbExecutor } from "../../repositories/dbClient";
import * as repository from "../../repositories";
import { runCompetitorSkill } from "./runCompetitorSkill";
import { safeParseSkillJSON } from "../ai_os/services/skillRunner";
import { createSkillImprovementDraft } from "../ai_os/services/skillWorkbench";
import { collectAggregationSources } from "./aggregationSources";
import {
  readListingAggregation,
  saveListingAggregation,
} from "./aggregationStore";
import { AGGREGATION_SKILL } from "./generateListingAggregation";
const historySchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      text: z.string().max(6000),
    })
  )
  .max(40);
const baselineSchema = z.object({
  revision: z.number().int().nonnegative(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const aggregationAdjustmentInput = z.object({
  section:z.enum(["selling","reviews","questions"]).optional(),
  projectId: z.number().int().positive(),
  data: listingAggregationSchema,
  message: z.string().trim().min(1).max(4000),
  history: historySchema.default([]),
  baseline: baselineSchema.optional(),
});
export const aggregationConfirmationInput = z.object({
  section:z.enum(["selling","reviews","questions"]).optional(),
  projectId: z.number().int().positive(),
  data: listingAggregationSchema,
  baseline: baselineSchema,
  history: historySchema,
  operationId: z.string().uuid(),
  improve: z.boolean(),
});
type Scope = { workspaceId: number; userId: number; role?: string };
const fail = (message = "项目资料或人工修改已更新，请重新打开调整对话") =>
  new TRPCError({ code: "CONFLICT", message });
const rows = async (tx: DbExecutor, query: ReturnType<typeof sql>) =>
  (await tx.execute(query))[0] as any[];
const hashSource = (project: any, records: any[]) =>
  acquisitionReviewHash({
    product: {
      name: project.productName,
      features: project.productFeatures,
      specs: project.productSpecs,
    },
    records: records
      .map(r => {
        const raw = readJson(r.rawData) || {};
        return {
          id: r.id,
          asin: r.asin,
          study: raw.comparisonAnalysis,
          layout: raw.sourceLayout,
          stale: raw.analysisStale || false,
        };
      })
      .sort((a, b) => a.id - b.id),
  });
export function aggregationAdjustmentFields(data: ListingAggregation) {
  const fields: Record<string, string> = {};
  for (const kind of [
    "features",
    "selling",
    "reviews",
    "questions",
    "links",
  ] as const)
    for (const node of data[kind] || []) {
      const names =
        kind === "links"
          ? ["featureId", "benefitId", "note"]
          : kind === "features" || kind === "selling"
            ? ["text", "note", "group", "category", "badges", "comparisonScope"]
            : kind === "questions" ? ["text","note","answer","category"] : ["text", "note", "category"];
      for (const field of names) {
        const value = (node as any)[field];
        fields[kind + ":" + node.id + ":" + field] = Array.isArray(value)
          ? value.join("、")
          : String(value ?? "");
      }
    }
  return fields;
}
export function applyAggregationChanges(
  data: ListingAggregation,
  changes: Array<{ key: string; original: string; value: string }>
) {
  const fields = aggregationAdjustmentFields(data),
    next = structuredClone(data),
    seen = new Set<string>();
  for (const change of changes) {
    if (fields[change.key] !== change.original || seen.has(change.key))
      throw new Error("调整引用了不存在、重复或已变化的字段");
    seen.add(change.key);
    const [kind, id, field] = change.key.split(":"),
      node = ((next as any)[kind] || []).find((n: any) => n.id === id);
    node[field] =
      field === "badges"
        ? change.value
            .split(/[、，,]/)
            .map(v => v.trim())
            .filter(Boolean)
        : change.value;
    if (
      ["features", "selling", "links"].includes(kind) &&
      change.value !== change.original
    )
      node.manual = true;
  }
  return listingAggregationSchema.parse(next);
}
export async function adjustAggregationResult(
  scope: Scope,
  input: z.infer<typeof aggregationAdjustmentInput>
) {
  await assertResearchEditable({...scope,projectId:input.projectId},input.section || ["selling","reviews","questions"]);
  const project = await repository.getProjectById(
    input.projectId,
    scope.userId,
    scope.workspaceId
  );
  if (!project || project.workspaceId !== scope.workspaceId)
    throw new TRPCError({ code: "NOT_FOUND", message: "项目不可访问" });
  const current = await readListingAggregation({
      ...scope,
      projectId: input.projectId,
    }),
    records = await repository.getCompetitorAnalysesByProject(input.projectId),
    sourceHash = hashSource(project, records);
  if (
    input.baseline &&
    (input.baseline.revision !== current.revision ||
      input.baseline.sourceHash !== sourceHash)
  )
    throw fail();
  const sources = collectAggregationSources(project, records, input.data),
    fields = Object.fromEntries(Object.entries(aggregationAdjustmentFields(input.data)).filter(([key])=>!input.section || (input.section==="selling" ? ["features","selling","links"] : [input.section]).includes(key.split(":")[0])));
  const context = JSON.stringify({
    mode: "adjust",
    fields,
    history: input.history,
    message: input.message,
    sources: {
      product: sources.product,
      selling: sources.selling.map(({ id, text, evidence }) => ({
        id,
        text,
        origins: evidence.map(e => ({
          asin: e.asin,
          kind: e.kind,
          basis: e.basis,
        })),
      })),
      reviews: sources.reviews.map(({ reviewIds, evidence, ...r }) => ({
        ...r,
        count: reviewIds.length,
      })),
    },
  });
  if (context.length > 1000000)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "项目资料较多，请分模块调整",
    });
  const schema = z.object({
    reply: z.string().min(1).max(6000),
    changes: z
      .array(
        z.object({
          key: z.string(),
          original: z.string().max(6000),
          value: z.string().max(6000),
        })
      )
      .max(100),
  });
  const result = (
    await runCompetitorSkill({
      skillSlug: AGGREGATION_SKILL,
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      projectId: input.projectId,
      context,
      variables: { context },
      validate: content => {
        const parsed = schema.parse(safeParseSkillJSON(content));
        if(parsed.changes.some(c=>fields[c.key]===undefined))throw new Error("只能调整当前板块的字段");
        applyAggregationChanges(input.data, parsed.changes);
        return parsed;
      },
    })
  ).parsed;
  return {
    reply: result.reply,
    data: applyAggregationChanges(input.data, result.changes),
    baseline: { revision: current.revision, sourceHash },
  };
}
export async function confirmAggregationResult(
  scope: Scope,
  input: z.infer<typeof aggregationConfirmationInput>,
  executor?: DbExecutor
) {
  const write = async (tx: DbExecutor) => {
    const [project] = await rows(
      tx,
      sql`SELECT * FROM projects WHERE id=${input.projectId} AND workspaceId=${scope.workspaceId} AND userId=${scope.userId} FOR UPDATE`
    );
    if (!project)
      throw new TRPCError({ code: "NOT_FOUND", message: "项目不可编辑" });
    const requestHash = acquisitionReviewHash(input);
    const [stored] = await rows(
      tx,
      sql`SELECT data,revision FROM listing_aggregations WHERE project_id=${input.projectId} AND workspace_id=${scope.workspaceId} FOR UPDATE`
    );
    const current = {
      data: stored
        ? listingAggregationSchema.parse(readJson(stored.data))
        : emptyListingAggregation(),
      revision: stored ? Number(stored.revision) : 0,
    };
    if (input.improve) {
      const [receipt] = await rows(
        tx,
        sql`SELECT payload FROM emperor_skill_workbench_drafts WHERE id=${input.operationId} AND workspaceId=${scope.workspaceId} AND userId=${scope.userId} FOR UPDATE`
      );
      if (receipt) {
        const payload = readJson(receipt.payload),
          context = readJson(payload?.input?.context);
        if (context?.requestHash !== requestHash)
          throw fail("本次确认内容已变化，请重新打开对话");
        return { ...current, improvementId: input.operationId };
      }
    }
    const records = await rows(
      tx,
      sql`SELECT id,asin,title,bulletPoints,rawData FROM competitorAnalyses WHERE projectId=${input.projectId} FOR SHARE`
    );
    if (hashSource(project, records) !== input.baseline.sourceHash)
      throw fail();
    const same =
      acquisitionReviewHash(current.data) === acquisitionReviewHash(input.data);
    if (current.revision !== input.baseline.revision && !same) throw fail();
    if (!input.history.some(m => m.role === "assistant"))
      throw fail("请先完成对话调整");
    let improvementId: string | undefined;
    if (input.improve) {
      const sources = collectAggregationSources(project, records, input.data);
      const originalResult: Record<string, unknown> = {},
        editedResult: Record<string, unknown> = {},
        changedEvidence: any[] = [],
        changedReviews = new Set<string>();
      for (const key of [
        "features",
        "selling",
        "links",
        "reviews",
        "questions",
      ] as const) {
        const before = current.data[key] || [],
          after = input.data[key] || [],
          ids = new Set([...before.map(n => n.id), ...after.map(n => n.id)]);
        const changed = [...ids].filter(
          id =>
            acquisitionReviewHash(before.find(n => n.id === id) || null) !==
            acquisitionReviewHash(after.find(n => n.id === id) || null)
        );
        const clean = (n: any) => {
          const { evidence, ...value } = n;
          if (evidence) {
            changedEvidence.push(...evidence);
            if (key === "reviews")
              evidence.forEach((r: any) =>
                changedReviews.add(r.analysisId + ":" + r.groupIndex)
              );
          }
          return value;
        };
        originalResult[key] = before
          .filter(n => changed.includes(n.id))
          .map(clean);
        editedResult[key] = after
          .filter(n => changed.includes(n.id))
          .map(clean);
      }
      const inputEvidence = [
        ...new Map(changedEvidence.map(e => [JSON.stringify(e), e])).values(),
      ];
      const context = JSON.stringify({
        businessModule: "listing",
        sourceResultId: "project-" + input.projectId,
        projectId: input.projectId,
        input: {
          product: sources.product,
          sourceEvidence: inputEvidence,
          reviewThemes: sources.reviews.filter(r =>
            changedReviews.has(
              r.evidence.analysisId + ":" + r.evidence.groupIndex
            )
          ),
        },
        originalResult,
        editedResult,
        feedback: input.history
          .filter(m => m.role === "user")
          .map(m => m.text)
          .join("\n"),
        history: input.history,
        scope: "current_result",
        requestHash,
        baseline: input.baseline,
      });
      if (context.length > 120000)
        throw fail("本次改进内容较多，请分批调整后用于改进");
      const draft = await createSkillImprovementDraft(
        {
          workspaceId: scope.workspaceId,
          userId: scope.userId,
          admin: ["admin", "super_admin"].includes(scope.role || ""),
          superAdmin: scope.role === "super_admin",
        },
        input.section ? RESEARCH_SKILLS[input.section] : AGGREGATION_SKILL,
        input.operationId,
        { context, productId: null },
        tx
      );
      improvementId = draft.id;
    }
    const saved = same
      ? current
      : await saveListingAggregation(
          { ...scope, projectId: input.projectId },
          current.revision,
          input.data,
          tx
        );
    return { ...saved, improvementId };
  };
  return executor
    ? write(executor)
    : (await requireDb("confirm aggregation adjustment")).transaction(write);
}
