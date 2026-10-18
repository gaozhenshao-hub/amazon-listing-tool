import { z } from "zod";
import sha256 from "crypto-js/sha256.js";
import { canonicalCompetitorResearchEvidence } from "./competitorResearchEvidence";

export const VIDEO_WORKFLOW_KIND = "video.workflow.configured.v1";
export const VideoWorkflowIdSchema = z.number().int().min(1).max(2147483647);
export const VideoWorkflowHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const VideoWorkflowUuidSchema = z.string().uuid().refine(value => value === value.toLowerCase());
export const VideoWorkflowOperationSchema = z.enum(["competitor_analysis", "competitor_summary", "product_info", "sections", "subtopics", "shots", "edit_scripts"]);
export type VideoWorkflowOperation = z.infer<typeof VideoWorkflowOperationSchema>;
export const VIDEO_WORKFLOW_DEFINITIONS = Object.freeze({
  competitor_analysis: { stage: "video_competitor_analysis", slug: "video.competitor.analysis", input: "video_competitor_context_v1", output: "video_competitor_result_v1", node: "stage_0a" },
  competitor_summary: { stage: "video_competitor_analysis", slug: "video.competitor.analysis", input: "video_competitor_context_v1", output: "video_competitor_result_v1", node: "stage_0a" },
  product_info: { stage: "video_section_plan", slug: "video.section.plan", input: "video_section_context_v1", output: "video_section_result_v1", node: "stage_0b" },
  sections: { stage: "video_section_plan", slug: "video.section.plan", input: "video_section_context_v1", output: "video_section_result_v1", node: "stage_1" },
  subtopics: { stage: "video_section_plan", slug: "video.section.plan", input: "video_section_context_v1", output: "video_section_result_v1", node: "stage_2" },
  shots: { stage: "video_shot_detail", slug: "video.shot.detail", input: "video_shot_context_v1", output: "video_shot_result_v1", node: "stage_3" },
  edit_scripts: { stage: "video_edit_script", slug: "video.edit.script", input: "video_edit_context_v1", output: "video_edit_result_v1", node: "stage_4" },
} as const);
export const videoWorkflowCanonical = canonicalCompetitorResearchEvidence;
export const videoWorkflowHash = (value: unknown) => sha256(videoWorkflowCanonical(value)).toString();
export const VideoWorkflowIdentitySchema = z.object({ userId: VideoWorkflowIdSchema, workspaceId: VideoWorkflowIdSchema }).strict();
export const VideoWorkflowScopeSchema = z.object({ expectedWorkspaceId: VideoWorkflowIdSchema, projectId: VideoWorkflowIdSchema, videoScriptId: VideoWorkflowIdSchema }).strict();
export const VideoWorkflowOperationInputSchema = VideoWorkflowScopeSchema.extend({ operationId: VideoWorkflowUuidSchema }).strict();
export const VideoWorkflowOptionsInputSchema = VideoWorkflowOperationInputSchema.extend({ operation: VideoWorkflowOperationSchema, competitorScriptId: VideoWorkflowIdSchema.nullable().default(null) }).strict();
export const VideoWorkflowStartInputSchema = VideoWorkflowOptionsInputSchema.extend({ expectedSourceHash: VideoWorkflowHashSchema, expectedRuntimeHash: VideoWorkflowHashSchema,
  maxCostCents: z.number().int().min(0).max(1000000000), chargeConfirmed: z.literal(true) }).strict().superRefine((value, ctx) => {
  if ((value.operation === "competitor_analysis") !== (value.competitorScriptId !== null)) ctx.addIssue({ code: "custom", message: "Exact competitor required only for competitor analysis" });
});
const text = z.string().max(20000), short = z.string().min(1).max(200), duration = z.number().finite().positive().max(999.9);
const json = z.record(z.string(), z.unknown()).superRefine((value, ctx) => { try { videoWorkflowCanonical(value); } catch { ctx.addIssue({ code: "custom", message: "Invalid JSON" }); } });
const list = z.array(text).max(500);
const section = z.object({ section_code: z.string().min(1).max(20), scene_name: text, section_name: short, section_name_en: text, shooting_method: z.enum(["model_narration", "live_action", "ai_generated", "mixed", "screen_recording"]),
  duration_budget: duration, selling_point_refs: list, pain_point_refs: list, description: text, shot_type_suggestion: z.string().max(100), props_suggestion: list }).strict();
