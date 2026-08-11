import { cancelAiJob } from "../../ai_os/services/jobRunner";
import {
  addPanoramaProductRecord,
  deletePanoramaProductRecord,
  type AddPanoramaProductInput,
} from "./panoramaProductRepository";

async function cancelObsoleteRuns(runIds: string[], reason: string) {
  await Promise.allSettled(runIds.map((runId) => cancelAiJob(runId, reason)));
}

export async function addPanoramaProduct(input: AddPanoramaProductInput) {
  const result = await addPanoramaProductRecord(input);
  await cancelObsoleteRuns(result.obsoleteRunIds, "全景产品已新增，旧分析任务失效");
  return {
    productId: result.productId,
    asin: result.asin,
    title: result.title,
    totalProducts: result.totalProducts,
    canceledRuns: result.obsoleteRunIds.length,
  };
}

export async function deletePanoramaProduct(input: {
  projectId: number;
  productId: number;
}) {
  const result = await deletePanoramaProductRecord(input);
  await cancelObsoleteRuns(result.obsoleteRunIds, "全景产品已删除，旧分析任务失效");
  return {
    productId: result.product.id,
    asin: result.product.asin,
    title: result.product.title,
    deletedTags: result.deletedTags,
    deletedReviews: result.deletedReviews,
    totalProducts: result.totalProducts,
    canceledRuns: result.obsoleteRunIds.length,
  };
}
