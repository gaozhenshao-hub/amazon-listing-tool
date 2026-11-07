import { assertResearchEditable } from "./researchLocks";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  imageOutlineSchema,
  outlineHistorySchema,
  outlineSelectionSchema,
  type ImageOutline,
} from "../../../shared/imagePlanning";
import {
  outlinePartRules,
  parseImagePlanningResult,
  type ImageOutlinePart,
} from "./imagePlanningResult";
import { selectedPlanningReferences } from "./planningSelectedReferences";
import {
  hasOutlineResult,
  outlineRefinementFields,
} from "../../../shared/imageOutlineEditing";
import {
  planningModelCatalog,
  planningModelSources,
} from "./imagePlanningContext";
import { moduleSpec } from "../../../shared/imageModuleSpecs";
import { acquisitionReviewHash } from "../../../shared/acquisitionReview";
import { requireDb } from "../../repositories/dbClient";
import { runCompetitorSkill } from "./runCompetitorSkill";
import {
  safeParseSkillJSON,
  getEmperorSkillRuntimeSnapshot,
} from "../ai_os/services/skillRunner";
import {
  assistantConfigurationService,
  skillManifestHash,
} from "../ai_os/services/assistantConfigurations";
import {
  getAiJobRun,
  registerAiJobHandler,
  startRegisteredAiJob,
} from "../../services/aiJobRunner";
import { createSkillImprovementDraft } from "../ai_os/services/skillWorkbench";
import { IMAGE_PLANNING_SKILL } from "./imagePlanningPrompt";
import {
  ensureImagePlanningAgentRun,
  imagePlanningAgentContext,
  IMAGE_PLANNING_NODE,
} from "./imagePlanningAgent";
import {
  markBusinessManagedNodeConfirmed,
  markBusinessManagedNodeRunning,
  markBusinessManagedNodeWaitingHuman,
  markBusinessManagedNodeFailed,
} from "../ai_os/services/businessManagedAgent";
import {
  imagePlanningSources,
  validateOutlineLinks,
  planningVisuals,
} from "./imagePlanningSources";
import {
  lockPlanningProject,
  planningRows,
  planningJson,
  readImagePlan,
  saveImagePlan,
  type PlanningScope,
} from "./imagePlanningStore";

export const imagePlanningStartSchema = z
  .object({
    projectId: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    mode: z.enum(["generate", "adjust", "refine"]),
    selection: outlineSelectionSchema.optional(),
    message: z.string().trim().max(4000).default(""),
    candidateId: z.string().uuid().optional(),
    saveAsVersion: z.literal(true).optional(),
  })
  .strict();
const jobSchema = imagePlanningStartSchema.extend({
  workspaceId: z.number().int().positive(),
  userId: z.number().int().positive(),
  sourceHash: z.string(),
  configurationRevision: z.number(),
  candidateId: z.string().uuid(),
  agentRunId: z.string().min(1),
  agentNodeId: z.literal(IMAGE_PLANNING_NODE),
});
const conflict = () =>
  new TRPCError({
    code: "CONFLICT",
    message: "大纲、上一级分析或助手配置已变化，请刷新后重新调整",
  });

