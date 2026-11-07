import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  documentEditableFields,
  emptyImageDocument,
  imageDocumentSchema,
  type ImageDocument,
} from "../../../shared/imageDocument";
import { IMAGE_COPY_LIMIT_FIELDS, imageCopyLimitsSchema } from "../../../shared/imageCopyLimits";
import { clearMainImageAssociations, isWhiteBackgroundMain } from "../../../shared/imagePlanning";
import { planningReferenceKey } from "../../../shared/planningImageReference";
import { requireDb, type DbExecutor } from "../../repositories/dbClient";
import {
  getAiJobRun,
  registerAiJobHandler,
  startRegisteredAiJob,
  updateAiJobProgress,
  type AiJobSnapshot,
} from "../../services/aiJobRunner";
import {
  lockPlanningProject,
  planningRows,
  planningJson,
  type PlanningScope,
} from "./imagePlanningStore";
import {
  assertDocumentEditable,
  documentConflict,
  readImageDocument,
  saveImageDocument,
  synchronizeDocument,
} from "./imageDocumentStore";
import {
  imageDocumentConfiguration,
  imageDocumentContext,
} from "./imageDocumentContext";
import {
  documentReferences,
  publicDocumentMaterials,
} from "./imageDocumentMaterials";
import { IMAGE_DOCUMENT_COPY_RULES, IMAGE_DOCUMENT_SKILL } from "./imageDocumentPrompt";
import {
  ensureImageDocumentAgent,
  imageDocumentAgentContext,
} from "./imageDocumentAgent";
import {
  markBusinessManagedNodeRunning,
  markBusinessManagedNodeWaitingHuman,
  markBusinessManagedNodeFailed,
  markBusinessManagedNodeConfirmed,
} from "../ai_os/services/businessManagedAgent";
import { runCompetitorSkill } from "./runCompetitorSkill";
import { safeParseSkillJSON } from "../ai_os/services/skillRunner";
import {
  parseGeneratedDocument,
  parseAdjustedDocument,
} from "./imageDocumentResult";
import {
  applyCopyRepairs,
  copyRepairRequest,
  findCopyRepairs,
  ImageCopyLimitError,
  imageCopyLimitIssue,
} from "./imageDocumentCopyRepair";
import {
  documentModelSources,
  assertDocumentProductClaims,
  documentGenerationReply,
} from "./imageDocumentFacts";
import { planningVisuals } from "./imagePlanningSources";
import { taggingUnitPreview } from "../knowledge/taggingUnitPreview";

import { researchLocks } from "./researchLocks";

import { reviewDocumentCandidate } from "./imageDocumentReview";
import type { MessageContent } from "../../_core/llm";
import { imageCopyForProduction, imagePromptSourceHash } from "../../../shared/imageProduction";
const documentHistorySchema = z
  .array(
    z
      .object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(12000),
      })
      .strict()
  )
  .max(200);

export const imageDocumentStartSchema = z
  .object({
    projectId: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    mode: z.enum(["generate", "adjust", "prompts", "promptSuite"]),
    imageId: z.string().uuid().optional(),
    stage: z
      .enum(["scene", "product", "composition", "interaction", "textIcons"])
      .optional(),
    message: z.string().trim().max(4000).default(""),
    candidateId: z.string().uuid().optional(),
    preserveManual: z.boolean().optional(),
    copyLimits: imageCopyLimitsSchema.optional(),
  })
  .strict();
const jobSchema = imageDocumentStartSchema
  .extend({
    workspaceId: z.number().int().positive(),
    userId: z.number().int().positive(),
    sourceHash: z.string(),
    configurationRevision: z.number(),
    candidateId: z.string().uuid(),
    previousCandidateId: z.string().uuid().optional(),
    agentRunId: z.string().min(1),
    agentNodeId: z.literal("document"),
  })
  .passthrough();
const active = (job: { status: string } | null | undefined) =>
  !!job && ["queued", "running"].includes(job.status);