const subtopic = z.object({ subtopic_name: short, subtopic_name_en: text, duration_budget: duration, shot_count: z.number().int().min(1).max(100), selling_point_ref: text, description: text }).strict();
const shot = z.object({ section_code: z.string().min(1).max(20), subtopic_name: short, shot_code: z.string().min(1).max(20), duration: duration.max(99.9), shot_description: text, scene_location: z.string().max(100),
  camera_angle: z.enum(["extreme_closeup", "closeup", "medium_closeup", "medium", "medium_wide", "wide", "extreme_wide"]), camera_movement: z.string().max(100),
  overlay_text_en: text, overlay_text_cn: text, narration_en: text, narration_cn: text, subtitle_en: text, subtitle_cn: text,
  narrator_type: z.enum(["voiceover", "model_narration", "text_only", "none"]), generation_strategy: z.enum(["real_shoot", "ai_image", "ai_video", "stock_footage", "screen_record", "mixed"]),
  reuse_from_shot_code: z.string().max(20).nullable(), designated_assets: z.array(z.unknown()).max(100).optional(), color_scheme: z.string().max(200), props: z.array(z.unknown()).max(100), notes: text,
  reference_notes: text, reference_image_url: text.nullable().optional() }).strict();
export const VideoWorkflowCandidates = {
  competitor_analysis: z.object({ structure_analysis: json, visual_language: json, copywriting_analysis: json, strengths: list, weaknesses: list, reusable_patterns: z.array(json).max(500) }).strict(),
  competitor_summary: z.object({ common_structure: json, optimal_duration_allocation: z.array(json).max(500), differentiable_opportunities: z.array(json).max(500), recommended_structure: json, style_recommendation: json }).strict(),
  product_info: z.object({ basic_info: json, selling_points_hierarchy: z.array(json).max(500), pain_points_from_reviews: z.array(json).max(500), key_specs: z.array(json).max(500), keywords_for_overlay: list, listing_bullet_mapping: z.array(json).max(500), brand_info: json }).strict(),
  sections: z.object({ sections: z.array(section).min(1).max(100), total_duration: duration, narrative_mode: text, duration_allocation_rationale: text, style_guidance: text }).strict(),
  subtopics: z.object({ sections: z.array(z.object({ section_code: z.string().min(1).max(20), subtopics: z.array(subtopic).min(1).max(100) }).strict()).min(1).max(100), reuse_suggestions: z.array(json).max(500), shot_distribution: json }).strict(),
  shots: z.object({ shots: z.array(shot).min(1).max(1000) }).strict(),
  edit_scripts: z.object({ edit_scripts: z.array(z.object({ edit_name: short, video_purpose: z.enum(["spv_ad", "sbv_ad", "main_listing", "aplus", "social_media", "other"]), max_duration: duration,
    edit_style: z.string().max(100), section_mapping: z.array(json).max(500), description: text }).strict()).min(1).max(100) }).strict(),
};
export function parseVideoWorkflowCandidate(operation: VideoWorkflowOperation, value: unknown): Record<string, unknown> {
  const parsed = VideoWorkflowCandidates[operation].parse(value);
  if (new TextEncoder().encode(videoWorkflowCanonical(parsed)).length > 512 * 1024) throw new Error("VIDEO_RESULT_LIMIT");
  return parsed;
}
export const VideoWorkflowSourceSchema = z.object({ version: z.literal(1), identity: VideoWorkflowIdentitySchema, scope: VideoWorkflowScopeSchema,
  operation: VideoWorkflowOperationSchema, competitorScriptId: VideoWorkflowIdSchema.nullable(), tables: z.record(z.string(), z.array(json).max(10000)),
  context: json, sourceHash: VideoWorkflowHashSchema }).strict().superRefine((value, ctx) => {
  const { sourceHash, ...body } = value;
  if (sourceHash !== videoWorkflowHash(body) || new TextEncoder().encode(videoWorkflowCanonical(value)).length > 8 * 1024 * 1024) ctx.addIssue({ code: "custom", message: "Invalid complete source binding" });
});
export const VideoWorkflowApplyInputSchema = VideoWorkflowOperationInputSchema.extend({ runOperationId: VideoWorkflowUuidSchema, expectedSourceHash: VideoWorkflowHashSchema,
  expectedResultHash: VideoWorkflowHashSchema, replaceConfirmed: z.boolean(), confirmHumanReview: z.literal(true) }).strict().refine(value => value.runOperationId !== value.operationId);