async function configuration(scope: PlanningScope) {
  const saved = await assistantConfigurationService.get(
    scope.workspaceId,
    "images"
  );
  if (saved.status !== "configured" || !saved.record.config.enabled)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "请先启用图片策划助手",
    });
  const binding = saved.record.config.skills.find(
    s => s.slug === IMAGE_PLANNING_SKILL && s.enabled
  );
  const snapshot = await getEmperorSkillRuntimeSnapshot(
    IMAGE_PLANNING_SKILL,
    scope.workspaceId
  );
  const [skill] = await planningRows(
    await requireDb("image planning skill"),
    sql`SELECT manifest FROM emperor_skills WHERE slug=${IMAGE_PLANNING_SKILL} AND status='Released' AND (workspaceId=${scope.workspaceId} OR (workspaceId IS NULL AND scope='global')) ORDER BY workspaceId DESC LIMIT 1`
  );
  if (
    !binding ||
    !skill ||
    String(binding.version) !== String(snapshot.version) ||
    binding.manifestSha256 !== skillManifestHash(skill.manifest)
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "图片大纲技能已更新，请在助手配置中更新绑定",
    });
  return {
    config: saved.record.config,
    revision: saved.record.revision,
    snapshot,
  };
}
async function candidate(
  scope: PlanningScope,
  id: string,
  tx = undefined as Awaited<ReturnType<typeof requireDb>> | undefined
) {
  const [row] = await planningRows(
    tx || (await requireDb("read outline candidate")),
    sql`SELECT * FROM listing_image_plan_candidates WHERE id=${id} AND project_id=${scope.projectId} AND workspace_id=${scope.workspaceId} AND user_id=${scope.userId}`
  );
  if (!row)
    throw new TRPCError({ code: "NOT_FOUND", message: "调整预览不存在" });
  return {
    id: String(row.id),
    status: String(row.status),
    base_revision: Number(row.base_revision),
    source_hash: String(row.source_hash),
    reply: String(row.reply),
    mode: row.mode as "generate" | "adjust" | "refine",
    data: imageOutlineSchema.parse(planningJson(row.data)),
    original: imageOutlineSchema.parse(planningJson(row.original_data)),
    history: outlineHistorySchema.parse(planningJson(row.history)),
    selection: planningJson(row.selection),
  };
}
export async function startImagePlanning(
  scope: PlanningScope,
  input: z.infer<typeof imagePlanningStartSchema>
) {
  if (!input.saveAsVersion) await assertResearchEditable(scope, "outline");
  else if (input.mode !== "generate" || input.selection || input.candidateId)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "请选择生成独立大纲版本",
    });
  const sources = await imagePlanningSources(scope),
    config = await configuration(scope);
  if (!sources.upstream.selling.length)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "请先完成并保存卖点梳理",
    });
  if (input.mode === "adjust" && (!input.selection || !input.message))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "请选择图片并填写调整意见",
    });
  const db = await requireDb("start image planning");
  return db.transaction(async tx => {
    await lockPlanningProject(tx, scope);
    if (!input.saveAsVersion)
      await assertResearchEditable(scope, "outline", tx);
    let current = await readImagePlan(scope, tx);
    if (
      !input.saveAsVersion &&
      input.mode === "generate" &&
      hasOutlineResult(current.data)
    )
      input = { ...input, mode: "refine" };
    if (input.mode === "refine" && !input.message.trim())
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "请说明希望怎样改进图片大纲",
      });
    if (current.revision !== input.revision) throw conflict();
    if (!current.revision && input.saveAsVersion)
      current = await saveImagePlan(scope, 0, current.data, tx, {
        generated: true,
      });
    if (!current.revision)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "请先保存当前大纲",
      });
    const old = current.jobRunId ? await getAiJobRun(current.jobRunId) : null;
    if (old && ["queued", "running"].includes(old.status))
      return { runId: old.runId };
    const agent = await ensureImagePlanningAgentRun(scope);
    const job = await startRegisteredAiJob({
      runId: "image-outline-" + randomUUID(),
      kind: "listing.images.outline",
      module: "listing",
      procedure: "imagePlanning.start",
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      projectId: scope.projectId,
      skillSlug: IMAGE_PLANNING_SKILL,
      queueName: "analysis",
      timeoutSeconds: 900,
      maxAttempts: 1,
      input: {
        ...input,
        revision: current.revision,
        previousCandidateId: input.candidateId,
        ...scope,
        configurationRevision: config.revision,
        sourceHash: sources.sourceHash,
        candidateId: randomUUID(),
        ...agent,
        agentRunId: agent.agentRunId,
        agentNodeId: agent.agentNodeId,
      },
    });
    await tx.execute(
      sql`UPDATE listing_image_plans SET job_run_id=${job.runId} WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId}`
    );
    return { runId: job.runId };
  });
}

