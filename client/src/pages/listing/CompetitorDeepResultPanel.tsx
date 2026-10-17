import type { ReactNode } from "react";
import type { CompetitorDeepResultView } from "./competitorDeepResultView";

type AvailableView = Extract<CompetitorDeepResultView, { status: "available" }>;
type Display = AvailableView["result"];
type Citation = Display["title"]["keywords"][number]["citation"];
type Claim = Display["summary"]["advantages"][number];
type Term = Display["title"]["keywords"][number];
const wrap = "min-w-0 max-w-full whitespace-pre-wrap [overflow-wrap:anywhere]";

function Study({ title, children }: { title: string; children: ReactNode }) {
  return <section className="min-w-0 max-w-full space-y-3 rounded-lg border bg-muted/30 p-4" aria-label={title}>
    <h3 className="font-semibold">{title}</h3>{children}
  </section>;
}
function sourceLabel(sourceId: string) {
  if (/^analysis:\d+:title$/u.test(sourceId)) return "标题原文";
  const bullet = /^analysis:\d+:bullet:(\d+)$/u.exec(sourceId);
  return bullet ? `第 ${bullet[1]} 条五点原文` : "来源原文";
}
function Quote({ citation }: { citation: Citation }) {
  return <details className="min-w-0 max-w-full rounded border bg-background px-2 py-1 text-xs">
    <summary className="cursor-pointer [overflow-wrap:anywhere]">查看引用：{sourceLabel(citation.sourceId)}</summary>
    <p className={`${wrap} mt-2 text-muted-foreground`}>{citation.sourceId} · 字符位置 [{citation.start}, {citation.end})</p>
    <blockquote className={`${wrap} mt-2 border-l-2 pl-2`}>{citation.quote}</blockquote>
  </details>;
}
function Terms({ label, items }: { label: string; items: Term[] }) {
  return <div className="min-w-0 max-w-full space-y-2">
    <h4 className="text-xs font-medium">{label}</h4>
    {items.length ? <div className="flex min-w-0 max-w-full flex-wrap gap-2">{items.map(term => <div key={term.entryId} className="min-w-0 max-w-full space-y-1 rounded border bg-background p-2">
      <p className={wrap}>{term.text}</p><p className={`${wrap} text-xs text-muted-foreground`}>{term.zh}</p>
      <p className={`${wrap} text-xs text-muted-foreground`}>引用编号：{term.entryId}</p><Quote citation={term.citation} />
    </div>)}</div> : <p className="text-xs text-muted-foreground">本次资料未形成此类结论。</p>}
  </div>;
}
function ClaimView({ claim }: { claim: Claim }) {
  const labels = { seller_claim: "商家宣称", review_feedback: "评论反馈", inference: "分析推断" };
  return <div className="min-w-0 max-w-full space-y-1">
    <p className={wrap}>{claim.text}</p>
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer">依据与引用 · {labels[claim.basis]}</summary>
      <ul className="mt-1 list-inside list-disc space-y-1">{claim.references.map(reference => <li key={reference} className={wrap}>{reference}</li>)}</ul>
      <p className="mt-1">引用编号对应上方标题、卖点或评论主题；推断不等于已验证的产品事实。</p>
    </details>
  </div>;
}
function ClaimList({ label, items }: { label: string; items: Claim[] }) {
  return <div className="min-w-0 max-w-full space-y-2"><h4 className="font-medium">{label}</h4>
    {items.length ? <ul className="list-disc space-y-3 pl-5">{items.map((claim, index) => <li key={index} className="min-w-0 max-w-full"><ClaimView claim={claim} /></li>)}</ul>
      : <p className="text-xs text-muted-foreground">本次资料不足以形成此类结论。</p>}
  </div>;
}

/** Pure friend-workflow presentation of an already scoped, validated view.
 * No query, mutation, upload, confirmation or model execution belongs here. */
