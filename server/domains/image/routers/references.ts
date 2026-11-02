import * as shared from "../routerContext";
import type { Step5RunStatus } from "../routerContext";
import * as step4Snapshot from "../step4Snapshot";
import { getLatestStep4ReferenceJob } from "../services/step4ReferenceJob";
import { clearStep4ReferenceLocks } from "../step4ReferenceLockState";
import { resolveWorkflowGuidance } from "../../knowledge/claimLedgerService";
import { createImageAssetReceipt, requireImageAssetReceipt } from "../services/imageAssetReceipt";
import { validateImageBytes } from "../services/validateImageBytes";
import { requireClassifiedStep4KbUses } from "../services/imageKbUsePolicy";
import { imageAssetPolicyService } from "../services/imageAssetPolicyService";
import { recordServerControlledImageUpload } from "../services/imageAssetTrustLedgerService";

const {
  compactStep4ReferenceForStorage,
  compactStep4SnapshotForStorage,
  mergeSingleStep4Reference,
} = step4Snapshot;

const {
  APLUS_MODULE_STYLE_GUIDE,
  IMAGE_ADVICE_TRANSLATION_PROMPT,
  STEP0_COMPETITOR_IMAGE_ANALYSIS_PROMPT,
  STEP0_COMPETITOR_SUMMARY_PROMPT,
  STEP1_SELLING_POINTS_PROMPT,
  STEP2_IMAGE_OUTLINE_PROMPT,
  STEP3_STYLE_PROMPT,
  STEP4_REFERENCE_PROMPT,
  STEP4_REOPTIMIZE_WITH_REFS_PROMPT,
  STEP5_APLUS_COMBO_RECOMMEND_PROMPT,
  STEP5_APLUS_MODULE_OPTIMIZE_PROMPT,
  STEP5_FINAL_SUGGESTION_PROMPT,
  STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT,
  buildImageWorkflowContext,
  buildStep5FinalSuggestion,
  buildStep5RunSnapshot,
  asImageWorkflowVersionTrpcError,
  captureImageWorkflowWorkerFence,
  callLLMWithRetry,
  db,
  devDb,
  ensureWriteAccess,
  generateStep5RunId,
  getKBReference,
  invokeBusinessSkill,
  isActiveStep5Run,
  invalidateImageWorkflowStages,
  kbDb,
  parseLLMJson,
  parseStoredJson,
  persistStep5ListingAdvice,
  protectedProcedure,
  registerAiJobHandler,
  resolveProjectAccess,
  resolveSessionAccess,
  resolveSessionForExecution,
  router,
  runStep5GenerationJob,
  serializeStep5Error,
  startRegisteredAiJob,
  step5JobInput,
  storagePut,
  z,
} = shared;

type Step4KbImage = { id: number; note?: string; position?: string };

async function resolveReadableKbImages(images: Step4KbImage[], ctx: any) {
  const workspaceId = Number(ctx.workspaceId || 0);
  if (workspaceId <= 0) throw new Error("当前工作空间不可用，无法验证知识库图片");
  return Promise.all(images.map(async (image) => {
    const readable = await kbDb.getReadableImage(image.id, ctx.user.id, workspaceId);
    if (!readable) throw new Error("知识库图片不存在、不可访问或不属于当前工作空间");
    return { url: readable.imageUrl, note: image.note, position: image.position };
  }));
}

async function requireApprovedReceiptUse(input: {
  reference: string;
  kind: "step4-ref" | "designer";
  allowedUse: "step4_reference" | "designer_attachment";
  projectId: number;
  ctx: any;
}) {
  const receipt = requireImageAssetReceipt({
    reference: input.reference,
    kind: input.kind,
    projectId: input.projectId,
    userId: input.ctx.user.id,
  });
  await imageAssetPolicyService.requireApprovedReceiptAssetUse({
    workspaceId: Number(input.ctx.workspaceId || 0),
    projectId: input.projectId,
    actorId: input.ctx.user.id,
    actorRole: input.ctx.user.role,
    receiptReference: input.reference,
    kind: input.kind,
    allowedUse: input.allowedUse,
  });
  return receipt.url;
}

/** A signed browser receipt only identifies a server upload. It becomes a
 * production reference only after its bytes, license evidence and human review
 * are current in the ledger. */
async function requireApprovedStep4Reference(input: { reference: string; ctx: any; projectId: number }) {
  return requireApprovedReceiptUse({ ...input, kind: "step4-ref", allowedUse: "step4_reference" });
}

async function requireApprovedDesignerAttachment(input: { reference: string; ctx: any; projectId: number }) {
  return requireApprovedReceiptUse({ ...input, kind: "designer", allowedUse: "designer_attachment" });
}

export async function requireStep4DraftAssets(snapshot: Record<string, any>, ctx: any, projectId: number) {
  const references = snapshot?.imageReferences;
  if (!Array.isArray(references)) throw new Error("Step4 草稿缺少图片参考方案");
  requireClassifiedStep4KbUses(snapshot);
  const receiptReferences: string[] = [];
  for (const reference of references) {
    if (!reference || typeof reference !== "object") continue;
    const verifyNestedUrls = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach(verifyNestedUrls); return; }
      for (const [key, candidate] of Object.entries(value)) {
        if (/^(?:kbReferenceImages)$/i.test(key)) continue; // Must be empty until asset-use approval exists.
        if (/(?:url|src|uri)$/i.test(key) && typeof candidate === "string" && candidate.trim()) {
          receiptReferences.push(candidate);
        } else verifyNestedUrls(candidate);
      }
    };
    verifyNestedUrls(reference);
  }
  for (const reference of receiptReferences) {
    await requireApprovedStep4Reference({ reference, ctx, projectId });
  }
}