export async function executeImagePlanning(
  raw: unknown,
  signal: AbortSignal,
  runId?: string
) {
  const job = jobSchema.passthrough().parse(raw),
    scope: PlanningScope = job;
  const [sources, configured, current] = await Promise.all([
    imagePlanningSources(scope),
    configuration(scope),
    readImagePlan(scope),
  ]);
  if (
    job.sourceHash !== sources.sourceHash ||
    configured.revision !== job.configurationRevision ||
    current.revision !== job.revision
  )
    throw conflict();
  let base = job.saveAsVersion
      ? { ...current.data, activeVersionId: undefined, groups: [] }
      : current.data,
    history: z.infer<typeof outlineHistorySchema> = [];
  if (
    (job.mode === "adjust" || job.mode === "refine") &&
    (raw as any).previousCandidateId
  ) {
    const previous = await candidate(scope, (raw as any).previousCandidateId);
    if (
      previous.status !== "open" ||
      Number(previous.base_revision) !== current.revision ||
      previous.source_hash !== sources.sourceHash ||
      (job.mode === "adjust" &&
        JSON.stringify(previous.selection) !== JSON.stringify(job.selection))
    )
      throw conflict();
    base = previous.data;
    history = previous.history;
  }
  const selected = job.selection
    ? base.groups
        .find(g => g.id === job.selection!.groupId)
        ?.items.find(i => i.id === job.selection!.itemId)
    : undefined;
  if (job.mode === "adjust" && !selected) throw conflict();
  const visuals = await planningVisuals(scope);
  const chosenReferences = await selectedPlanningReferences(
    scope,
    base.referenceSets
  );
  const requestData = {
    selectedReferenceSets: chosenReferences.sets,
    visualEvidence: {
      images: visuals.images,
      selectedSetImages: chosenReferences.attachedImages.map(image => ({
        ...image,
        attachmentIndex: image.attachmentIndex + visuals.attachments.length,
      })),
      unavailable: visuals.unavailable,
      note:
        visuals.images.length || chosenReferences.attachments.length
          ? "附件先对应images，随后按selectedSetImages中的附件下标对应已选套图，直接查看原件；未附图仍可参考已保存分析，不声称已看过所有原件"
          : "当前原件不可读取，仅依据已有分析和文字资料规划",
    },
    mode: job.mode,
    upstream: planningModelSources(sources.input),
    catalog: planningModelCatalog,
    existing: {
      ...base,
      groups: base.groups.map(g => ({
        ...g,
        items: g.items.map(i => ({
          id: i.id,
          content: i.content.slice(0, 350),
        })),
      })),
    },
    selected,
    refinementFields:
      job.mode === "refine" ? outlineRefinementFields(base) : undefined,
    history,
    message: job.saveAsVersion
      ? "根据当前图片策划对话独立生成一份完整大纲。逐模块说明用途，逐图说明画面、主体、位置和版式。已选参考套图可辅助理解布局，未选时根据项目资料和策划对话完成大纲。"
      : job.message,
    assistant: {
      instructions: configured.config.instructions,
      rules: configured.config.rules,
      binding: configured.config.skills.find(
        s => s.slug === IMAGE_PLANNING_SKILL
      )?.instructions,
    },
    outputRules:
      job.mode === "refine"
        ? "返回{reply,changes:[{key,original,value}]}。key/original必须来自refinementFields；value保持原类型。protected=true的人工字段原样保留，不输出修改；模块结构需要变化时可额外返回structureChanges：merge合并相邻A+，layout调整未被人工保护的模块，append补充模块。保留原有人工字段、图片身份和参考，不能删除人工图位。按message改进模块分工、画面和关联；需要调整人工字段时在reply中说明，供运营手动决定。不要输出groups或item。"
        : "严格采用catalog中的family/name。每张图都填写featureIds、benefitIds、reviewIds、questionIds数组，引用输入中的完整UUID；不要输出id或references。非移动端图片省略mobileWidth/mobileHeight，不填null或0。返回完整JSON，模块按min/max图数展开。品牌故事是整体板块，不是moduleType；必须分别用轮播背景、品牌焦点图片等官方子类型建立groups。宽图及其移动版属于同一图位，在同一个item填写width/height及mobileWidth/mobileHeight，不能分成两个items。纯文字/问答/规格表是一个文字格子，具体多条内容合在content中。资料中compacted或省略标记说明仅提供精选资料，不声称阅读过所有原文。",
    contentRules:
      "白底主图的 featureIds、benefitIds、reviewIds 和 questionIds 全部为空。现在只做画面大纲：content只描述这是一张什么图、主体、摆放、版式及简短文字方向，不写成最终营销文案或品牌故事答案。必须遵守upstream.factRules。已保存的上一级功能和获益就是确认的本品资料，人工修改优先于竞品，不再要求属性表，不加本品资料待确认前缀。明确待改进/待实现除外。不得另造未提供的测试或认证。品牌故事只规划真实品牌素材的画面与占位：没有资料时写【待提供】品牌标识、团队/产地/起源等素材，不能虚构工程师、研发年限、合作团队、服务承诺、其他在售商品或店铺链接。未提供本品的四个商品时，优先选品牌焦点图片等卡片；不要编造四个商品凑展示卡。问答模块规划覆盖的问题和布局，不代编缺少依据的答案。",
  };
  async function generatePart(part?: ImageOutlinePart) {
    const requestInput = part
      ? {
          ...requestData,
          outlinePart: part,
          message: `${requestData.message} 本次只生成「${part}」这一部分，系统负责合并三批结果。`,
          catalog: requestData.catalog.filter(item => item.family === part),
          outputRules: `${outlinePartRules[part]} ${requestData.outputRules}`,
        }
      : requestData;
    let context = JSON.stringify(requestInput),
      validationHint = "",
      previousOutput: any = null;
    if (context.length > 160000)
      throw new Error("项目资料较多，请减少竞品后再规划");
    const validate = (text: string) => {
      try {
        previousOutput = safeParseSkillJSON(text);
        return parseImagePlanningResult(
          previousOutput,
          job.mode,
          base,
          sources.upstream,
          sources.revision,
          job.selection,
          sources.sourceHash,
          part
        );
      } catch (error) {
        validationHint =
          error instanceof z.ZodError
            ? error.issues
                .slice(0, 12)
                .map(i => i.path.join(".") + ": " + i.message)
                .join("; ")
            : error instanceof Error
              ? error.message.slice(0, 1500)
              : "JSON格式不正确";
        if (Array.isArray(previousOutput?.groups))
          validationHint +=
            "\n模块图数检查：" +
            previousOutput.groups
              .flatMap((g: any, index: number) => {
                const spec = moduleSpec(g.family, g.moduleType),
                  count = g.items?.length;
                return spec &&
                  g.family !== "主图" &&
                  (count < Math.max(1, spec.min) ||
                    count > Math.max(1, spec.max))
                  ? [
                      `groups.${index} ${g.family}/${g.moduleType} 当前${count}格，要求${Math.max(1, spec.min)}–${Math.max(1, spec.max)}格`,
                    ]
                  : [];
              })
              .join("; ");
        console.warn("[图片大纲] 输出格式校验未通过：", validationHint);
        throw error;
      }
    };
    const result = await runCompetitorSkill(
      {
        skillSlug: IMAGE_PLANNING_SKILL,
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        projectId: scope.projectId,
        context,
        variables: { context },
        modelOverride: configured.config.modelSlug || undefined,
        expectedSkillVersion: configured.snapshot.version,
        expectedSkillManifestHash: configured.snapshot.manifestHash,
        expectedSkillStatus: "Released",
        skillVersionPolicy: "snapshot",
        attachments: [...visuals.attachments, ...chosenReferences.attachments],
        signal,
        validate,
      },
      (_error, _attempt, request) => {
        context = JSON.stringify({
          ...requestInput,
          upstream: {
            ...requestData.upstream,
            competitors: requestData.upstream.competitors.map(
              (c: { analysisId: number; asin: string }) => ({
                analysisId: c.analysisId,
                asin: c.asin,
                note: "初次策划已使用竞品资料；本轮仅修复同一份大纲结构，不重写已正确内容",
              })
            ),
          },
          visualEvidence: {
            ...requestData.visualEvidence,
            note: "原图在初次策划已提供，本轮格式修正不重复附图",
          },
          previousOutput,
          correction:
            "保持上一份大纲已正确的画面内容和关联，仅修正以下结构问题，并重新返回完整JSON：" +
            validationHint,
        });
        request.context = context;
        request.variables = { context };
        request.attachments = [];
      }
    );
    signal.throwIfAborted();
    return { parsed: result.parsed, context };
  }

  const parts = job.saveAsVersion
    ? (Object.keys(outlinePartRules) as ImageOutlinePart[])
    : [];
  const completed = parts.length
    ? await Promise.allSettled(parts.map(part => generatePart(part)))
    : [];
  const outputs = completed.map(part => {
    if (part.status === "rejected") throw part.reason;
    return part.value.parsed;
  });
  const generation = outputs.length
    ? {
        parsed: {
          reply: outputs
            .map(output => output.reply)
            .filter(Boolean)
            .join("\n")
            .slice(0, 6000),
          data: imageOutlineSchema.parse({
            ...outputs[0].data,
            groups: outputs.flatMap(output => output.data.groups),
          }),
        },
        context: JSON.stringify({ ...requestData, outlinePartRules }),
      }
    : await generatePart();
  const { parsed, context } = generation;
  history = outlineHistorySchema.parse([
    ...history,
    {
      role: "user",
      text:
        job.mode === "generate" ? "按当前项目资料规划图片大纲" : job.message,
    },
    { role: "assistant", text: parsed.reply },
  ]);
  const db = await requireDb("save image outline preview");
  await db.transaction(async tx => {
    await lockPlanningProject(tx, scope);
    if (!job.saveAsVersion) await assertResearchEditable(scope, "outline", tx);
    const latest = await readImagePlan(scope, tx);
    if (
      latest.revision !== job.revision ||
      (job.saveAsVersion && latest.jobRunId !== runId)
    )
      throw conflict();
    signal.throwIfAborted();
    if (!job.saveAsVersion)
      await tx.execute(
        sql`UPDATE listing_image_plan_candidates SET status='superseded' WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId} AND user_id=${scope.userId} AND status='open'`
      );
    await tx.execute(
      sql`INSERT INTO listing_image_plan_candidates(id,project_id,workspace_id,user_id,base_revision,source_hash,mode,selection,original_data,input_data,data,history,reply,status) VALUES(${job.candidateId},${scope.projectId},${scope.workspaceId},${scope.userId},${job.revision},${sources.sourceHash},${job.mode},${job.selection ? JSON.stringify(job.selection) : null},${JSON.stringify(current.data)},${context},${JSON.stringify(parsed.data)},${JSON.stringify(history)},${parsed.reply},${job.saveAsVersion ? "version" : "open"})`
    );
  });
  return { candidateId: job.candidateId };
}
registerAiJobHandler({
  id: "listing-image-outline",
  match: job => job.kind === "listing.images.outline",
  handler: async (job, { signal }) => {
    const input = jobSchema.passthrough().parse({
      ...(job.input && typeof job.input === "object" ? job.input : {}),
      workspaceId: job.workspaceId,
      userId: job.userId,
      projectId: job.projectId,
    });
    const agent = await imagePlanningAgentContext(input.agentRunId, input);
    const tracking = {
      ...agent,
      aiJobRunId: job.runId,
      aiJobAttempt: job.attempt,
      allowJobReplacement: input.saveAsVersion,
    };
    await markBusinessManagedNodeRunning(tracking);
    try {
      const output = await executeImagePlanning(input, signal, job.runId);
      await markBusinessManagedNodeWaitingHuman({ ...tracking, output });
      return output;
    } catch (error) {
      await markBusinessManagedNodeFailed({
        ...tracking,
        finalAttempt: true,
        errorMessage: error instanceof Error ? error.message : "图片大纲未完成",
      }).catch(() => null);
      throw error;
    }
  },
});

