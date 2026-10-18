import { SellingPointDirectionDetails, SellingPointPlanSummary } from "./SellingPointPlanSummary";
import { recoverSellingPointPlan } from "./reviewRecovery";

/** Readable, lossless candidate inspection. This is not an execution or review
 * authority: the caller must validate the complete public result first. */
export function ListingCandidateFields({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">未提供</span>;
  if (typeof value !== "object") return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
  if (Array.isArray(value)) return value.length ? <ol className="list-decimal space-y-2 pl-5">{value.map((item, index) => <li key={index}><ListingCandidateFields value={item} /></li>)}</ol> : <span>无条目</span>;
  return <dl className="space-y-2">{Object.entries(value).map(([key, child]) => <div key={key} className="min-w-0 border-l pl-3"><dt className="font-medium">{key}</dt><dd className="min-w-0 text-sm"><ListingCandidateFields value={child} /></dd></div>)}</dl>;
}

export default function ListingConfiguredCandidateView({ outputs }: { outputs: Record<string, unknown> }) {
  const plan = outputs.sellingPoints && typeof outputs.sellingPoints === "object" ? recoverSellingPointPlan(outputs.sellingPoints, []) : null;
  return <div className="min-w-0 max-w-full space-y-4" aria-label="已保存配置生成的完整候选">
    {plan?.points && <section className="space-y-3" aria-label="完整七方向策划候选">
      <h4 className="font-semibold">七条方向与完整策划依据</h4><SellingPointPlanSummary metadata={plan.metadata} />
      {plan.points.map((point, index) => point && <article key={index} className="space-y-2 rounded border p-3"><h5 className="font-medium">{index + 1}. {point.theme} {point.themeZh}</h5><SellingPointDirectionDetails point={point} />
        <details><summary>本方向完整字段与依据</summary><ListingCandidateFields value={point} /></details></article>)}
    </section>}
    {Object.entries(outputs).map(([operation, value]) => <section key={operation} className="min-w-0 space-y-2 rounded border p-3"><h4 className="font-medium">{({ sellingPoints: "完整策划元数据", singleBullet: "单条五点候选", bullets: "全部五点候选", title: "标题候选（应用前须选择）", description: "产品描述候选", searchTerms: "后台搜索词候选", qa: "QA问答候选" } as Record<string, string>)[operation] || operation}</h4>
      {operation === "sellingPoints" && plan?.points ? <details><summary>查看全部策略、清单和来源字段</summary><ListingCandidateFields value={value} /></details> : <ListingCandidateFields value={value} />}
    </section>)}
  </div>;
}
