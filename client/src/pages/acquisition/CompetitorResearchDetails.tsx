import type { CompetitorResearch } from "../../../../shared/competitorResearch";
export default function CompetitorResearchDetails({ data, hideReviews=false }: { hideReviews?:boolean; data: { rating?: string | null; reviewCount?: number | null; research?: CompetitorResearch; variantAsins?: string[] } }) {
  const facts = data.research;
  const groups = [
    { name: '好评样本（4–5 星）', items: facts?.reviews.filter(r => r.rating !== null && r.rating >= 4) || [] },
    { name: '差评样本（1–2 星）', items: facts?.reviews.filter(r => r.rating !== null && r.rating <= 2) || [] },
    { name: '中评 / 未识别评分', items: facts?.reviews.filter(r => r.rating === null || r.rating > 2 && r.rating < 4) || [] },
  ];
  return <section className="space-y-4 rounded-xl border p-5">
    <h2 className="text-lg font-semibold">评分、变体与评论</h2>
    <div className="grid gap-3 sm:grid-cols-3 text-sm">
      <div>页面评分：{data.rating ?? '未采到'} / 5</div>
      <div>页面评价数量：{data.reviewCount ?? '未采到'}</div>
      <div>首次可售日期：{facts?.dateFirstAvailable || '未采到'}</div>
      <div>近期购买量：{facts?.boughtPastMonth || '本次页面未返回'}</div>
      {facts?.deliveryLocation && <div>采集参考配送地：{facts.deliveryLocation}</div>}
    </div>
    <p className="text-xs text-muted-foreground">首次可售日期来自 Date First Available，不等同于核实过的上架日期。评分与评价数量可能由多个变体共享；评价数量不代表已取得的评论正文数。</p>
    <h3 className="font-medium">变体情况</h3>
    <p className="text-xs text-muted-foreground">精确销量未公开。下表保留各 ASIN 页面“过去一个月购买量”原文，是估计区间或下限，可能共享，不能当作该变体精确销量。每次最多补采 5 个其他变体，遇访问限制停止补采；未返回不是销量为 0。</p>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">ASIN</th><th>规格</th><th>页面购买量提示</th><th>采集状态</th></tr></thead><tbody>
      {(facts?.variants || (data.variantAsins || []).map(asin => ({ asin, attributes: [], boughtPastMonth: null, status: 'not_fetched' }))).map(v => <tr key={v.asin} className="border-b"><td className="p-2">{v.asin}</td><td>{v.attributes.join(' / ') || '未返回'}</td><td>{v.boughtPastMonth || '未返回'}</td><td>{v.status === 'collected' ? '已读取页面' : v.status === 'unavailable' ? '访问失败' : '尚未补采'}</td></tr>)}
    </tbody></table></div>
    {!facts && <p className="text-sm text-muted-foreground">这是旧版采集记录，重新采集后可补充变体、日期和评论样本。</p>}
    <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
      <h3 className="font-medium">Customers say · 亚马逊评论总结</h3>
      <p className="text-xs text-muted-foreground">亚马逊根据买家评论生成的 AI 总结。主题次数为页面显示的提及次数，不等于独立评论数或好差评比例。</p>
      {facts?.customersSay ? <><p className="whitespace-pre-wrap text-sm">{facts.customersSay.summary}</p><div className="flex flex-wrap gap-2">{facts.customersSay.aspects.map(a => <span key={a.label} className="rounded border bg-background px-3 py-2 text-sm">{a.label} {a.mentions !== null ? `（${a.mentions}）` : ''} · {{positive:'正面',mixed:'褒贬不一',negative:'负面',unknown:'倾向未识别'}[a.sentiment]}</span>)}</div></> : <p className="text-sm text-muted-foreground">本次未取得评论总结；旧记录可重新采集补充。</p>}
    </div>
    {!hideReviews&&<><h3 className="font-medium">评论内容</h3>
    {facts?.reviewFetchStatus && facts.reviewFetchStatus !== 'collected' && <p className="text-sm text-amber-700">{facts.reviewFetchStatus === 'login_required' ? '本次亚马逊响应要求登录后查看评论，未返回评论正文。' : facts.reviewFetchStatus === 'blocked' ? '本次评论请求被亚马逊拦截。' : facts.reviewFetchStatus === 'request_failed' ? '本次评论请求失败，已保留其他成功采集的信息。' : '本次页面未返回可读取的评论正文。'} 这不表示商品没有评论。</p>}
    <p className="text-xs text-muted-foreground">展示自动采集和你粘贴补充的评论样本，不代表全部评论或好差评比例。没有差评样本不等于没有差评；自动采集缺少正文时，可用上方“粘贴页面评论”补充。</p>
    {groups.map(group => <details key={group.name} open={group.items.length > 0} className="rounded border p-3"><summary className="cursor-pointer text-sm font-medium">{group.name} · {group.items.length} 条</summary>{!group.items.length ? <p className="mt-2 text-sm text-muted-foreground">未取得此类评论样本</p> : group.items.map(r => <article key={r.id} className="mt-3 space-y-1 border-t pt-3 text-sm"><p className="font-medium">{r.rating ?? '评分未知'} 星 · {r.title}</p><p className="text-xs text-muted-foreground">{r.date} {r.variant} {r.verifiedPurchase ? '已验证购买' : ''} {r.source === 'browser_paste' ? '· 用户粘贴补充' : ''}</p><p className="whitespace-pre-wrap break-words">{r.body}</p></article>)}</details>)}
    </>}
  </section>;
}
