import type { TrpcContext } from "../../_core/context";
import type { STAGE_TYPES } from "./analysis/stageGating";

export const PRODUCT_REPORT_TYPES = [
  "market_overview",
  "product_analysis",
  "price_analysis",
  "brand_analysis",
  "competitor_analysis",
  "review_analysis",
  "external_analysis",
  "ai_summary",
  "review_analysis_recent_2y",
] as const;

export type ProductReportType = typeof PRODUCT_REPORT_TYPES[number];
export type ProductAnalysisStageType = typeof STAGE_TYPES[number];
export type QueuedProductAnalysisStage = Exclude<
  ProductAnalysisStageType,
  "attribute_tagging" | "information_summary"
>;
export type ProductDevelopmentContext = TrpcContext & { user: NonNullable<TrpcContext["user"]> };
export type ExternalAnalysisType = "google_trends" | "facebook_ads" | "crowdfunding";

export type ProductStageRunOptions = {
  dim1Name?: string;
  dim2Name?: string;
  dim1CategoryId?: number;
  dim2CategoryId?: number;
};