export async function imagePlanningStatus(scope: PlanningScope) {
  const plan = await readImagePlan(scope),
    sources = await imagePlanningSources(scope),
    job = plan.jobRunId ? await getAiJobRun(plan.jobRunId) : null;
  const [row] = await planningRows(
    await requireDb("image planning previews"),
    sql`SELECT id FROM listing_image_plan_candidates WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId} AND user_id=${scope.userId} AND status='open' ORDER BY created_at DESC,id DESC LIMIT 1`
  );
  const draft = row ? await candidate(scope, row.id) : null;
  return {
    ...plan,
    upstream: sources.upstream,
    upstreamRevision: sources.revision,
    sourceHash: sources.sourceHash,
    job:
      job &&
      job.userId === scope.userId &&
      job.workspaceId === scope.workspaceId &&
      job.projectId === scope.projectId
        ? {
            runId: job.runId,
            status: job.status,
            progress: job.progress,
            error: ["failed", "canceled"].includes(job.status)
              ? "规划暂未完成，请查看资料与助手配置后重试"
              : null,
          }
        : null,
    candidate: draft
      ? {
          id: draft.id,
          data: draft.data,
          reply: draft.reply,
          history: draft.history,
          mode: draft.mode,
          selection: draft.selection,
          stale:
            Number(draft.base_revision) !== plan.revision ||
            draft.source_hash !== sources.sourceHash,
        }
      : null,
  };
}
export async function confirmImagePlanning(
  scope: PlanningScope,
  id: string,
  improve: boolean
) {
  const db = await requireDb("confirm image planning");
  const result = await db.transaction(async tx => {
    await lockPlanningProject(tx, scope);
    await assertResearchEditable(scope, "outline", tx);
    const sources = await imagePlanningSources(scope);
    const [raw] = await planningRows(
      tx,
      sql`SELECT * FROM listing_image_plan_candidates WHERE id=${id} AND project_id=${scope.projectId} AND workspace_id=${scope.workspaceId} AND user_id=${scope.userId} FOR UPDATE`
    );
    if (!raw) throw new TRPCError({ code: "NOT_FOUND", message: "预览已失效" });
    const current = await readImagePlan(scope, tx);
    if (raw.status === "confirmed") return current;
    if (
      raw.status !== "open" ||
      Number(raw.base_revision) !== current.revision ||
      raw.source_hash !== sources.sourceHash
    )
      throw conflict();
    const data = imageOutlineSchema.parse(planningJson(raw.data));
    validateOutlineLinks(data, sources.upstream);
    let improvementId: string | null = null;
    if (improve) {
      const selected = planningJson(raw.selection) as {
        groupId: string;
        itemId: string;
      } | null;
      const pick = (outline: ImageOutline) =>
        selected
          ? outline.groups
              .find(g => g.id === selected.groupId)
              ?.items.find(i => i.id === selected.itemId)
          : outline;
      const originalData = imageOutlineSchema.parse(
        planningJson(raw.original_data)
      );
      const originalInput = planningJson(raw.input_data);
      const allRelevant = [...originalData.groups, ...data.groups].flatMap(
        g => g.items
      );
      const relevant = selected
        ? allRelevant.filter(i => i.id === selected.itemId)
        : allRelevant;
      const ids = (
        key: "featureIds" | "benefitIds" | "reviewIds" | "questionIds"
      ) => new Set(relevant.flatMap(i => i[key]));
      const input = {
        product: sources.input.product,
        productNotes: sources.input.productNotes,
        features: sources.upstream.features?.filter(n =>
          ids("featureIds").has(n.id)
        ),
        selling: sources.upstream.selling.filter(n =>
          ids("benefitIds").has(n.id)
        ),
        reviews: sources.upstream.reviews.filter(n =>
          ids("reviewIds").has(n.id)
        ),
        questions: sources.upstream.questions.filter(n =>
          ids("questionIds").has(n.id)
        ),
        sourceHash: sources.sourceHash,
        sourceRevision: sources.revision,
        planningRequestSnapshotId: id,
        visualEvidence: originalInput?.visualEvidence,
        assistantConfiguration: originalInput?.assistant,
      };
      const context = JSON.stringify({
        businessModule: "listing",
        sourceResultId: id,
        projectId: scope.projectId,
        input,
        originalResult: pick(
          imageOutlineSchema.parse(planningJson(raw.original_data))
        ),
        editedResult: pick(data),
        feedback: planningJson(raw.history)
          .filter((h: any) => h.role === "user")
          .map((h: any) => h.text)
          .join("\n"),
        history: planningJson(raw.history),
        targetType: "skill",
        targetKey: IMAGE_PLANNING_SKILL,
        scope: "current_result",
      });
      if (context.length > 120000)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "本次改进资料较多，请先确认调整，再按单张图片提出改进",
        });
      const draft = await createSkillImprovementDraft(
        {
          workspaceId: scope.workspaceId,
          userId: scope.userId,
          admin: ["admin", "super_admin"].includes(scope.role || ""),
          superAdmin: scope.role === "super_admin",
        },
        IMAGE_PLANNING_SKILL,
        id,
        { context, productId: null },
        tx
      );
      improvementId = draft.id;
    }
    const saved = await saveImagePlan(scope, current.revision, data, tx, {
      generated: true,
    });
    await tx.execute(
      sql`UPDATE listing_image_plan_candidates SET status='confirmed',improvement_id=${improvementId} WHERE id=${id}`
    );
    return { ...saved, improvementId };
  });
  const job = result.jobRunId ? await getAiJobRun(result.jobRunId) : null;
  const agentRunId = (job?.input as any)?.agentRunId;
  if (
    agentRunId &&
    (job?.input as any)?.candidateId === id &&
    job?.userId === scope.userId &&
    job?.workspaceId === scope.workspaceId &&
    job?.projectId === scope.projectId
  ) {
    try {
      const agent = await imagePlanningAgentContext(agentRunId, scope);
      await markBusinessManagedNodeConfirmed({
        ...agent,
        output: result.data,
        userEdit: result.data,
      });
    } catch (error) {
      console.warn(
        "[图片大纲] 项目流程确认同步未完成",
        error instanceof Error ? error.message : "unknown"
      );
    }
  }
  return result;
}
export async function dismissImagePlanning(scope: PlanningScope, id: string) {
  await assertResearchEditable(scope, "outline");
  await (
    await requireDb("dismiss image preview")
  ).execute(
    sql`UPDATE listing_image_plan_candidates SET status='dismissed' WHERE id=${id} AND project_id=${scope.projectId} AND workspace_id=${scope.workspaceId} AND user_id=${scope.userId} AND status='open'`
  );
  return { dismissed: true };
}
