import { z } from "zod";
const id = z.number().int().positive().safe(), count = z.number().int().nonnegative().max(300);
const verified = z.object({ mode: z.literal("manual_revision"), status: z.literal("verified"), revisionVersion: id,
  confirmedSnapshotId: id, kept: count, excluded: count, total: count }).strict().refine(value => value.kept + value.excluded === value.total && value.kept > 0);

/** A version marker is not proof. Only the server's fully replayed scope-bound
 * coverage may supply counts; old cached or unavailable shapes show no zeroes. */
export default function ManualImageRevisionNotice({ manual, coverage }: { manual: boolean; coverage: unknown }) {
  if (!manual) return null;
  const result = verified.safeParse(coverage);
  return <aside className="space-y-1 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950" aria-label="人工图片版本来源">
    {result.success ? <><p className="font-medium">人工确认修订 v{result.data.revisionVersion} · 独立图片版本</p>
      <p>本修订保留 {result.data.kept} 张，主动排除 {result.data.excluded} 张，共审核 {result.data.total} 个图位。排除不计作下载失败，也不表示商品不存在这些图片。</p></>
      : <><p className="font-medium">人工版本覆盖范围暂不可核验</p><p>尚未核验完整原件、修订及图片绑定，因此暂不展示该版本图片，也不提供数量、完整率或“缺失为零”的结论；请刷新重试。</p></>}
    <p>此修订排除不删除旧版图片、标签或 AI 分析。新版本不是自动覆盖旧版；图片来源核验也不等于 OCR／问答证据完整。</p>
  </aside>;
}