const distillationBindingSchema = z.object({
  ledgerKey: z.string().min(1).max(80).nullable().optional(),
  skillSlugs: z.array(z.string().min(1).max(128)).max(12).optional(),
});

async function selectedGuidanceText(input: { distillationBinding?: { ledgerKey?: string | null; skillSlugs?: string[] } }, ctx: any, project: any) {
  if (!input.distillationBinding?.ledgerKey && !input.distillationBinding?.skillSlugs?.length) return "";
  const workspaceId = Number(ctx.workspaceId || project.workspaceId || 0);
  const guidance = await resolveWorkflowGuidance({ workspaceId, ...input.distillationBinding });
  return `\n\n--- 用户显式选择的知识蒸馏指导（只读） ---\n${JSON.stringify(guidance).slice(0, 6_000)}`;
}

function mergeStep4DraftVersions(confirmedRaw: unknown, latestRaw: unknown) {
  const parseSnapshot = (value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
    return parseStoredJson(String(value || "{}")) as Record<string, any> | null;
  };
  const confirmed = parseSnapshot(confirmedRaw);
  // 最新AI Job的output.result是对象。此前String(object)会变为“[object Object]”，
  // 解析失败后错误回退到历史草稿，导致车库/庭院/露营/工地场景没有展示。
  const latest = parseSnapshot(latestRaw);
  if (!confirmed && !latest) return null;
  if (!confirmed) return latest;
  if (!latest) return confirmed;

  // 使用命名空间导入避免热更新或滚动发布期间的静态命名导出不一致，
  // 并保留一份等价的兼容合并逻辑作为安全降级。
  const mergeLatest = (step4Snapshot as Record<string, any>).mergeStep4LatestWithUserAssets;
  if (typeof mergeLatest === "function") return mergeLatest(confirmed, latest);

  const confirmedRefs = Array.isArray(confirmed.imageReferences) ? confirmed.imageReferences : [];
  const latestRefs = Array.isArray(latest.imageReferences) ? latest.imageReferences : [];
  const identity = (reference: Record<string, any>, index: number) => String(
    reference?.imageKey
    || `${reference?.imageType || "image"}:${reference?.parentModuleNumber ?? ""}:${reference?.subModuleNumber ?? ""}:${reference?.imageNumber ?? index}`,
  );
  const confirmedByKey = new Map(confirmedRefs.map((reference: Record<string, any>, index: number) => [identity(reference, index), reference]));
  return {
    ...confirmed,
    ...latest,
    imageReferences: latestRefs.map((latestReference: Record<string, any>, index: number) => {
      const confirmedReference = confirmedByKey.get(identity(latestReference, index)) || confirmedRefs[index] || {};
      return {
        ...latestReference,
        compositionRefImageUrl: confirmedReference.compositionRefImageUrl || latestReference.compositionRefImageUrl,
        effectRefImageUrl: confirmedReference.effectRefImageUrl || latestReference.effectRefImageUrl,
        compositionRefNote: confirmedReference.compositionRefNote || latestReference.compositionRefNote,
        effectRefNote: confirmedReference.effectRefNote || latestReference.effectRefNote,
        kbReferenceImages: confirmedReference.kbReferenceImages || latestReference.kbReferenceImages,
      };
    }),
  };
}

function getLatestSucceededStep4Result(job: { status?: string; output?: unknown } | null) {
  if (job?.status !== "succeeded") return null;
  return (step4Snapshot as Record<string, any>).extractLatestStep4JobResult(job.output);
}