async function candidate(scope: PlanningScope, id: string, tx?: DbExecutor) {
  const [row] = await planningRows(
    tx || (await requireDb("document candidate")),
    sql`SELECT * FROM listing_image_document_candidates WHERE id=${id} AND project_id=${scope.projectId} AND workspace_id=${scope.workspaceId} AND user_id=${scope.userId}`
  );
  if (!row)
    throw new TRPCError({ code: "NOT_FOUND", message: "套图文档预览不存在" });
  return {
    id: String(row.id),
    status: String(row.status),
    source_hash: String(row.source_hash),
    reply: String(row.reply),
    image_id: row.image_id as string | null,
    stage: row.stage as string | null,
    mode: row.mode as "generate" | "adjust" | "prompts" | "promptSuite",
    improvement_id: row.improvement_id as string | null,
    input_data: row.input_data,
    baseRevision: Number(row.base_revision),
    configurationRevision: Number(row.configuration_revision),
    data: imageDocumentSchema.parse(planningJson(row.data)),
    original: imageDocumentSchema.parse(planningJson(row.original_data)),
    history: documentHistorySchema.parse(planningJson(row.history)),
  };
}
const isPromptPreview = (mode: string) => mode === "prompts" || mode === "promptSuite";

function sameScope(job: AiJobSnapshot | null, scope: PlanningScope) {
  return (
    !!job &&
    job.workspaceId === scope.workspaceId &&
    job.userId === scope.userId &&
    job.projectId === scope.projectId
  );
}
export async function startImageDocument(
  scope: PlanningScope,
  input: z.infer<typeof imageDocumentStartSchema>
) {
  const current = await readImageDocument(scope);
  assertDocumentEditable(current);
  if (current.revision !== input.revision) throw documentConflict();
  const context = await imageDocumentContext(scope, current.data),
    configured = await imageDocumentConfiguration(scope);
  if (!context.plan.data.groups.some(g => g.items.some(i => i.content.trim())))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "请先填写或确认图片大纲，再制作套图文档",
    });
  if (current.data.sourceOutlineHash !== context.outlineHash)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "请先同步最新大纲，再整理套图文档",
    });
  if (
    !["generate", "promptSuite"].includes(input.mode) &&
    (!input.imageId || !input.message)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "请选择图片并填写调整意见",
    });
  if (input.mode === "generate" && input.preserveManual === undefined && current.data.organized && !input.message)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "请说明希望怎样改进套图文档",
    });
  if (input.mode === "prompts" && !input.stage)
    throw new TRPCError({ code: "BAD_REQUEST", message: "请选择提示词步骤" });
  if (input.mode === "promptSuite" && !current.data.organized)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "请先确认图片内容，再生成制作提示词",
    });
  if (
    input.imageId &&
    !context.plan.data.groups.some(g =>
      g.items.some(i => i.id === input.imageId)
    )
  )
    throw documentConflict();
  if (
    current.data.entries.some(e =>
      e.references.other.some(r => !r.purpose.trim())
    )
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "请补充其他参考的参考目的，再让小L整理",
    });
  if (input.candidateId) {
    const previous = await candidate(scope, input.candidateId);
    if (
      previous.status !== "open" ||
      reviewDocumentCandidate(previous, current.data, context).stale
    )
      throw documentConflict();
  }
  const agent = await ensureImageDocumentAgent(scope);
  return (await requireDb("start document task")).transaction(async tx => {
    await lockPlanningProject(tx, scope);
    const latest = await readImageDocument(scope, tx);
    assertDocumentEditable(latest);
    if (latest.revision !== input.revision || !latest.revision)
      throw documentConflict();
    const previous = latest.jobRunId
      ? await getAiJobRun(latest.jobRunId)
      : null;
    if (sameScope(previous, scope) && active(previous))
      return { runId: previous!.runId };
    const job = await startRegisteredAiJob({
      runId: "image-document-" + randomUUID(),
      kind: "listing.images.document",
      module: "listing",
      procedure: "imageDocument.start",
      ...scope,
      skillSlug: IMAGE_DOCUMENT_SKILL,
      queueName: "analysis",
      timeoutSeconds: 1800,
      maxAttempts: 1,
      input: {
        ...input,
        ...scope,
        previousCandidateId: input.candidateId,
        candidateId: randomUUID(),
        sourceHash: context.sourceHash,
        configurationRevision: configured!.revision,
        ...agent,
        agentRunId: agent.agentRunId,
        agentNodeId: agent.agentNodeId,
      },
    });
    await tx.execute(
      sql`UPDATE listing_image_documents SET job_run_id=${job.runId} WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId}`
    );
    return { runId: job.runId };
  });
}

