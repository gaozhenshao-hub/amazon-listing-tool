import { cancelAiJob } from "../../ai_os/services/jobRunner";
import { deletePanoramaProductRecord } from "./panoramaProductRepository";

export async function deletePanoramaProduct(input: {
  projectId: number;
  productId: number;
}) {
  const result = await deletePanoramaProductRecord(input);
  await Promise.allSettled(result.obsoleteRunIds.map((runId) => (
    cancelAiJob(runId, "全景产品已删除，旧分析任务失效")
  )));
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
