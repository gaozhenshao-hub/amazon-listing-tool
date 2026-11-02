import { z } from "zod";
import { STAGE_TYPES } from "./analysis/stageGating";
import { PRODUCT_REPORT_TYPES } from "./types";

export const projectIdInput = z.object({ projectId: z.number() });
export const stageInput = z.object({ projectId: z.number(), stageType: z.enum(STAGE_TYPES) });
export const stageEditInput = stageInput.extend({ editedResult: z.string() });
export const stageConfirmInput = stageInput.extend({ editedResult: z.string().optional() });
export const attributeCrossInput = projectIdInput.extend({
  dim1Name: z.string().optional(),
  dim2Name: z.string().optional(),
});
export const tagCrossInput = projectIdInput.extend({
  dim1CategoryId: z.number().optional(),
  dim2CategoryId: z.number().optional(),
});
export const generateReportInput = projectIdInput.extend({ reportType: z.enum(PRODUCT_REPORT_TYPES) });
export const reportInput = projectIdInput.extend({ reportType: z.string() });
export const updateReportInput = reportInput.extend({ content: z.string() });
export const keywordInput = projectIdInput.extend({ keyword: z.string() });
export const competitorSiteInput = projectIdInput.extend({ domain: z.string() });
export const aiExternalInput = keywordInput.extend({
  dataType: z.enum(["google_trends", "facebook_ads", "crowdfunding"]),
});
