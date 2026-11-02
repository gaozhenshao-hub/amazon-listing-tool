import { TRPCError } from "@trpc/server";
import type { ImageWorkflowSession } from "../../../../drizzle/schema/image";
import { requireClassifiedStep4KbUses } from "./imageKbUsePolicy";

type ExportMode = "complete";
type ApprovedImageSession = Pick<ImageWorkflowSession, "projectId" | "id"> & Partial<ImageWorkflowSession>;

/** This is a deliverable gate, not a general data-read permission or an archival API. */
export function requireImageDeliverableAccess(input: {
  role: string;
  workspaceId: number | null | undefined;
  project: { workspaceId?: number | null };
}) {
  if (input.role !== "super_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "仅超级管理员可导出已确认的图片成果；项目成员仍可在线审阅" });
  }
  if (!input.workspaceId || Number(input.project.workspaceId) !== Number(input.workspaceId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "只能导出当前已授权工作空间内的项目" });
  }
}

function validObjectJson(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    return !!parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length > 0;
  } catch {
    return false;
  }
}

/**
 * Only the exact human-confirmed step payload is available to a deliverable.
 * Old external/bare image URLs have no verified origin/use permission. Until
 * the asset ledger is introduced, do not embed them as production assets.
 */
export function requireApprovedImageSession(session: ImageWorkflowSession | null | undefined, mode: ExportMode): ApprovedImageSession {
  if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "尚未创建图片工作流" });
  const required = [0, 1, 2, 3, 4, 5, 6];
  for (const step of required) {
    const confirmation = session[`step${step}Confirmed` as keyof ImageWorkflowSession];
    // confirmStep0 supports approval of the already generated composite
    // without saving a separate userEdit. Never apply that fallback elsewhere.
    const edit = step === 0
      ? session.step0UserEdit || session.step0AiResult
      : session[`step${step}UserEdit` as keyof ImageWorkflowSession];
    if (Number(confirmation) !== 1 || !validObjectJson(edit)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Step ${step} 尚无当前人工确认的完整方案，不能作为业务成果导出` });
    }
  }
  requireClassifiedStep4KbUses(session.step4UserEdit);
  // Designer uploads are stored as legacy JSON URLs, not as source-verified
  // owned-product assets. They must not be labelled as an approved handoff.
  let uploads: unknown;
  try { uploads = JSON.parse(session.step5DesignerUploads || "[]"); } catch {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "设计师附件来源不可核验，请先完成资产归类" });
  }
  if (!Array.isArray(uploads) || uploads.length > 0) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "旧设计师附件未完成来源与用途审核，暂不能作为业务成果导出" });
  }

  // Do not send stored AI drafts, editable display hydrations or arbitrary
  // legacy asset URLs to an HTML builder which might label them approved.
  const result: ApprovedImageSession = { id: session.id, projectId: session.projectId, step5DesignerUploads: "[]" };
  for (const step of required) {
    const key = `step${step}UserEdit` as keyof ImageWorkflowSession;
    const value = JSON.parse((step === 0 ? session.step0UserEdit || session.step0AiResult : session[key]) as string) as Record<string, unknown>;
    const sanitized = stripUnclassifiedImageUrls(value);
    (result as Record<string, unknown>)[key] = JSON.stringify(sanitized);
    (result as Record<string, unknown>)[`step${step}Confirmed`] = 1;
  }
  return result;
}

function stripUnclassifiedImageUrls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUnclassifiedImageUrls);
  if (typeof value === "string") return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, detail]) => [
    key,
    /(?:imageUrl|thumbnailUrl|compositionRefImageUrl|effectRefImageUrl|imageSrc|src|url)$/i.test(key)
      ? null : stripUnclassifiedImageUrls(detail),
  ]));
}