export default function CompetitorDeepResultPanel({ view }: { view: AvailableView }) {
  const result = view.result, title = result.listingSources.find(source => source.kind === "title"), bullets = result.listingSources.filter(source => source.kind === "bullet");
  const buyers = result.buyers, reviewCoverage = result.coverage.reviews;
  return <article className="min-w-0 max-w-full space-y-4 text-sm [overflow-wrap:anywhere]" aria-label="竞品四栏研究结果" data-testid="competitor-deep-result-panel">
    <header className="min-w-0 max-w-full space-y-2 border-b pb-3">
      <p className="font-semibold">{view.identity.asin} · 已保存研究候选 · 未确认</p>
      <p className="text-xs text-muted-foreground">生成时间：<time dateTime={result.generatedAt}>{result.generatedAt}</time></p>
      <p className="rounded border bg-blue-50 p-3 text-xs text-blue-900">范围仅限已保存的标题、五点及可用的导入评论样本，不代表市场全部评论。图片内容与 OCR、真实问答均未分析；四栏展示不表示完整研究已完成。</p>
      <p className="text-xs text-muted-foreground">候选结果，仅供复核；此处不确认或自动用于 Listing 生成。</p>
      {view.sourceChanged && <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-amber-900">来源或记录版本已变化：以下为历史候选，未确认，不能视为当前资料的分析结论。</p>}
      <details className="min-w-0 max-w-full text-xs text-muted-foreground">
        <summary className="cursor-pointer">来源与校验标识</summary>
        <dl className="mt-2 space-y-1"><dt>当前记录修订</dt><dd className={wrap}>{view.currentRevision}</dd>
          <dt>候选结果标识</dt><dd className={wrap}>{result.resultHash}</dd>
          <dt>证据标识</dt><dd className={wrap}>{result.source.evidenceHash}</dd>
          <dt>来源记录修订</dt><dd className={wrap}>{result.source.identity.revision}</dd>
          {result.reviewSource && <><dt>导入评论文件</dt><dd className={wrap}>{result.reviewSource.source.fileName}</dd></>}
        </dl>
      </details>
    </header>

    <Study title="标题分析">
      <div className="space-y-1"><h4 className="font-medium">标题原文 / 中文翻译</h4>
        <p className={wrap}>{title?.text ?? "标题原文未保存。"}</p>
        <p className={`${wrap} text-muted-foreground`}>{result.title.titleZh ?? "暂无已核对的标题译文。"}</p>
      </div>
      {result.title.status === "missing" ? <p className="text-xs text-muted-foreground">标题资料缺失，未执行标题分析。</p> : <>
        <Terms label="主要关键词" items={result.title.keywords} />
        <Terms label="主要修饰词" items={result.title.modifiers} />
        <Terms label="场景 / 适配词" items={result.title.scenarios} />
      </>}
      <p className="text-xs text-muted-foreground">副标题未纳入本次研究。中文翻译与关键词解释属于候选分析，不替代原文。</p>
    </Study>

    <Study title="卖点分析">
      <div className="min-w-0 max-w-full space-y-2"><h4 className="font-medium">五点描述 / 中文翻译</h4>
        {bullets.length ? <ol className="list-decimal space-y-3 pl-5">{bullets.map(source => {
          const translation = result.selling.bulletTranslations.find(item => item.sourceId === source.sourceId);
          return <li key={source.sourceId} className="min-w-0 max-w-full space-y-1"><p className={wrap}>{source.text}</p>
            <p className={`${wrap} text-xs text-muted-foreground`}>{translation?.zh ?? "暂无已核对的五点译文。"}</p>
            {translation && <Quote citation={translation.citation} />}
          </li>;
        })}</ol> : <p className="text-xs text-muted-foreground">五点原文未保存；不得由标题推补五点内容。</p>}
      </div>
      {result.selling.status === "missing" ? <p className="text-xs text-muted-foreground">标题与五点资料缺失，未执行卖点分析。</p> : <>
        <div className="min-w-0 max-w-full overflow-x-auto" data-testid="competitor-selling-table-scroll">
          <table className="w-full min-w-[42rem] table-fixed text-left text-xs">
            <caption className="sr-only">卖点分析表</caption>
            <thead><tr>{["卖点", "卖点描述", "表达强度", "频次", "位置", "金句"].map(label => <th key={label} scope="col" className="border-b p-2">{label}</th>)}</tr></thead>
            <tbody>{result.selling.points.map(point => <tr key={point.entryId} className="align-top">
              <th scope="row" className="border-b p-2 font-medium [overflow-wrap:anywhere]">{point.name}<span className="mt-1 block text-xs font-normal text-muted-foreground">引用编号：{point.entryId}</span></th>
              <td className="border-b p-2"><p className={wrap}>{point.description}</p></td>
              <td className="border-b p-2">{point.strength}</td>
              <td className="border-b p-2">{point.frequency} 处<span className="block text-muted-foreground">{point.sourceFrequency} 个文字来源</span></td>
              <td className="space-y-2 border-b p-2">{point.occurrences.map((citation, index) => <Quote key={index} citation={citation} />)}</td>
              <td className="space-y-2 border-b p-2"><p className={wrap}>{point.goldenQuote || "未提供已核对金句。"}</p>{point.goldenCitation && <Quote citation={point.goldenCitation} />}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">频次仅按标题和五点原文中的独立表达位置统计，不是评论提及次数。图片及 OCR 未分析，不参与频次。</p>
      </>}
    </Study>

    <Study title="买家问题与评论分析">
      {reviewCoverage.status === "unavailable" ? <p className="text-xs text-muted-foreground">原评论来源不可用，样本总数未知，不能视为 0 条。</p>
        : <p className="text-xs text-muted-foreground">本次导入样本共 {buyers.sampleCount} 条原评论，已核对 {buyers.accountedReviewCount} 条。比例＝该主题评论数 ÷ 本次导入样本数；同一评论可涉及多个主题，好差评主题比例不必相加为 100%。</p>}
      {buyers.missingReason === "no_matching_reviews" && <p className="text-xs text-muted-foreground">已核对导入文件，没有匹配当前 ASIN 的原评论；未生成评论主题。</p>}
      <div className="space-y-2"><h4 className="font-medium">买家关注与满足情况</h4>
        <p className="text-xs text-muted-foreground">以下关注点由评论主题推导，不是真实问答或已确认的产品承诺。</p>
        {buyers.concerns.length ? buyers.concerns.map(concern => <div key={concern.entryId} className="min-w-0 max-w-full space-y-1 rounded border p-3">
          <p className={`${wrap} font-medium`}>{concern.question}</p><p className={wrap}>{concern.status} · {concern.explanation}</p>
          <p className={`${wrap} text-xs text-muted-foreground`}>引用编号：{concern.entryId}；评论主题：{concern.themeIds.join("、")}</p>
        </div>) : <p className="text-xs text-muted-foreground">本次资料未形成可展示的买家关注结论。</p>}
      </div>
      {([["主要好评点", "positive"], ["主要差评点", "negative"]] as const).map(([label, sentiment]) => {
        const groups = buyers.groups.filter(group => group.sentiment === sentiment);
        return <div key={sentiment} className="min-w-0 max-w-full space-y-3"><h4 className="font-medium">{label}</h4>
          {groups.length ? groups.map((group, index) => <div key={group.entryId} className="min-w-0 max-w-full rounded border bg-background p-3">
            <p className={wrap}>{index + 1}. {group.name} <strong>{group.percentage}%</strong>（{group.count}/{group.denominator}）</p>
            <p className={`${wrap} mt-1 text-xs text-muted-foreground`}>引用编号：{group.entryId}；主题来源：{group.themeIds.join("、")}</p>
            <details className="mt-2 min-w-0 max-w-full"><summary className="cursor-pointer text-xs">展开代表性评论原文（{group.evidenceSelection.shownCount} 条）</summary>
              <p className="mt-2 text-xs text-muted-foreground">按原文件顺序展示最多 {group.evidenceSelection.limit} 条完整原文；本主题匹配 {group.evidenceSelection.matchingReviewCount} 条，另有 {group.evidenceSelection.omittedCount} 条未在此展示。展示样例数不是统计分母。</p>
              {group.evidence.map(review => <blockquote key={review.reviewId} className="my-3 min-w-0 max-w-full space-y-2 rounded border bg-background p-3">
                <p className="text-xs text-muted-foreground">评分：{review.rating === null ? "未知" : `${review.rating} / 5`}</p>
                {review.title !== null && <p className={`${wrap} font-medium`}>{review.title}</p>}
                <p className={wrap}>{review.body}</p>
                <p className={`${wrap} text-xs text-muted-foreground`}>原评论编号：{review.reviewId}</p>
                {review.sourceReviewId !== null && <p className={`${wrap} text-xs text-muted-foreground`}>平台评论编号：{review.sourceReviewId}</p>}
                <ul className="text-xs text-muted-foreground">{review.locations.map((location, at) => <li key={at} className={wrap}>原文件位置：{location.sheet} · 第 {location.row} 行</li>)}</ul>
              </blockquote>)}
            </details>
          </div>) : <p className="text-xs text-muted-foreground">本次资料不足以形成此类结论。</p>}
        </div>;
      })}
      {buyers.noThemeReviewIds.length > 0 && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">未归入主题的已核对原评论（{buyers.noThemeReviewIds.length} 条）</summary>
        <ul className="mt-2 space-y-1">{buyers.noThemeReviewIds.map(reviewId => <li key={reviewId} className={wrap}>{reviewId}</li>)}</ul>
      </details>}
    </Study>

    <Study title="总结分析">
      <div className="space-y-2"><h4 className="font-medium">产品定位</h4>
        {result.summary.positioning ? <ClaimView claim={result.summary.positioning} /> : <p className="text-xs text-muted-foreground">资料不足，未形成产品定位。</p>}
      </div>
      <ClaimList label="优势" items={result.summary.advantages} /><ClaimList label="劣势" items={result.summary.weaknesses} />
      <ClaimList label="值得借鉴的点" items={result.summary.learnings} /><ClaimList label="可超越的点" items={result.summary.opportunities} />
      <p className="text-xs text-muted-foreground">此处为待人工复核的候选总结。图片、OCR 和真实问答尚未分析，不会因存在四栏内容而自动标记完成或确认。</p>
    </Study>
  </article>;
}
