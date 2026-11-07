import type { ListingAggregation } from "@shared/listingAggregation";

export default function QuestionOrigins({
  question,
}: {
  question: ListingAggregation["questions"][number];
}) {
  if (!question.originalQuestions?.length) return null;
  const count = new Set([question.id, ...(question.mergedQuestionIds || [])])
    .size;
  return (
    <details className="rounded-lg border bg-muted/20 p-2 text-xs">
      <summary className="cursor-pointer text-muted-foreground">
        已合并 {count} 个相近问题 · 查看原问法与人工内容
      </summary>
      <ul className="mt-2 space-y-3">
        {question.originalQuestions.map((original, index) => (
          <li
            key={original.id + ":" + index}
            className="space-y-1 rounded bg-background p-2"
          >
            <p className="font-medium">
              {original.text}
              {original.manual && (
                <span className="ml-2 rounded bg-amber-100 px-1 text-amber-900">
                  人工内容已保留
                </span>
              )}
            </p>
            {original.answer && (
              <p className="whitespace-pre-wrap leading-relaxed">
                原回答：{original.answer}
              </p>
            )}
            {original.note && (
              <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                原说明：{original.note}
              </p>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
