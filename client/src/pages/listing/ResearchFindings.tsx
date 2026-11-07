import { Button } from "@/components/ui/button";
import {
  RESEARCH_CATEGORIES,
  researchCategories,
  researchCategory,
  type ResearchCategory,
} from "@shared/researchCategories";
import type { ListingAggregation } from "@shared/listingAggregation";
import QuestionOrigins from "./QuestionOrigins";
type Props = {
  data: ListingAggregation;
  kind: "reviews" | "questions";
  readOnly: boolean;
  onChange: (data: ListingAggregation) => void;
  onEvidence: (id: string, name: string) => void;
  onQuestionEvidence: (node: ListingAggregation["questions"][number]) => void;
};
export default function ResearchFindings({
  data,
  kind,
  readOnly,
  onChange,
  onEvidence,
  onQuestionEvidence,
}: Props) {
  const patch = (id: string, fields: Record<string, unknown>) => {
    if (readOnly) return;
    onChange({
      ...data,
      [kind]: data[kind].map(n =>
        n.id === id ? { ...n, ...fields, manual: true } : n
      ),
    });
  };
  const remove = (id: string) => {
    if (readOnly) return;
    const node = data[kind].find(n => n.id === id)!;
    onChange({
      ...data,
      [kind]: data[kind].filter(n => n.id !== id),
      excludedConcepts: [
        ...(data.excludedConcepts || []),
        {
          id,
          kind,
          text: node.text,
          sourceKey: node.sourceKey || kind + ":" + id,
        },
      ],
      excludedSourceKeys: [
        ...new Set([
          ...(data.excludedSourceKeys || []),
          node.sourceKey || kind + ":" + id,
        ]),
      ],
    });
  };
  const add = (
    category: ResearchCategory,
    sentiment?: "positive" | "negative"
  ) => {
    const text = window.prompt(
      kind === "questions"
        ? "输入买家问题"
        : sentiment === "positive"
          ? "输入好评点"
          : "输入差评点"
    );
    if (!text?.trim() || readOnly) return;
    const common = {
      id: crypto.randomUUID(),
      text: text.trim(),
      note: "",
      category,
      manual: true,
    };
    onChange(
      kind === "questions"
        ? {
            ...data,
            questions: [
              ...data.questions,
              { ...common, source: "manual", answer: "" },
            ],
          }
        : {
            ...data,
            reviews: [
              ...data.reviews,
              {
                ...common,
                sentiment: sentiment!,
                status: sentiment === "positive" ? "covered" : "solved",
                percentage: null,
                sampleSize: null,
              },
            ],
          }
    );
  };
  return (
    <div className="space-y-5">
      {kind === "reviews" && data.reviewSummary && (
        <p className="rounded-xl border bg-muted/20 p-3 text-sm">
          汇总 {data.reviewSummary.asinCount} 个竞品 · 已分析{" "}
          {data.reviewSummary.sampleCount} 条评论 · 好评{" "}
          {data.reviewSummary.positive} 条 · 差评 {data.reviewSummary.negative}{" "}
          条。主题比例以全部已分析评论为基数，一条评论可涉及多个主题。
        </p>
      )}
      {RESEARCH_CATEGORIES.map(category => (
        <section key={category} className={"overflow-hidden rounded-xl border "+researchCategories[category].className}>
          <header
            className={"border-b p-4 " + researchCategories[category].className}
          >
            <h2 className="font-semibold">
              {researchCategories[category].name}
            </h2>
            <p className="mt-1 text-xs opacity-80">
              {researchCategories[category].description}
            </p>
          </header>
          <div
            className={
              kind === "reviews"
                ? "grid gap-4 p-4 lg:grid-cols-2"
                : "space-y-3 p-4"
            }
          >
            {(kind === "reviews"
              ? ["positive", "negative"]
              : ["questions"]
            ).map(side => (
              <div key={side} className="min-w-0 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">
                    {side === "positive"
                      ? "主要好评"
                      : side === "negative"
                        ? "主要差评"
                        : "买家问题与回答"}
                  </h3>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={readOnly}
                    onClick={() =>
                      add(category, side as "positive" | "negative")
                    }
                  >
                    添加{kind === "questions" ? "问题" : ""}
                  </Button>
                </div>
                {data[kind]
                  .filter(
                    n =>
                      researchCategory(n) === category &&
                      (kind === "questions" ||
                        (n as ListingAggregation["reviews"][number])
                          .sentiment === side)
                  )
                  .map(node => (
                    <article
                      key={node.id}
                      className={
                        "space-y-2 rounded-lg border bg-background p-3 " +
                        (node.manual
                          ? "border-amber-300 ring-1 ring-amber-100"
                          : "")
                      }
                    >
                      <div className="flex flex-wrap items-start gap-2">
                        <strong className="min-w-0 flex-1 text-sm font-medium">
                          {node.text}
                        </strong>
                        {node.manual && (
                          <small className="rounded bg-amber-100 px-1.5 text-amber-900">
                            人工已修改
                          </small>
                        )}
                        {kind === "reviews" && (
                          <small>
                            {"count" in node && node.count !== undefined
                              ? node.count + "条 · "
                              : ""}
                            {"percentage" in node && node.percentage !== null
                              ? node.percentage + "%"
                              : "手动补充"}
                          </small>
                        )}
                      </div>
                      {node.note && (
                        <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                          {node.note}
                        </p>
                      )}
                      {kind === "questions" && (
                        <div className="rounded-lg bg-muted/30 p-3">
                          <strong className="text-xs">建议回答</strong>
                          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                            {"answer" in node && node.answer
                              ? node.answer
                              : "点击一键整理问题，结合已保存的本品卖点补充回答。"}
                          </p>
                        </div>
                      )}
                      {kind==="questions" && <QuestionOrigins question={node as ListingAggregation["questions"][number]}/>}
                      <div className="flex flex-wrap items-center gap-2">
                        {kind === "reviews" && "status" in node && (
                          <select
                            aria-label={node.text + "状态"}
                            disabled={readOnly}
                            value={node.status}
                            onChange={e =>
                              patch(node.id, { status: e.target.value })
                            }
                            className={
                              "rounded border p-1 text-xs " +
                              (node.status === "unset"
                                ? "bg-gray-100 text-gray-600"
                                : ["covered", "solved"].includes(node.status)
                                  ? "border-green-200 bg-green-50 text-green-800"
                                  : "border-red-200 bg-red-50 text-red-800")
                            }
                          >
                            <option value="unset">未配置</option>
                            {side === "positive" ? (
                              <>
                                <option value="covered">已覆盖</option>
                                <option value="not_covered">未覆盖</option>
                              </>
                            ) : (
                              <>
                                <option value="solved">已解决</option>
                                <option value="not_solved">未解决</option>
                              </>
                            )}
                          </select>
                        )}
                        {!!node.evidence?.length && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              kind === "reviews"
                                ? onEvidence(node.id, node.text)
                                : onQuestionEvidence(
                                    node as ListingAggregation["questions"][number]
                                  )
                            }
                          >
                            查看证据
                          </Button>
                        )}
                        <details className="w-full">
                          <summary className="cursor-pointer text-xs text-primary">
                            {readOnly ? "查看详细信息" : "编辑内容与分类"}
                          </summary>
                          <fieldset
                            disabled={readOnly}
                            className="mt-2 space-y-2 rounded-lg bg-muted/20 p-3"
                          >
                            <label className="block text-xs">
                              {kind === "questions" ? "问题" : "结论标题"}
                              <input
                                aria-label={"编辑标题：" + node.text}
                                className="mt-1 w-full rounded border bg-background p-2 text-sm"
                                maxLength={500}
                                value={node.text}
                                onChange={e =>
                                  patch(node.id, { text: e.target.value })
                                }
                              />
                            </label>
                            <label className="block text-xs">
                              分类
                              <select
                                aria-label={"分类：" + node.text}
                                className="ml-2 rounded border bg-background p-1"
                                value={researchCategory(node)}
                                onChange={e =>
                                  patch(node.id, { category: e.target.value })
                                }
                              >
                                {RESEARCH_CATEGORIES.map(k => (
                                  <option key={k} value={k}>
                                    {researchCategories[k].name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="block text-xs">
                              详细说明
                              <textarea
                                className="mt-1 w-full rounded border bg-background p-2 text-sm"
                                maxLength={3000}
                                value={node.note}
                                onChange={e =>
                                  patch(node.id, { note: e.target.value })
                                }
                              />
                            </label>
                            {kind === "questions" && (
                              <label className="block text-xs">
                                回答
                                <textarea
                                  aria-label={"回答：" + node.text}
                                  className="mt-1 min-h-24 w-full rounded border bg-background p-2 text-sm"
                                  maxLength={6000}
                                  value={
                                    "answer" in node ? node.answer || "" : ""
                                  }
                                  onChange={e =>
                                    patch(node.id, { answer: e.target.value })
                                  }
                                />
                              </label>
                            )}
                            <button
                              className="text-xs text-destructive"
                              onClick={() => remove(node.id)}
                            >
                              移除此项
                            </button>
                          </fieldset>
                        </details>
                      </div>
                    </article>
                  ))}
                {!data[kind].some(
                  n =>
                    researchCategory(n) === category &&
                    (kind === "questions" ||
                      (n as ListingAggregation["reviews"][number]).sentiment ===
                        side)
                ) && (
                  <p className="py-3 text-xs text-muted-foreground">
                    暂无此类内容
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