export async function executeImageDocument(
  snapshot: AiJobSnapshot,
  signal: AbortSignal
) {
  const job = jobSchema.parse({
      ...(snapshot.input as any),
      workspaceId: snapshot.workspaceId,
      userId: snapshot.userId,
      projectId: snapshot.projectId,
    }),
    scope: PlanningScope = job;
  const current = await readImageDocument(scope),
    context = await imageDocumentContext(scope, current.data),
    configured = (await imageDocumentConfiguration(scope))!;
  assertDocumentEditable(current);
  if (
    current.revision !== job.revision ||
    context.sourceHash !== job.sourceHash ||
    configured.revision !== job.configurationRevision
  )
    throw documentConflict();
  let base = current.data,
    history: z.infer<typeof documentHistorySchema> = [];
  if (job.previousCandidateId) {
    const previous = await candidate(scope, job.previousCandidateId);
    const review = reviewDocumentCandidate(previous, current.data, context);
    if (previous.status !== "open" || review.stale) throw documentConflict();
    base = review.data;
    history = previous.history;
  }
  if (job.mode === "generate" && job.preserveManual === false) {
    const fresh = synchronizeDocument(emptyImageDocument(context.plan.data), context.plan.data);
    const previous = new Map(base.entries.map(entry => [entry.imageId, entry]));
    base = {
      ...fresh,
      entries: fresh.entries.map(entry => {
        const saved = previous.get(entry.imageId);
        return saved ? {
          ...entry,
          width: saved.width,
          height: saved.height,
          references: saved.references,
          prompts: saved.prompts,
          promptSourceHash: saved.promptSourceHash,
          manualFields: saved.manualFields?.filter(key =>
            key === "width" || key === "height" || key.startsWith("references.") || key.startsWith("prompts.")
          ),
        } : entry;
      }),
    };
  }
  if (history.length > 194)
    throw new Error("本次对话较长，请先确认或取消预览，再继续调整");
  const outlines = clearMainImageAssociations(context.plan.data).groups.flatMap(g =>
      g.items.map(i => ({
        ...i,
        family: g.family,
        moduleType: g.moduleType,
        moduleBrief: g.brief || g.title,
        moduleNumbers: g.moduleNumbers,
      }))
    ),
    selected = outlines.filter(i => !job.imageId || i.id === job.imageId);
  const batches = ["generate", "promptSuite"].includes(job.mode)
    ? Array.from({ length: Math.ceil(selected.length / 3) }, (_, i) =>
        selected.slice(i * 3, i * 3 + 3)
      )
    : [selected];
  const skillExecution = {
    skillSlug: IMAGE_DOCUMENT_SKILL,
    ...scope,
    modelOverride: configured.config.modelSlug || undefined,
    expectedSkillVersion: configured.snapshot.version,
    expectedSkillManifestHash: configured.snapshot.manifestHash,
    expectedSkillStatus: "Released",
    skillVersionPolicy: "snapshot",
    signal,
  } as const;
  const visuals = await planningVisuals(scope),
    replies: string[] = [],
    requests: unknown[] = [];
  const ownEvidence = visuals.images
    .map((info, index) => ({ info, attachment: visuals.attachments[index] }))
    .filter(v => v.info.asin === "本品")
    .slice(0, 4);
  for (const [batchIndex, batch] of batches.entries()) {
    signal.throwIfAborted();
    const imageIds = batch.map(item => item.id);
    const entries = base.entries.filter(e =>
        batch.some(i => i.id === e.imageId)
      ),
      refKeys = new Set(
        documentReferences({ ...base, entries }).map(planningReferenceKey)
      ),
      materials = context.materials.filter(m => refKeys.has(m.key));
    const attachments: MessageContent[] = ownEvidence.map(v => v.attachment),
      visualEvidence: Array<Record<string, unknown>> = ownEvidence.map(v => ({
        ...v.info,
        kind: "本品实拍",
      }));
    for (const material of materials.filter(m => m.storageKey).slice(0, 6))
      try {
        const image = await taggingUnitPreview({
          primary: {
            id: 0,
            imageUrl: material.storageKey!,
            imagePosition: "main",
          },
          images: [
            { id: 0, imageUrl: material.storageKey!, imagePosition: "main" },
          ],
          complete: true,
        });
        attachments.push({
          type: "image_url",
          image_url: {
            url: "data:image/jpeg;base64," + image.toString("base64"),
          },
        });
        visualEvidence.push({
          key: material.key,
          title: material.title,
          kind: "运营指定参考",
        });
      } catch {
        /* The evidence list below explicitly marks unattached originals. */
      }
    const fields = Object.fromEntries(
      Object.entries(documentEditableFields(base)).filter(([key]) =>
        job.mode === "promptSuite"
          ? entries.some(e => key.startsWith(`image:${e.imageId}:prompts.`))
          : job.mode === "prompts"
            ? key === `image:${job.imageId}:prompts.${job.stage}`
            : key.startsWith(`image:${job.imageId}:`)
      )
    );
    const request = {
      mode: job.mode,
      message: job.message,
      stage: job.stage,
      history: history.slice(-20),
      historyCompacted: history.length > 20,
      upstream: documentModelSources(context.sources.input),
      knowledgeTags: context.tags,
      selectedReferenceSets: context.referenceSets,
      global: {
        category: base.category,
        styles: base.styles,
        palette: base.palette,
        protected: base.manualFields,
      },
      selectedEntries: job.mode === "promptSuite" || job.mode === "prompts"
        ? entries.map(entry => ({ ...entry, copy: imageCopyForProduction(entry.copy) }))
        : entries,
      copyRules: IMAGE_DOCUMENT_COPY_RULES,
      copyLimits: job.mode === "generate" ? job.copyLimits : undefined,
      outline: batch,
      fields: job.mode === "generate" ? undefined : fields,
      ...(job.mode === "promptSuite"
        ? {
            outputContract: {
              reply: "说明本批提示词已整理，等待运营确认",
              changes: Object.entries(fields)
                .filter(([, field]) => !field.protected)
                .map(([key, field]) => ({
                  key,
                  original: field.value,
                  value: "填写该字段的独立制作提示词，不是说明性占位文本",
                })),
              requirements:
                "逐张返回整体构图、背景场景、产品嵌入、交互光影、文字图标五段。图片图位即使不需要产品或文字，也明确写出不添加；保留受保护字段。只返回reply和changes，不返回entries或整份文档。",
            },
          }
        : {}),
      materials: materials.map(
        ({ storageKey: _key, imageUrl: _url, ...m }) => ({
          ...m,
          attached: visualEvidence.some(v => v.key === m.key),
        })
      ),
      visualEvidence,
      note: "附件顺序对应visualEvidence；其余原图未附，不声称已看到。参考图只影响声明用途，不移植竞品能力。人工字段保留。",
      assistant: {
        instructions: configured.config.instructions,
        rules: configured.config.rules,
        binding: configured.config.skills.find(
          s => s.slug === IMAGE_DOCUMENT_SKILL
        )?.instructions,
      },
    };
    const encoded = JSON.stringify(request);
    if (encoded.length > 180000)
      throw new Error("本批资料较多，请先按单张图片整理");
    requests.push(request);
    let validationHint = "",
      lastOutput: unknown;
    const result = await runCompetitorSkill(
      {
        ...skillExecution,
        context: encoded,
        variables: { context: encoded },
        attachments,
        validate(text) {
          try {
            lastOutput = safeParseSkillJSON(text);
            const parsed =
              job.mode === "generate"
                ? parseGeneratedDocument(
                    lastOutput,
                    base,
                    imageIds,
                    context.tags,
                    new Map(batch.map(item => [
                      item.id,
                      { whiteMain: isWhiteBackgroundMain(item) },
                    ]))
                  )
                : parseAdjustedDocument(lastOutput, base, fields);
            if (job.mode === "promptSuite")
              for (const entry of parsed.data.entries.filter(
                e =>
                  batch.some(i => i.id === e.imageId) &&
                  e.width > 0 &&
                  e.height > 0
              ))
                if (
                  Object.values(entry.prompts).some(value => !value.trim()) ||
                  !entry.prompts.interaction?.trim()
                )
                  throw new Error(
                    "请完整生成整体构图、背景场景、产品嵌入、交互光影、文字图标五段提示词；无须产品或文字的步骤也应明确说明保持空白或不添加。"
                  );
            assertDocumentProductClaims(
              parsed.data,
              context.sources.input,
              base,
              imageIds
            );
            return parsed;
          } catch (error) {
            validationHint =
              error instanceof z.ZodError
                ? error.issues
                    .slice(0, 12)
                    .map(i => i.path.join(".") + ": " + i.message)
                    .join("; ")
                : error instanceof Error
                  ? error.message
                  : "格式不正确";
            throw error;
          }
        },
      },
      (_error, _attempt, retry) => {
        const repair = JSON.stringify({
          ...request,
          previousOutput: lastOutput,
          correction: "仅修正结构错误，保留已正确内容：" + validationHint,
        });
        retry.context = repair;
        retry.variables = { context: repair };
        retry.attachments = [];
        validationHint = "";
      },
      { validationFailed: () => !!validationHint }
    ).catch(error => {
      if (validationHint)
        throw new Error(`图片输出格式或事实校验未通过：${validationHint}`, {
          cause: error,
        });
      throw error;
    });
    let batchData = result.parsed.data;
    if (job.mode === "generate" && job.copyLimits) {
      const repairs = findCopyRepairs(batchData, imageIds, job.copyLimits);
      if (repairs.length) {
        const repair = copyRepairRequest(batchData, repairs);
        const original = batchData;
        let correction = "";
        const repairContext = () => JSON.stringify({ mode: "repairCopy", ...repair, correction });
        const encodedRepair = repairContext();
        batchData = (await runCompetitorSkill({
          ...skillExecution,
          context: encodedRepair,
          variables: { context: encodedRepair },
          validate(text) {
            try {
              const fixed = applyCopyRepairs(safeParseSkillJSON(text), original, repair);
              assertDocumentProductClaims(fixed, context.sources.input, base, imageIds);
              return fixed;
            } catch (error) {
              const issue = imageCopyLimitIssue(error instanceof Error ? error.message : null);
              correction = issue
                ? `${IMAGE_COPY_LIMIT_FIELDS[issue.field]}仍超限，请遵守各字段的 limit`
                : error instanceof Error && !(error instanceof z.ZodError)
                  ? error.message
                  : "请完整返回指定字段及中文译文，遵守输出格式";
              throw error;
            }
          },
        }, (_error, _attempt, retry) => {
          retry.context = repairContext();
          retry.variables = { context: retry.context };
        }, { validationFailed: () => !!correction }).catch(error => {
          signal.throwIfAborted();
          if (correction) throw new ImageCopyLimitError(repairs[0]);
          throw error;
        })).parsed;
      }
    }
    const unified = {
      category: base.category,
      styles: base.styles,
      palette: base.palette,
    };
    base = batchData;
    if (job.mode === "generate" && batchIndex > 0) Object.assign(base, unified);
    replies.push(result.parsed.reply);
    await updateAiJobProgress(
      snapshot.runId,
      Math.min(95, 10 + Math.round((80 * (batchIndex + 1)) / batches.length)),
      {
        expectedAttempt: snapshot.attempt,
        expectedWorkerId: snapshot.lockedBy || undefined,
      }
    );
  }
  const reply =
    job.mode === "generate"
      ? documentGenerationReply(
          selected.length,
          base,
          selected.map(i => i.id),
          job.preserveManual !== false
        )
      : replies
          .join("\n")
          .slice(0, 12000)
          .replace(
            /\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi,
            "该图"
          )
          .replace(/[（(][a-f0-9]{8}[）)]/gi, "");
  if (job.mode === "promptSuite")
    for (const entry of base.entries.filter(e =>
      selected.some(i => i.id === e.imageId)
    ))
      entry.promptSourceHash = imagePromptSourceHash(entry, base);
  history = documentHistorySchema.parse([
    ...history,
    { role: "user", text: job.message || "按当前大纲制作套图文档" },
    { role: "assistant", text: reply },
  ]);
  signal.throwIfAborted();
  const finalContext = await imageDocumentContext(scope, current.data);
  if (
    finalContext.sourceHash !== job.sourceHash ||
    finalContext.configurationRevision !== job.configurationRevision
  )
    throw documentConflict();
  if (job.mode === "generate") base.sourceContextHash = job.sourceHash;
  await (
    await requireDb("persist document preview")
  ).transaction(async tx => {
    await lockPlanningProject(tx, scope);
    const latest = await readImageDocument(scope, tx);
    assertDocumentEditable(latest);
    if (latest.revision !== job.revision || latest.jobRunId !== snapshot.runId)
      throw documentConflict();
    const [owned] = await planningRows(
      tx,
      sql`SELECT status,attempt,lockedBy FROM ai_jobs WHERE runId=${snapshot.runId} AND workspaceId=${scope.workspaceId} AND userId=${scope.userId} AND projectId=${scope.projectId} FOR UPDATE`
    );
    if (
      !owned ||
      owned.status !== "running" ||
      Number(owned.attempt) !== snapshot.attempt ||
      owned.lockedBy !== snapshot.lockedBy
    )
      throw documentConflict();
    signal.throwIfAborted();
    await tx.execute(
      sql`UPDATE listing_image_document_candidates SET status='superseded' WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId} AND user_id=${scope.userId} AND status='open'`
    );
    await tx.execute(
      sql`INSERT INTO listing_image_document_candidates(id,project_id,workspace_id,user_id,base_revision,source_hash,configuration_revision,mode,image_id,stage,job_run_id,original_data,input_data,data,history,reply) VALUES(${job.candidateId},${scope.projectId},${scope.workspaceId},${scope.userId},${job.revision},${job.sourceHash},${job.configurationRevision},${job.mode},${job.imageId || null},${job.stage || null},${snapshot.runId},${JSON.stringify(current.data)},${JSON.stringify(requests)},${JSON.stringify(base)},${JSON.stringify(history)},${reply})`
    );
  });
  return { candidateId: job.candidateId };
}
registerAiJobHandler({
  id: "listing-image-document",
  match: job => job.kind === "listing.images.document",
  handler: async (job, { signal }) => {
    const input = jobSchema.parse({
        ...(job.input as any),
        workspaceId: job.workspaceId,
        userId: job.userId,
        projectId: job.projectId,
      }),
      agent = await imageDocumentAgentContext(input.agentRunId, input),
      tracking = { ...agent, aiJobRunId: job.runId, aiJobAttempt: job.attempt, allowJobReplacement: true };
    await markBusinessManagedNodeRunning(tracking);
    try {
      const output = await executeImageDocument(job, signal);
      await markBusinessManagedNodeWaitingHuman({ ...tracking, output });
      return output;
    } catch (error) {
      await markBusinessManagedNodeFailed({
        ...tracking,
        finalAttempt: true,
        errorMessage: error instanceof Error ? error.message : "套图文档未完成",
      }).catch(() => null);
      throw error;
    }
  },
});

