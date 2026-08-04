import * as devDb from "../../../devDb";
import { getDb } from "../../../repositories/dbClient";
import { devPanoramaStatus } from "../../../../drizzle/schema";
import { eq } from "drizzle-orm";

export const STAGE_TYPES = [
  "attribute_tagging", "market_overview", "attribute_cross",
  "price_analysis", "brand_competition", "review_kano", "information_summary", "decision_dashboard",
] as const;

// ─── Stage Gating: Define prerequisites for each stage ─────────
type StageType = typeof STAGE_TYPES[number];

export interface GatingResult {
  canRun: boolean;
  reason: string | null;
  missingPrereqs: string[];
}

async function isPanoramaConfirmed(projectId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select().from(devPanoramaStatus).where(eq(devPanoramaStatus.projectId, projectId)).limit(1);
  return rows.length > 0 && rows[0].confirmed === 1;
}

async function areProductTagsConfirmed(projectId: number): Promise<boolean> {
  const tags = await devDb.getDevProductTags(projectId);
  if (tags.length === 0) return false;
  return tags.every(t => t.confirmed === 1);
}

export async function checkStageGating(projectId: number, stageType: StageType): Promise<GatingResult> {
  const stages = await devDb.getDevAnalysisStages(projectId);
  const stageMap = new Map(stages.map(s => [s.stageType, s]));
  const dataStatus = await devDb.getDataConfirmationStatus(projectId);

  const isStageConfirmed = (st: string) => stageMap.get(st as any)?.status === "confirmed";
  // Type-safe data status access
  const ds = dataStatus as Record<string, { confirmed: boolean; confirmedAt: Date | null; fileCount: number; totalRows: number }>;

  const missing: string[] = [];
  let reason: string | null = null;

  switch (stageType) {
    case "attribute_tagging":
      // Kept for backward compat - now handled by separate tab
      if (!ds.sales?.confirmed) {
        missing.push("销量数据未确认");
        reason = "请先在数据管理中上传并确认销量表格数据";
      }
      break;

    case "market_overview": {
      // Needs: product tags confirmed (from separate tab) + panorama confirmed
      const tagsOk1 = await areProductTagsConfirmed(projectId);
      if (!tagsOk1) {
        missing.push("属性标注未确认（请在“属性标注”tab中完成并确认）");
      }
      const panoramaOk1 = await isPanoramaConfirmed(projectId);
      if (!panoramaOk1) {
        missing.push("竞品全景分析表未确认");
      }
      if (missing.length > 0) {
        reason = `请先完成: ${missing.join("、")}`;
      }
      break;
    }

    case "attribute_cross": {
      // Needs: product tags confirmed (from separate tab) + panorama confirmed
      const tagsOk2 = await areProductTagsConfirmed(projectId);
      if (!tagsOk2) {
        missing.push("属性标注未确认（请在“属性标注”tab中完成并确认）");
      }
      const panoramaOk2 = await isPanoramaConfirmed(projectId);
      if (!panoramaOk2) {
        missing.push("竞品全景分析表未确认");
      }
      if (missing.length > 0) {
        reason = `请先完成: ${missing.join("、")}`;
      }
      break;
    }

    case "price_analysis": {
      // Needs: market_overview confirmed + panorama confirmed
      if (!isStageConfirmed("market_overview")) {
        missing.push("市场大盘未确认");
      }
      const panoramaOk3 = await isPanoramaConfirmed(projectId);
      if (!panoramaOk3) {
        missing.push("竞品全景分析表未确认");
      }
      if (missing.length > 0) {
        reason = `请先完成: ${missing.join("、")}`;
      }
      break;
    }

    case "brand_competition": {
      // Needs: market_overview confirmed + panorama confirmed
      if (!isStageConfirmed("market_overview")) {
        missing.push("市场大盘未确认");
      }
      const panoramaOk4 = await isPanoramaConfirmed(projectId);
      if (!panoramaOk4) {
        missing.push("竞品全景分析表未确认");
      }
      if (missing.length > 0) {
        reason = `请先完成: ${missing.join("、")}`;
      }
      break;
    }

    case "review_kano":
      // Needs: reviews data confirmed
      if (!ds.reviews?.confirmed) {
        missing.push("评论数据未确认");
        reason = "请先在数据管理中上传并确认评论文件数据";
      }
      break;

    case "information_summary": {
      const requiredStages: StageType[] = ["market_overview", "attribute_cross", "price_analysis", "brand_competition"];
      const labelMap: Record<string, string> = {
        market_overview: "市场大盘",
        attribute_cross: "属性交叉",
        price_analysis: "价格分析",
        brand_competition: "品牌竞争",
      };
      for (const requiredStage of requiredStages) {
        if (!isStageConfirmed(requiredStage)) missing.push(`${labelMap[requiredStage]}未确认`);
      }
      if ((ds.reviews?.fileCount || 0) > 0 && !isStageConfirmed("review_kano")) {
        missing.push("评论深度未确认");
      }
      if (missing.length > 0) reason = `请先完成并确认以下阶段: ${missing.join("、")}`;
      break;
    }

    case "decision_dashboard": {
      // The decision may only consume the human-confirmed information summary Artifact.
      const tagsOkD = await areProductTagsConfirmed(projectId);
      if (!tagsOkD) {
        missing.push("属性标注未确认");
      }
      if (!isStageConfirmed("information_summary")) missing.push("信息汇总未确认");
      if (missing.length > 0) {
        reason = `请先完成并确认以下阶段: ${missing.join("、")}`;
      }
      break;
    }
  }

  return {
    canRun: missing.length === 0,
    reason,
    missingPrereqs: missing,
  };
}


// Helper: resolve dev project access based on user role
export async function resolveDevProjectAccess(projectId: number, user: { id: number; role: string }) {
  if (user.role === 'super_admin' || user.role === 'admin' || user.role === 'designer') {
    const project = await devDb.getDevProjectByIdAdmin(projectId);
    if (!project) throw new Error("Project not found");
    return project;
  }
  const project = await devDb.getDevProjectById(projectId, user.id);
  if (!project) throw new Error("Project not found");
  return project;
}
