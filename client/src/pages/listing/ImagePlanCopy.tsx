import type { DocumentEntry } from "@shared/imageDocument";
import { ManualText } from "./ManualText";
export function ImagePlanCopy({
  copy,
  manualFields,
}: {
  copy: DocumentEntry["copy"];
  manualFields?: string[];
}) {
  const manual = (key: string) => manualFields?.includes(`copy.${key}`);
  const fields = [
    [
      "headline",
      "主标题",
      copy.headline,
      copy.headlinePosition,
      copy.headlineZh,
    ],
    [
      "subtitle",
      "副标题",
      copy.subtitle,
      copy.subtitlePosition,
      copy.subtitleZh,
    ],
    ["body", "必要短句／清单", copy.body, copy.bodyPosition, copy.bodyZh],
  ].filter(([, , text]) => !!text);
  return (
    <>
      <h4 className="text-sm font-semibold">文字与可视化图标</h4>
      <p className="text-[11px] text-muted-foreground">
        上图文案 ·{" "}
        <ManualText
          manual={manual("language")}
          text={copy.language || "英语"}
        />
      </p>
      {fields.length ? (
        fields.map(([key, label, text, position, translation]) => (
          <div
            key={label}
            className="space-y-1.5 rounded-lg border bg-background p-3 text-xs"
          >
            <p className="font-medium text-muted-foreground">{label}</p>
            <p className="whitespace-pre-wrap break-words leading-5">
              <ManualText manual={manual(key!)} text={text!} />
            </p>
            {translation && (
              <small className="block whitespace-pre-wrap text-muted-foreground">
                <ManualText manual={manual(key + "Zh")} text={translation} />
              </small>
            )}
            <p className="text-[11px] text-primary">
              位置：
              <ManualText
                manual={manual(key + "Position")}
                text={position || "尚未标注"}
              />
            </p>
          </div>
        ))
      ) : (
        <p className="text-xs text-muted-foreground">
          本图暂无上图文案；白底主图可不加文字。
        </p>
      )}
      <div className="space-y-2">
        <p className="text-xs font-medium">
          可视化图标 · {copy.icons.length}个
        </p>
        {copy.icons.length ? (
          copy.icons.map(icon => (
            <div
              key={icon.id}
              className="flex gap-2 rounded-lg bg-muted/25 p-3 text-xs leading-5"
            >
              <span
                aria-hidden
                className="mt-1 h-5 w-5 shrink-0 rounded-full border-2 border-primary/40"
              />
              <div className="min-w-0">
                <strong>
                  <ManualText
                    manual={manual("icons") || manual(`icons.${icon.id}.label`)}
                    text={icon.label || "无文字标签"}
                  />
                </strong>
                {icon.labelZh && (
                  <small className="block text-muted-foreground">
                    <ManualText
                      manual={
                        manual("icons") || manual(`icons.${icon.id}.labelZh`)
                      }
                      text={icon.labelZh}
                    />
                  </small>
                )}
                <p>
                  <ManualText
                    manual={
                      manual("icons") || manual(`icons.${icon.id}.visual`)
                    }
                    text={icon.visual || "图形待规划"}
                  />
                </p>
                <p className="text-[11px] text-primary">
                  位置：
                  <ManualText
                    manual={
                      manual("icons") || manual(`icons.${icon.id}.position`)
                    }
                    text={icon.position || "尚未标注"}
                  />
                </p>
              </div>
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">
            暂无图标安排；需要时规划图形、短标签与位置。
          </p>
        )}
      </div>
      {copy.annotations && (
        <p className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
          辅助标注：
          <ManualText manual={manual("annotations")} text={copy.annotations} />
        </p>
      )}
    </>
  );
}