export async function imageDocumentStatus(scope: PlanningScope) {
  const current = await readImageDocument(scope),
    context = await imageDocumentContext(scope, current.data),
    job = current.jobRunId ? await getAiJobRun(current.jobRunId) : null;
  const [row] = await planningRows(
      await requireDb("latest document preview"),
      sql`SELECT id FROM listing_image_document_candidates WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId} AND user_id=${scope.userId} AND status='open' ORDER BY created_at DESC,id DESC LIMIT 1`
    ),
    draft = row ? await candidate(scope, row.id) : null,
    review = draft && isPromptPreview(draft.mode)
      ? reviewDocumentCandidate(draft, current.data, context)
      : null;
  const copyIssue = sameScope(job, scope) && job?.status === "failed"
    ? imageCopyLimitIssue(job.error)
    : null;
  const issueGroup = copyIssue && context.plan.data.groups.find(
    group => group.items.some(item => item.id === copyIssue.imageId)
  );
  const copyIssueMessage = copyIssue && issueGroup
    ? `${issueGroup.title} · 图${issueGroup.items.findIndex(item => item.id === copyIssue.imageId) + 1}的${IMAGE_COPY_LIMIT_FIELDS[copyIssue.field]}${
        copyIssue.field === "bodyLine" && copyIssue.index !== undefined
          ? `（第${copyIssue.index + 1}行）`
          : copyIssue.field === "iconLabel" && copyIssue.index !== undefined
            ? `（第${copyIssue.index + 1}个）` : ""
      }返修后仍未达到长度规则（上限 ${copyIssue.limit}）。可在生成窗口调整规则，或允许该图位使用长文案。`
    : null;
  return {
    ...current,
    locked: current.locked || !!(await researchLocks(scope)).outline,
    outlineRevision: context.plan.revision,
    outline: context.plan.data,
    upstream: context.sources.upstream,
    tags: context.tags,
    materials: publicDocumentMaterials(context.materials),
    sourceHash: context.sourceHash,
    outlineChanged: current.data.sourceOutlineHash !== context.outlineHash,
    sourcesChanged:
      !!current.data.organized &&
      !!current.data.sourceContextHash &&
      current.data.sourceContextHash !== context.sourceHash,
    job: sameScope(job, scope)
      ? {
          status: job!.status,
          progress: job!.progress,
          copyLimits: imageCopyLimitsSchema.safeParse(
            (job!.input as { copyLimits?: unknown } | null)?.copyLimits
          ).data ?? null,
          error: ["failed", "canceled"].includes(job!.status)
            ? copyIssueMessage || "套图文档暂未完成，请检查资料与助手配置后重试"
            : null,
        }
      : null,
    candidate: draft
      ? {
          id: draft.id,
          data: review?.data ?? draft.data,
          reply: String(draft.reply),
          history: draft.history,
          imageId: draft.image_id as string | null,
          stage: draft.stage as string | null,
          mode: draft.mode as "generate" | "adjust" | "prompts" | "promptSuite",
          stale: review?.stale ?? false,
          staleReason: review?.reason ?? null,
          preservedImages: review?.preservedImages ?? 0,
        }
      : null,
  };
}
export async function confirmImageDocument(
  scope: PlanningScope,
  id: string,
  _improve = false
) {
  const result = await (
    await requireDb("confirm document")
  ).transaction(async tx => {
    await lockPlanningProject(tx, scope);
    const current = await readImageDocument(scope, tx);
    const draft = await candidate(scope, id, tx);
    const acceptPreview = !isPromptPreview(draft.mode);
    if (!acceptPreview) assertDocumentEditable(current);
    if (draft.status === "confirmed")
      return {
        ...current,
        improvementId: draft.improvement_id as string | null,
      };
    if (draft.status !== "open") throw documentConflict();
    if (!acceptPreview) {
      const context = await imageDocumentContext(scope, current.data);
      const review = reviewDocumentCandidate(draft, current.data, context);
      if (review.stale) throw documentConflict();
      draft.data = review.data;
    }
    const running = current.jobRunId
      ? await getAiJobRun(current.jobRunId)
      : null;
    if (active(running) && (!acceptPreview || (running?.input as any)?.candidateId !== id))
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "小L还在整理，请完成后再确认最新预览",
      });
    let improvementId: string | null = null;
    if (!acceptPreview)
      draft.data.sourceContextHash = (
        await imageDocumentContext(scope, draft.data)
      ).sourceHash;
    const saved = await saveImageDocument(
      scope,
      current.revision,
      draft.data,
      tx,
      { generated: true, acceptPreview }
    );
    await tx.execute(
      sql`UPDATE listing_image_document_candidates SET status='confirmed',improvement_id=${improvementId} WHERE id=${id}`
    );
    return { ...saved, improvementId };
  });
  const job = result.jobRunId ? await getAiJobRun(result.jobRunId) : null;
  if (sameScope(job, scope) && (job!.input as any)?.candidateId === id)
    try {
      const agent = await imageDocumentAgentContext(
        (job!.input as any).agentRunId,
        scope
      );
      await markBusinessManagedNodeConfirmed({
        ...agent,
        output: result.data,
        userEdit: result.data,
      });
    } catch {
      console.warn("[套图文档] 流程确认同步未完成");
    }
  return result;
}
export async function dismissImageDocument(scope: PlanningScope, id: string) {
  return (await requireDb("dismiss document preview")).transaction(async tx => {
    await lockPlanningProject(tx, scope);
    const draft = await candidate(scope, id, tx);
    if (isPromptPreview(draft.mode))
      assertDocumentEditable(await readImageDocument(scope, tx));
    await tx.execute(
      sql`UPDATE listing_image_document_candidates SET status='dismissed' WHERE id=${id} AND project_id=${scope.projectId} AND workspace_id=${scope.workspaceId} AND user_id=${scope.userId} AND status='open'`
    );
    return { dismissed: true };
  });
}