export const VideoWorkflowApplyOperationInputSchema = VideoWorkflowOperationInputSchema.extend({ runOperationId: VideoWorkflowUuidSchema }).strict();
export const VideoWorkflowApplyReceiptSchema = z.object({ identity: VideoWorkflowIdentitySchema, scope: VideoWorkflowApplyOperationInputSchema,
  status: z.enum(["committed", "cancelled", "not_found"]), requestHash: VideoWorkflowHashSchema.nullable(), resultHash: VideoWorkflowHashSchema.nullable(),
  afterHash: VideoWorkflowHashSchema.nullable(), version: VideoWorkflowIdSchema.nullable(), reasonCode: z.string().max(100).nullable() }).strict();
export const VideoWorkflowViewSchema = z.object({ identity: VideoWorkflowIdentitySchema, scope: VideoWorkflowOperationInputSchema,
  state: z.enum(["not_found", "queued", "running", "dispatched", "succeeded", "failed", "canceled", "outcome_unknown"]),
  runId: z.string().max(80).nullable(), operation: VideoWorkflowOperationSchema.nullable(), sourceHash: VideoWorkflowHashSchema.nullable(), resultHash: VideoWorkflowHashSchema.nullable(),
  candidate: json.nullable(), sourceCurrent: z.boolean(), configuration: z.object({ revision: VideoWorkflowIdSchema, hash: VideoWorkflowHashSchema }).strict().nullable(),
  errorCode: z.string().max(160).nullable() }).strict().superRefine((value, ctx) => {
  if (value.candidate && value.operation) { try { parseVideoWorkflowCandidate(value.operation, value.candidate); } catch { ctx.addIssue({ code: "custom", message: "Invalid candidate" }); } }
  if ((value.state === "succeeded") !== (value.candidate !== null && value.resultHash !== null)) ctx.addIssue({ code: "custom", message: "Candidate state mismatch" });
});
export const VideoWorkflowOptionsResultSchema = z.object({ identity: VideoWorkflowIdentitySchema, request: VideoWorkflowOptionsInputSchema,
  available: z.boolean(), reasonCode: z.string().max(160).nullable(), sourceHash: VideoWorkflowHashSchema.nullable(), runtimeHash: VideoWorkflowHashSchema.nullable(),
  configuration: z.object({ revision: VideoWorkflowIdSchema, hash: VideoWorkflowHashSchema }).strict().nullable(), maxCalls: z.literal(1), maxCostCents: z.number().int().nonnegative().nullable(),
  mediaProcessing: z.literal("text_and_structured_references_only"), legacyTasks: z.literal("original_legacy_protocol_no_configuration_overlay") }).strict();
export const VideoWorkflowHistoryInputSchema = VideoWorkflowScopeSchema;
export const VideoWorkflowHistoryResultSchema = z.object({ identity: VideoWorkflowIdentitySchema, scope: VideoWorkflowScopeSchema, complete: z.boolean(),
  operations: z.array(z.object({ operationId: VideoWorkflowUuidSchema, operation: VideoWorkflowOperationSchema, competitorScriptId: VideoWorkflowIdSchema.nullable(), state: VideoWorkflowViewSchema.shape.state, sourceHash: VideoWorkflowHashSchema, createdAt: z.string().max(40) }).strict()).max(50) }).strict();
export type VideoWorkflowIdentity = z.infer<typeof VideoWorkflowIdentitySchema>;
export type VideoWorkflowScope = z.infer<typeof VideoWorkflowScopeSchema>;
export type VideoWorkflowOperationInput = z.infer<typeof VideoWorkflowOperationInputSchema>;
export type VideoWorkflowOptionsInput = z.infer<typeof VideoWorkflowOptionsInputSchema>;
export type VideoWorkflowStartInput = z.infer<typeof VideoWorkflowStartInputSchema>;
export type VideoWorkflowApplyInput = z.infer<typeof VideoWorkflowApplyInputSchema>;
export type VideoWorkflowApplyOperationInput = z.infer<typeof VideoWorkflowApplyOperationInputSchema>;
export type VideoWorkflowSource = z.infer<typeof VideoWorkflowSourceSchema>;
export type VideoWorkflowView = z.infer<typeof VideoWorkflowViewSchema>;