export const imageReferenceProcedures = {

  // ─── Step 4: Persist an editable draft without locking the step ─────────
  saveStep4Draft: protectedProcedure
    .input(z.object({ projectId: z.number(), userEdit: z.string().min(2) }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user, ctx.workspaceId);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);
      const draft = parseStoredJson(input.userEdit) as Record<string, any> | null;
      if (!Array.isArray(draft?.imageReferences)) throw new Error("Step4 草稿缺少图片参考方案");
      await requireStep4DraftAssets(draft, ctx, input.projectId);

      await invalidateImageWorkflowStages({
        workspaceId: Number(ctx.workspaceId || 0),
        projectId: input.projectId,
        sessionId: session.id,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        fromStep: 4,
        legacyPatch: {
          step4UserEdit: JSON.stringify(compactStep4SnapshotForStorage(draft)),
        },
      }).catch(asImageWorkflowVersionTrpcError);
      return { success: true };
    }),

  confirmStep4ImageVersion: protectedProcedure
    .input(z.object({ projectId: z.number(), imageIndex: z.number().int().min(0), content: z.string().min(2) }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user, ctx.workspaceId);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);
      const reference = parseStoredJson(input.content) as Record<string, any> | null;
      if (!reference) throw new Error("单图确认内容无效");
      await requireStep4DraftAssets({ imageReferences: [reference] }, ctx, input.projectId);
      await db.updateImageWorkflowSession(session.id, { step4Confirmed: 0, step5Confirmed: 0, step6Confirmed: 0 });
      const version = await db.confirmStep4ImageVersion({ sessionId: session.id, projectId: input.projectId, userId: ctx.user.id, imageIndex: input.imageIndex, imageKey: `step4-ref-${input.imageIndex}`, content: JSON.stringify(compactStep4ReferenceForStorage(reference)) });
      return { success: true, version };
    }),

  unlockStep4ImageVersion: protectedProcedure
    .input(z.object({ projectId: z.number(), imageIndex: z.number().int().min(0) }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user, ctx.workspaceId);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);
      // A single reference lock belongs to the same Step 4 dependency branch as
      // the complete plan.  The policy also clears its legacy per-image locks.
      await invalidateImageWorkflowStages({
        workspaceId: Number(ctx.workspaceId || 0),
        projectId: input.projectId,
        sessionId: session.id,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        fromStep: 4,
      }).catch(asImageWorkflowVersionTrpcError);
      return { success: true };
    }),

  // ─── Step 4: Unlock while retaining the confirmed plan and selected refs ─
  unlockStep4ForEditing: protectedProcedure
    .input(z.object({ projectId: z.number(), userEdit: z.string().min(2).optional() }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user, ctx.workspaceId);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);
      const visibleSnapshot = input.userEdit ? parseStoredJson(input.userEdit) as Record<string, any> | null : null;
      const latestJob = await getLatestStep4ReferenceJob(ctx.user.id, input.projectId).catch(() => null);
      const latestResult = getLatestSucceededStep4Result(latestJob);
      // 锁定页传来的可见快照可能仍是历史确认版本；它只提供本地图片和备注，
      // 内容必须始终以最新 step4AiResult 的场景方案为基准，避免解锁后回退旧方案。
      const draft = mergeStep4DraftVersions(
        visibleSnapshot?.imageReferences?.length ? visibleSnapshot : session.step4UserEdit,
        latestResult || session.step4AiResult,
      );
      if (!draft) throw new Error("当前没有可编辑的参考图方案");
      const userEdit = JSON.stringify(draft);

      // 整体解锁代表开始一轮新的人工编辑。版本策略会在相同 scope/CAS
      // 事务中解除逐图投影并写入草稿，不能先失效再裸写草稿。
      await invalidateImageWorkflowStages({
        workspaceId: Number(ctx.workspaceId || 0),
        projectId: input.projectId,
        sessionId: session.id,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        fromStep: 4,
        legacyPatch: { step4UserEdit: userEdit },
      }).catch(asImageWorkflowVersionTrpcError);
      return { success: true, userEdit };
    }),


  // ─── Step 4: Upload composition/effect reference images ────────
  uploadStep4RefImage: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      imageKey: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), // e.g. "mainImage", "secondary-2"
      refType: z.enum(["composition", "effect"]),
      imageData: z.string().min(24).max(28 * 1024 * 1024), // <=20MB decoded image
      fileName: z.string().min(1).max(256),
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user, ctx.workspaceId);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);

      // Upload to S3
      const buffer = Buffer.from(input.imageData, "base64");
      const { extension: ext, mimeType } = await validateImageBytes(buffer);
      const key = `image-workflow/${input.projectId}/step4-refs/${input.refType}-${input.imageKey}-${Date.now()}.${ext}`;
      const stored = await storagePut(key, buffer, mimeType);
      if (stored.key !== key || !stored.storageUri) {
        throw new Error("受控对象存储未返回稳定对象引用，拒绝签发素材回执");
      }
      await recordServerControlledImageUpload({
        workspaceId: Number(ctx.workspaceId || 0),
        projectId: input.projectId,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        kind: "step4-ref",
        intendedUse: "step4_reference",
        storage: { key: stored.key, storageUri: stored.storageUri },
        bytes: buffer,
      });
      const { url } = stored;
      const asset = createImageAssetReceipt({ url, key, kind: "step4-ref", projectId: input.projectId, userId: ctx.user.id });

      // Update the refs JSON in DB
      const field = input.refType === "composition" ? "step4CompositionRefs" : "step4EffectRefs";
      const existingRefs = session[field] ? JSON.parse(session[field] as string) : {};
      existingRefs[input.imageKey] = asset.url;

      await invalidateImageWorkflowStages({
        workspaceId: Number(ctx.workspaceId || 0),
        projectId: input.projectId,
        sessionId: session.id,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        fromStep: 4,
        legacyPatch: { [field]: JSON.stringify(existingRefs) },
      }).catch(asImageWorkflowVersionTrpcError);

      return { url: asset.url, imageKey: input.imageKey, refType: input.refType };
    }),


  // ─── Step 4: Re-optimize single image reference with uploaded refs ─
  reoptimizeStep4WithRefs: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      imageKey: z.string(),
      compositionRefUrl: z.string().optional(),
      effectRefUrl: z.string().optional(),
      compositionRefNote: z.string().max(1_000).optional(),
      effectRefNote: z.string().max(1_000).optional(),
      distillationBinding: distillationBindingSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);
      const session = await resolveSessionForExecution(input.projectId, ctx.user, `image.step4.refs.optimize:${input.projectId}`, ctx.workspaceId);
      if (!session) throw new Error("No workflow session found");
      const fence = await captureImageWorkflowWorkerFence({
        workspaceId: Number(ctx.workspaceId || project.workspaceId || 0),
        projectId: input.projectId,
        sessionId: session.id,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        targetStep: 4,
      }).catch(asImageWorkflowVersionTrpcError);
      const guidanceText = await selectedGuidanceText(input, ctx, project);
      const compositionRefUrl = input.compositionRefUrl
        ? await requireApprovedStep4Reference({ reference: input.compositionRefUrl, ctx, projectId: input.projectId })
        : undefined;
      const effectRefUrl = input.effectRefUrl
        ? await requireApprovedStep4Reference({ reference: input.effectRefUrl, ctx, projectId: input.projectId })
        : undefined;

      // Build context with reference images
      const messages: any[] = [
        { role: "system", content: STEP4_REOPTIMIZE_WITH_REFS_PROMPT },
      ];

      const userContent: any[] = [];
      userContent.push({
        type: "text",
        text: `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || '未指定'}\n\n--- 已确认的图片大纲 ---\n${session.step2UserEdit || session.step2AiResult}\n\n--- 已确认的风格方案 ---\n${session.step3UserEdit || session.step3AiResult}\n\n--- 当前图片参考方案 ---\n${session.step4AiResult}${guidanceText}\n\n目标图片: ${input.imageKey}\n\n请根据上传的参考图重新优化该图的构图参考和效果参考方案。`,
      });

      if (compositionRefUrl) {
        userContent.push({
          type: "image_url",
          image_url: { url: compositionRefUrl, detail: "high" },
        });
        userContent.push({ type: "text", text: `[上面是构图参考图${input.compositionRefNote?.trim() ? `，用户备注：${input.compositionRefNote.trim()}` : ""}]` });
      }
      if (effectRefUrl) {
        userContent.push({
          type: "image_url",
          image_url: { url: effectRefUrl, detail: "high" },
        });
        userContent.push({ type: "text", text: `[上面是效果参考图${input.effectRefNote?.trim() ? `，用户备注：${input.effectRefNote.trim()}` : ""}]` });
      }

      messages.push({ role: "user", content: userContent });


      const response = await invokeBusinessSkill({
        messages,
        response_format: { type: "json_object" },
        emperorSkill: { slug: "image.step4.reoptimize" },
      });

      // Parse AI result and merge with the existing image ref to preserve client-side fields
      const aiResult = parseLLMJson(response);
      // Get the current image ref from session to preserve uploaded URLs
      const currentStep4 = parseStoredJson(session.step4UserEdit || session.step4AiResult || "{}") as Record<string, any> | null;
      const imageRefs: any[] = (currentStep4 as any)?.imageReferences || [];
      const targetKey = input.imageKey; // e.g. "step4-ref-2"
      // Find the matching ref by imageKey or by index extracted from key
      const idxMatch = targetKey.match(/step4-ref-(\d+)/);
      const targetIdx = idxMatch ? parseInt(idxMatch[1], 10) : -1;
      const existingRef = targetIdx >= 0 ? imageRefs[targetIdx] : null;
      // Merge: AI fields override, but preserve client-side image URLs
      const merged = {
        ...(existingRef || {}),
        ...aiResult,
        compositionRefImageUrl: input.compositionRefUrl || existingRef?.compositionRefImageUrl,
        effectRefImageUrl: input.effectRefUrl || existingRef?.effectRefImageUrl,
        compositionRefNote: input.compositionRefNote?.trim() || existingRef?.compositionRefNote,
        effectRefNote: input.effectRefNote?.trim() || existingRef?.effectRefNote,
        kbReferenceImages: existingRef?.kbReferenceImages,
        imageNumber: existingRef?.imageNumber ?? aiResult?.imageNumber,
        imageType: existingRef?.imageType ?? aiResult?.imageType,
        purpose: existingRef?.purpose ?? aiResult?.purpose,
      };
      const updatedRefs = clearStep4ReferenceLocks(imageRefs);
      if (targetIdx >= 0) updatedRefs[targetIdx] = merged;
      const updatedResult = { ...(currentStep4 || {}), imageReferences: updatedRefs };
      await invalidateImageWorkflowStages({
        workspaceId: Number(ctx.workspaceId || project.workspaceId || 0),
        projectId: input.projectId,
        sessionId: session.id,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        fromStep: 4,
        targetStep: 4,
        fence,
        legacyPatch: {
          step4AiResult: JSON.stringify(updatedResult),
          step4UserEdit: JSON.stringify(updatedResult),
        },
      }).catch(asImageWorkflowVersionTrpcError);
      return merged;
    }),


  // ─── Step 4: Regenerate ALL image references from KB refs + notes ─
  regenerateAllFromReferences: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      kbImages: z.array(z.object({
        id: z.number().int().positive(),
        note: z.string().optional(),
        position: z.string().optional(),
      })),
      distillationBinding: distillationBindingSchema.optional(),
      compositionRefUrl: z.string().optional(),
      effectRefUrl: z.string().optional(),
      compositionRefNote: z.string().max(1_000).optional(),
      effectRefNote: z.string().max(1_000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);
      const session = await resolveSessionForExecution(input.projectId, ctx.user, `image.references.regenerate-all:${input.projectId}`, ctx.workspaceId);
      if (!session) throw new Error("No workflow session found");
      const fence = await captureImageWorkflowWorkerFence({
        workspaceId: Number(ctx.workspaceId || project.workspaceId || 0),
        projectId: input.projectId,
        sessionId: session.id,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        targetStep: 4,
      }).catch(asImageWorkflowVersionTrpcError);
      requireClassifiedStep4KbUses({ imageReferences: [{ kbReferenceImages: input.kbImages }] });
      const guidanceText = await selectedGuidanceText(input, ctx, project);
      const kbImages = await resolveReadableKbImages(input.kbImages, ctx);
      const compositionRefUrl = input.compositionRefUrl
        ? await requireApprovedStep4Reference({ reference: input.compositionRefUrl, ctx, projectId: input.projectId })
        : undefined;
      const effectRefUrl = input.effectRefUrl
        ? await requireApprovedStep4Reference({ reference: input.effectRefUrl, ctx, projectId: input.projectId })
        : undefined;

      // Build multimodal messages with all reference images + notes
      const userContent: any[] = [];

      // Text context
      userContent.push({
        type: "text",
        text: `产品名称: ${project.productName || project.name}
品牌: ${project.brand || '未指定'}

--- 已确认的图片大纲 ---
${session.step2UserEdit || session.step2AiResult}

--- 已确认的风格方案 ---
${session.step3UserEdit || session.step3AiResult}
${guidanceText}

请根据以下参考图和备注，重新生成完整的图片参考方案（imageReferences数组）。`,
      });

      // Add KB reference images with notes
      let kbImageIndex = 1;
      for (const kbImg of kbImages) {
        userContent.push({
          type: "image_url",
          image_url: { url: kbImg.url, detail: "high" },
        });
        const noteText = kbImg.note
          ? `[知识库参考图${kbImageIndex}，备注: ${kbImg.note}${kbImg.position ? '，图片位置: ' + kbImg.position : ''}]`
          : `[知识库参考图${kbImageIndex}${kbImg.position ? '，图片位置: ' + kbImg.position : ''}]`;
        userContent.push({ type: "text", text: noteText });
        kbImageIndex++;
      }

      // Add composition ref if provided
      if (compositionRefUrl) {
        userContent.push({
          type: "image_url",
          image_url: { url: compositionRefUrl, detail: "high" },
        });
        userContent.push({ type: "text", text: `[构图参考图：请参考此图的构图布局${input.compositionRefNote?.trim() ? `；用户备注：${input.compositionRefNote.trim()}` : ""}]` });
      }

      // Add effect ref if provided
      if (effectRefUrl) {
        userContent.push({
          type: "image_url",
          image_url: { url: effectRefUrl, detail: "high" },
        });
        userContent.push({ type: "text", text: `[效果参考图：请参考此图的视觉效果和风格${input.effectRefNote?.trim() ? `；用户备注：${input.effectRefNote.trim()}` : ""}]` });
      }

      const messages: any[] = [
        { role: "system", content: STEP4_REFERENCE_PROMPT },
        { role: "user", content: userContent },
      ];


      const response = await invokeBusinessSkill({
        messages,
        response_format: { type: "json_object" },
        emperorSkill: { slug: "image.step4.reference" },
      });

      const result = parseLLMJson(response);

      // Save the regenerated result back to session
      await invalidateImageWorkflowStages({
        workspaceId: Number(ctx.workspaceId || project.workspaceId || 0),
        projectId: input.projectId,
        sessionId: session.id,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        fromStep: 4,
        targetStep: 4,
        fence,
        legacyPatch: { step4AiResult: JSON.stringify(result) },
      }).catch(asImageWorkflowVersionTrpcError);

      return result;
    }),


  // ─── Step 4: Regenerate single image from references ──────────────
  regenerateSingleImageFromRef: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      imageIndex: z.number(),
      kbImages: z.array(z.object({
        id: z.number().int().positive(),
        note: z.string().optional(),
        position: z.string().optional(),
      })),
      compositionRefUrl: z.string().optional(),
      effectRefUrl: z.string().optional(),
      compositionRefNote: z.string().max(1_000).optional(),
      effectRefNote: z.string().max(1_000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);
      const session = await resolveSessionForExecution(input.projectId, ctx.user, `image.references.regenerate-one:${input.projectId}:${input.imageIndex}`, ctx.workspaceId);
      if (!session) throw new Error("No workflow session found");
      const fence = await captureImageWorkflowWorkerFence({
        workspaceId: Number(ctx.workspaceId || project.workspaceId || 0),
        projectId: input.projectId,
        sessionId: session.id,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        targetStep: 4,
      }).catch(asImageWorkflowVersionTrpcError);

      // Parse current step4 result to get the specific image info
      let currentStep4: any = {};
      try {
        const raw = session.step4UserEdit || session.step4AiResult;
        if (raw) currentStep4 = JSON.parse(raw);
      } catch {}
      const imageRefs = currentStep4.imageReferences || [];
      const targetImage = imageRefs[input.imageIndex];
      if (!targetImage) throw new Error(`Image at index ${input.imageIndex} not found`);
      await requireStep4DraftAssets(currentStep4, ctx, input.projectId);
      requireClassifiedStep4KbUses({ imageReferences: [{ kbReferenceImages: input.kbImages }] });
      const kbImages = await resolveReadableKbImages(input.kbImages, ctx);
      const compositionRefUrl = input.compositionRefUrl
        ? await requireApprovedStep4Reference({ reference: input.compositionRefUrl, ctx, projectId: input.projectId })
        : undefined;
      const effectRefUrl = input.effectRefUrl
        ? await requireApprovedStep4Reference({ reference: input.effectRefUrl, ctx, projectId: input.projectId })
        : undefined;

      // Build multimodal messages for single image regeneration
      const userContent: any[] = [];
      userContent.push({
        type: "text",
        text: `产品名称: ${project.productName || project.name}
品牌: ${project.brand || "未指定"}
--- 已确认的图片大纲 ---
${session.step2UserEdit || session.step2AiResult}
--- 已确认的风格方案 ---
${session.step3UserEdit || session.step3AiResult}

**任务：仅重新生成第${input.imageIndex + 1}张图（${targetImage.imageType || ""}，目的：${targetImage.purpose || ""}）的参考方案。**
请根据以下参考图和备注，重新生成该张图的构图参考和效果图参考。
返回格式与原来相同，直接返回一个 imageReference 对象（JSON），不要包裹在数组中。`,
      });

      let kbImageIndex = 1;
      for (const kbImg of kbImages) {
        userContent.push({ type: "image_url", image_url: { url: kbImg.url, detail: "high" } });
        const noteText = kbImg.note
          ? `[知识库参考图${kbImageIndex}，备注: ${kbImg.note}${kbImg.position ? "，图片位置: " + kbImg.position : ""}]`
          : `[知识库参考图${kbImageIndex}${kbImg.position ? "，图片位置: " + kbImg.position : ""}]`;
        userContent.push({ type: "text", text: noteText });
        kbImageIndex++;
      }
      if (compositionRefUrl) {
        userContent.push({ type: "image_url", image_url: { url: compositionRefUrl, detail: "high" } });
        userContent.push({ type: "text", text: `[构图参考图：请参考此图的构图布局${input.compositionRefNote?.trim() ? `；用户备注：${input.compositionRefNote.trim()}` : ""}]` });
      }
      if (effectRefUrl) {
        userContent.push({ type: "image_url", image_url: { url: effectRefUrl, detail: "high" } });
        userContent.push({ type: "text", text: `[效果参考图：请参考此图的视觉效果和风格${input.effectRefNote?.trim() ? `；用户备注：${input.effectRefNote.trim()}` : ""}]` });
      }

      const singleImagePrompt = STEP4_REFERENCE_PROMPT + "\n\n注意：本次只需输出单张图的方案，直接返回一个 imageReference 对象（JSON），不要包裹在数组中。";
      const response = await invokeBusinessSkill({
        messages: [
          { role: "system", content: singleImagePrompt },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        emperorSkill: { slug: "image.step4.reference" },
      });
      const newImageRef = parseLLMJson(response);

      const mergedRef = newImageRef.imageReferences?.[0] || newImageRef;
      // 同时更新AI结果和草稿。只写step4AiResult会导致刷新后优先读取旧step4UserEdit，
      // 从而让用户看到重新生成前的历史参考图。
      const updatedResult = mergeSingleStep4Reference(currentStep4, input.imageIndex, mergedRef);
      const persistedDraft = compactStep4SnapshotForStorage(updatedResult);
      await invalidateImageWorkflowStages({
        workspaceId: Number(ctx.workspaceId || project.workspaceId || 0),
        projectId: input.projectId,
        sessionId: session.id,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        fromStep: 4,
        targetStep: 4,
        fence,
        legacyPatch: {
          step4AiResult: JSON.stringify(persistedDraft),
          step4UserEdit: JSON.stringify(persistedDraft),
        },
      }).catch(asImageWorkflowVersionTrpcError);
      return { updatedResult, regeneratedIndex: input.imageIndex, newImageRef: mergedRef };
    }),




  // ─── Step 5: Optimize with A+ module selection ────────────────────
  optimizeWithAplusModule: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      selectedModules: z.array(z.object({
        moduleType: z.string(),
        moduleName: z.string(),
        position: z.number(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);
      const session = await resolveSessionForExecution(input.projectId, ctx.user, `image.step5.aplus.optimize:${input.projectId}`, ctx.workspaceId);
      if (!session) throw new Error("No workflow session found");
      if (!session.step5AiResult) throw new Error("Step 5 not generated yet");
      const fence = await captureImageWorkflowWorkerFence({
        workspaceId: Number(ctx.workspaceId || project.workspaceId || 0),
        projectId: input.projectId,
        sessionId: session.id,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        targetStep: 5,
      }).catch(asImageWorkflowVersionTrpcError);

      const currentSuggestions = session.step5UserEdit || session.step5OptimizedResult || session.step5AiResult;


      const response = await invokeBusinessSkill({
        messages: [
          { role: "system", content: STEP5_APLUS_MODULE_OPTIMIZE_PROMPT },
          {
            role: "user",
            content: `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || '未指定'}\n类目: ${project.category || '未指定'}\n\n--- 已确认的卖点体系 ---\n${session.step1UserEdit || session.step1AiResult}\n\n--- 当前图片建议 ---\n${currentSuggestions}\n\n--- 用户选择的A+模块 ---\n${JSON.stringify(input.selectedModules)}\n\n请根据用户选择的A+模块类型，重新优化A+内容部分的建议，严格按照各模块的规格要求（尺寸、字符数限制）来输出内容。`,
          },
        ],
        response_format: { type: "json_object" },
      });

      const result = parseLLMJson(response);

      const optimizedEn = result.en || result;
      const optimizedCn = result.cn || null;
      await invalidateImageWorkflowStages({
        workspaceId: Number(ctx.workspaceId || project.workspaceId || 0),
        projectId: input.projectId,
        sessionId: session.id,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        fromStep: 5,
        targetStep: 5,
        fence,
        legacyPatch: {
          step5SelectedModule: JSON.stringify(input.selectedModules),
          step5OptimizedResult: JSON.stringify(optimizedEn),
          step5OptimizedResultCn: optimizedCn ? JSON.stringify(optimizedCn) : null,
          step5UserEdit: JSON.stringify(optimizedEn),
          step5AiResultCn: optimizedCn ? JSON.stringify(optimizedCn) : session.step5AiResultCn,
        },
      }).catch(asImageWorkflowVersionTrpcError);

      return result;
    }),


  // ─── Step 5c: Optimize single A+ section with specific module style ──
  optimizeSingleAplusModule: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      sectionIndex: z.number().min(0),
      moduleType: z.string(),
      moduleName: z.string(),
      distillationBinding: distillationBindingSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);
      const session = await resolveSessionForExecution(input.projectId, ctx.user, `image.step5.aplus.optimize-one:${input.projectId}:${input.sectionIndex}`, ctx.workspaceId);
      if (!session) throw new Error("No workflow session found");
      if (!session.step5AiResult) throw new Error("Step 5 not generated yet");
      const fence = await captureImageWorkflowWorkerFence({
        workspaceId: Number(ctx.workspaceId || project.workspaceId || 0),
        projectId: input.projectId,
        sessionId: session.id,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        targetStep: 5,
      }).catch(asImageWorkflowVersionTrpcError);
      const guidanceText = await selectedGuidanceText(input, ctx, project);

      const storedCandidates = [session.step5UserEdit, session.step5OptimizedResult, session.step5AiResult].filter(Boolean);
      let currentData: any = null;
      let currentSection: any = null;
      for (const stored of storedCandidates) {
        try {
          const parsed = JSON.parse(stored!);
          const section = parsed?.aPlusContent?.sections?.[input.sectionIndex];
          if (section) { currentData = parsed; currentSection = section; break; }
        } catch { /* 尝试下一个完整版本 */ }
      }
      if (!currentData || !currentSection) {
        throw new Error(`A+模块 ${input.sectionIndex + 1} 缺少可优化内容，请先生成完整图片建议后再试`);
      }

      const styleGuideEntry = APLUS_MODULE_STYLE_GUIDE
        .split("\n")
        .find((entry) => entry.startsWith(`${input.moduleType}:`));
      const styleGuide = styleGuideEntry?.slice(input.moduleType.length + 1).trim();
      const normalizedStyle = {
        id: input.moduleType,
        name: input.moduleName || input.moduleType,
        category: currentSection.selectedModuleCategory || "A+内容模块",
        specs: currentSection.selectedModuleSpecs || styleGuide || null,
        structure: currentSection.selectedModuleStructure || styleGuide || null,
      };
      const skillContext = `产品名称: ${project.productName || project.name}
品牌: ${project.brand || '未指定'}
类目: ${project.category || '未指定'}

--- 已确认的卖点体系 ---
${session.step1UserEdit || session.step1AiResult}

--- 当前该模块的建议内容 ---
${JSON.stringify(currentSection)}

--- 用户为该模块选择的A+样式（已归一化） ---
${JSON.stringify(normalizedStyle)}
${guidanceText}
模块位置: A+模块 ${input.sectionIndex + 1}

请只返回一个可合并的A+模块JSON对象，保留原模块的moduleNumber、purpose、sellingPointRefs和position，并严格适配目标样式结构。`;

      const response = await invokeBusinessSkill({
        messages: [
          { role: "system", content: STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT },
          {
            role: "user",
            content: skillContext,
          },
        ],
        response_format: { type: "json_object" },
        emperorSkill: {
          slug: "image.step2.aplus.single.optimize",
          userId: ctx.user.id,
          workspaceId: ctx.workspaceId ?? null,
          context: skillContext,
          variables: { currentSection, normalizedStyle, sectionIndex: input.sectionIndex },
        },
      });

      const result = parseLLMJson(response);
      const optimizedSectionEn = result.en || result.section || result.module || result;
      const optimizedSectionCn = result.cn || null;
      const sections = [...(currentData.aPlusContent?.sections || [])];
      sections[input.sectionIndex] = {
        ...sections[input.sectionIndex],
        ...optimizedSectionEn,
        selectedModuleType: input.moduleType,
        selectedModuleName: normalizedStyle.name,
        selectedModuleCategory: normalizedStyle.category,
        selectedModuleSpecs: normalizedStyle.specs,
        selectedModuleStructure: normalizedStyle.structure,
      };
      const nextData = { ...currentData, aPlusContent: { ...currentData.aPlusContent, sections } };

      let nextCnData: any | null = null;
      if (optimizedSectionCn) {
        try {
          const rawCn = session.step5AiResultCn || session.step5OptimizedResultCn || "";
          nextCnData = rawCn ? JSON.parse(rawCn) : null;
          if (nextCnData?.aPlusContent?.sections) {
            const cnSections = [...nextCnData.aPlusContent.sections];
            cnSections[input.sectionIndex] = { ...cnSections[input.sectionIndex], ...optimizedSectionCn };
            nextCnData = { ...nextCnData, aPlusContent: { ...nextCnData.aPlusContent, sections: cnSections } };
          }
        } catch {
          nextCnData = null;
        }
      }

      await invalidateImageWorkflowStages({
        workspaceId: Number(ctx.workspaceId || project.workspaceId || 0),
        projectId: input.projectId,
        sessionId: session.id,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        fromStep: 5,
        targetStep: 5,
        fence,
        legacyPatch: {
          step5UserEdit: JSON.stringify(nextData),
          step5OptimizedResult: JSON.stringify(nextData),
          step5OptimizedResultCn: nextCnData ? JSON.stringify(nextCnData) : session.step5OptimizedResultCn,
          step5AiResultCn: nextCnData ? JSON.stringify(nextCnData) : session.step5AiResultCn,
        },
      }).catch(asImageWorkflowVersionTrpcError);
      return { en: optimizedSectionEn, cn: optimizedSectionCn };
    }),


  // ─── Step 5d: Recommend A+ module combination ───────────────────
  recommendAplusCombo: protectedProcedure
    .input(z.object({
      projectId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);
      const session = await resolveSessionForExecution(input.projectId, ctx.user, `image.step5.aplus.recommend:${input.projectId}`, ctx.workspaceId);
      if (!session) throw new Error("No workflow session found");

      // Gather product context
      const sellingPoints = session.step1UserEdit || session.step1AiResult || '';
      let spCount = 0;
      try {
        const spData = JSON.parse(sellingPoints);
        spCount = (spData.coreSellingPoints?.length || 0) + (spData.secondarySellingPoints?.length || 0);
      } catch { spCount = 5; }


      const response = await invokeBusinessSkill({
        messages: [
          { role: "system", content: STEP5_APLUS_COMBO_RECOMMEND_PROMPT },
          {
            role: "user",
            content: `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || '未指定'}\n类目: ${project.category || '未指定'}\n卖点数量: ${spCount}个\n\n--- 已确认的卖点体系 ---\n${sellingPoints}\n\n请根据以上产品信息，推荐3套最佳的A+模块组合方案。`,
          },
        ],
        response_format: { type: "json_object" },
      });

      return parseLLMJson(response);
    }),


  // ─── Step 5: Designer Upload (artwork images) ───────────────────
  addDesignerUpload: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      imageUrl: z.string(),
      imageNumber: z.string(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
      if (!project) throw new Error('Project not found');
      ensureWriteAccess(project, ctx.user);
      const session = await resolveSessionAccess(input.projectId, ctx.user, ctx.workspaceId);
      if (!session) throw new Error('No workflow session found');
      const approvedImageUrl = await requireApprovedDesignerAttachment({
        reference: input.imageUrl,
        ctx,
        projectId: input.projectId,
      });
      let uploads: any[] = [];
      try { uploads = JSON.parse(session.step5DesignerUploads || '[]'); } catch {}
      const idx = uploads.findIndex((u: any) => u.imageNumber === input.imageNumber);
      const entry = { id: Date.now(), imageUrl: approvedImageUrl,
        imageNumber: input.imageNumber, notes: input.notes || '', uploadedAt: new Date().toISOString() };
      if (idx >= 0) uploads[idx] = entry;
      else uploads.push(entry);
      await invalidateImageWorkflowStages({
        workspaceId: Number(ctx.workspaceId || project.workspaceId || 0),
        projectId: input.projectId,
        sessionId: session.id,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        fromStep: 5,
        legacyPatch: { step5DesignerUploads: JSON.stringify(uploads) },
      }).catch(asImageWorkflowVersionTrpcError);
      return { success: true, uploads };
    }),


  removeDesignerUpload: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      imageNumber: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
      if (!project) throw new Error('Project not found');
      ensureWriteAccess(project, ctx.user);
      const session = await resolveSessionAccess(input.projectId, ctx.user, ctx.workspaceId);
      if (!session) throw new Error('No workflow session found');
      let uploads: any[] = [];
      try { uploads = JSON.parse(session.step5DesignerUploads || '[]'); } catch {}
      uploads = uploads.filter((u: any) => u.imageNumber !== input.imageNumber);
      await invalidateImageWorkflowStages({
        workspaceId: Number(ctx.workspaceId || project.workspaceId || 0),
        projectId: input.projectId,
        sessionId: session.id,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        fromStep: 5,
        legacyPatch: { step5DesignerUploads: JSON.stringify(uploads) },
      }).catch(asImageWorkflowVersionTrpcError);
      return { success: true, uploads };
    }),


  // ─── Refine single image suggestion ─────────────────────────────
  refineSingleImage: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      imageType: z.enum(["mainImage", "secondaryImage", "aPlusSection"]),
      imageIndex: z.number().optional(), // index for secondary/aplus
      currentContent: z.string(), // JSON string of current image data
      instruction: z.string(), // user's refinement instruction
      lockedFields: z.array(z.string()).optional(), // fields to keep unchanged
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionForExecution(
        input.projectId,
        ctx.user,
        `image.refine:${input.projectId}:${input.imageType}:${input.imageIndex ?? 0}`,
        ctx.workspaceId,
      );
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);

      const imageTypeLabel = input.imageType === "mainImage" ? "主图 (Main Image)"
        : input.imageType === "secondaryImage" ? `辅图 ${(input.imageIndex || 0) + 2} (Secondary Image)`
        : `A+ 模块 ${(input.imageIndex || 0) + 1} (A+ Content Section)`;

      // Get the confirmed style for context
      const styleContext = session.step3UserEdit || session.step3AiResult || "";

      // Build locked fields instruction
      const lockedFieldsInstruction = input.lockedFields && input.lockedFields.length > 0
        ? `\n\n🔒 锁定字段（以下字段必须与原内容完全一致，严禁修改）：\n${input.lockedFields.map(f => `- ${f}`).join("\n")}\n\n即使用户的修改指令涉及这些字段，也必须保持原值不变。只能修改未锁定的字段。`
        : "";


      const response = await invokeBusinessSkill({
        messages: [
          {
            role: "system",
            content: `你是一位拥有10年设计经验的亚马逊运营专家。用户需要微调一张图片的建议内容。\n\n重要规则：\n1. 仅修改用户指定的部分，保持其他内容不变\n2. 保持与整体风格方案的一致性\n3. 输出格式必须与输入格式完全一致（相同的JSON字段结构）\n4. 同时输出英文版和中文版\n5. 返回JSON格式: { "en": {...修改后的英文版}, "cn": {...修改后的中文版} }${lockedFieldsInstruction}\n\n当前风格方案参考:\n${styleContext}`,
          },
          {
            role: "user",
            content: `图片类型: ${imageTypeLabel}\n\n当前内容:\n${input.currentContent}\n\n用户修改指令: ${input.instruction}${input.lockedFields && input.lockedFields.length > 0 ? `\n\n🔒 请注意：以下字段已被用户锁定，必须保持原值不变：${input.lockedFields.join("、")}` : ""}\n\n请根据用户的修改指令，微调上述图片建议内容。仅修改用户要求的部分，保持其他内容和整体风格不变。返回完整的修改后JSON（包含en和cn两个版本）。`,
          },
        ],
        response_format: { type: "json_object" },
      });

      const result = parseLLMJson(response);

      // Server-side enforcement: if locked fields were specified, restore original values
      if (input.lockedFields && input.lockedFields.length > 0) {
        try {
          const original = JSON.parse(input.currentContent);
          const originalEn = original.en || original;
          const originalCn = original.cn || {};
          for (const field of input.lockedFields) {
            if (result.en && originalEn[field] !== undefined) {
              result.en[field] = originalEn[field];
            }
            if (result.cn && originalCn[field] !== undefined) {
              result.cn[field] = originalCn[field];
            }
          }
        } catch { /* ignore parse errors for safety */ }
      }

      return result;
    }),
};
