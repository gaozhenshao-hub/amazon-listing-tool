import { researchCategories,researchCategory,differentiationClass } from "@shared/researchCategories";
import { resolveQuestionIds } from "@shared/questionMerging";
import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ArrowUp, ArrowDown, Trash2, MessageSquare, Link2 } from "lucide-react";
import {
  AMAZON_MODULE_CATALOG,
  IMAGE_FAMILIES,
  moduleSpec,
  moduleSpecLabel,
  type ImageFamily,
} from "@shared/imageModuleSpecs";
import {
  resizeOutlineGroup,
  type ImageOutline,
  type ImageOutlineItem,
  type ImageOutlineGroup,
} from "@shared/imagePlanning";
import {
  featureGroupLabels,
  sellingGroupLabels,
  type ListingAggregation,
} from "@shared/listingAggregation";
import type { GraphNode } from "@shared/featureBenefitEditing";

const box =
  "w-full rounded-lg border bg-background p-2 text-sm focus-visible:outline-primary";
type Selection = { groupId: string; itemId: string };
export default function ImageOutlineTable({
  data,
  upstream,
  onChange,
  onAdjust,
  onEvidence,
  onReview,
  readOnly = false,
}: {
  data: ImageOutline;
  upstream: ListingAggregation;
  onChange: (value: ImageOutline) => void;
  onAdjust?: (selection: Selection) => void;
  onEvidence?: (node: GraphNode) => void;
  onReview?: (id: string, name: string) => void;
  readOnly?: boolean;
}) {
  const [links, setLinks] = useState<Selection | null>(null),
    [search, setSearch] = useState("");
  const changeGroup = (group: ImageOutlineGroup) =>
    onChange({
      ...data,
      groups: data.groups.map(g => (g.id === group.id ? group : g)),
    });
  const changeItem = (group: ImageOutlineGroup, item: ImageOutlineItem) =>
    changeGroup({
      ...group,
      items: group.items.map(i => (i.id === item.id ? item : i)),
    });
  const moveGroup = (index: number, offset: number) => {
    const groups = [...data.groups];
    [groups[index], groups[index + offset]] = [
      groups[index + offset],
      groups[index],
    ];
    onChange({ ...data, groups });
  };
  const moveItem = (
    group: ImageOutlineGroup,
    index: number,
    offset: number
  ) => {
    const items = [...group.items];
    [items[index], items[index + offset]] = [
      items[index + offset],
      items[index],
    ];
    changeGroup({ ...group, items });
  };
  const selectedGroup = data.groups.find(g => g.id === links?.groupId),
    selected = selectedGroup?.items.find(i => i.id === links?.itemId);
  const associationIds=(item:ImageOutlineItem,key:"featureIds"|"benefitIds"|"reviewIds"|"questionIds")=>key==="questionIds"?resolveQuestionIds(item[key],upstream.questions):item[key];
  const sources = [
    {
      key: "featureIds" as const,
      label: "功能",
      items: (upstream.features || []).map(n => ({
        ...n,
        groupLabel: featureGroupLabels[n.group],
      })),
    },
    {
      key: "benefitIds" as const,
      label: "用户获益",
      items: upstream.selling.map(n => ({
        ...n,
        groupLabel: sellingGroupLabels[n.group],
      })),
    },
    {
      key: "reviewIds" as const,
      label: "好差评点",
      items: upstream.reviews.map(n => ({
        ...n,
        groupLabel: n.sentiment === "positive" ? "好评" : "差评",
      })),
    },
    {
      key: "questionIds" as const,
      label: "买家问题",
      items: upstream.questions.map(n => ({ ...n, groupLabel: "买家问题" })),
    },
  ];
  const chips = (item: ImageOutlineItem, attention = false) => sources.filter(source=>attention ? ["reviewIds","questionIds"].includes(source.key) : ["featureIds","benefitIds"].includes(source.key)).map(source=>{
    const nodes=source.items.filter(n=>associationIds(item,source.key).includes(n.id));
    return !!nodes.length && <div key={source.key} className="space-y-1.5"><p className="text-[11px] font-medium text-muted-foreground">{source.label}</p>{nodes.map(node=><details key={node.id} className={"rounded-lg border px-2 py-1.5 text-xs "+researchCategories[researchCategory(node)].className}><summary className="cursor-pointer leading-relaxed">{source.key==="reviewIds"?node.groupLabel+" · ":""}{node.text}{(("differentiated" in node && node.differentiated) || ("group" in node && node.group==="differentiated")) && <span className={"ml-1 rounded px-1 "+differentiationClass}>差异化</span>}</summary>{node.note && <p className="mt-2 whitespace-pre-wrap leading-relaxed opacity-80">{node.note}</p>}{"answer" in node && !!node.answer && <p className="mt-2 whitespace-pre-wrap leading-relaxed">{String(node.answer)}</p>}{(source.key==="featureIds" || source.key==="benefitIds" || source.key==="reviewIds") && <button className="mt-2 underline" onClick={()=>source.key==="reviewIds"?onReview?.(node.id,node.text):onEvidence?.(node as GraphNode)}>查看证据</button>}</details>)}</div>;
  });
  return (
    <>
      <div className="overflow-x-auto rounded-xl border bg-background">
        <table
          className="w-full min-w-[1080px] table-fixed text-sm"
          aria-label="图片大纲"
        >
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="w-[5%] p-3">序号</th>
              <th className="w-[17%] p-3">图片归属</th>
              <th className="w-[13%] p-3">默认尺寸</th>
              <th className="w-[31%] p-3">画面内容</th>
              <th className="w-[17%] p-3">关联卖点</th>
              <th className="w-[17%] p-3">用户关注</th>
            </tr>
          </thead>
          <tbody>
            {data.groups.map((group, groupIndex) => {
              const spec = moduleSpec(group.family, group.moduleType)!,
                min = group.family === "主图" ? 1 : Math.max(1, spec.min),
                max = group.family === "主图" ? 10 : Math.max(1, spec.max);
              return (
                <Fragment key={group.id}>
                  {group.items.map((item, index) => (
                    <tr
                      key={item.id}
                      className="border-b align-top last:border-0"
                    >
                      <td className="p-3">
                        <span className="font-medium">
                          {data.groups.slice(0,groupIndex).reduce((n,g)=>n+g.items.length,0)+index+1}
                        </span>
                        {!readOnly && group.items.length > 1 && (
                          <div className="mt-2 flex flex-wrap">
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`上移图片${groupIndex + 1}-${index + 1}`}
                              disabled={!index}
                              onClick={() => moveItem(group, index, -1)}
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`下移图片${groupIndex + 1}-${index + 1}`}
                              disabled={index === group.items.length - 1}
                              onClick={() => moveItem(group, index, 1)}
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </td>
                      <td className="space-y-2 p-3">
                        <p className="text-sm font-medium">{group.family} · {group.moduleType}</p>
                        <p className="text-xs text-muted-foreground">{group.family==="主图" ? (group.moduleType==="主图" ? `主图方案${data.groups.slice(0,groupIndex).filter(g=>g.family==="主图" && g.moduleType==="主图").reduce((n,g)=>n+g.items.length,0)+index+1}` : `附图${data.groups.slice(0,groupIndex).filter(g=>g.family==="主图" && g.moduleType==="附图").reduce((n,g)=>n+g.items.length,0)+index+1}`) : `模块${data.groups.slice(0,groupIndex+1).filter(g=>g.family===group.family).length} / ${spec.media==="text"?"文字":"图"}${index+1}`}</p>
                        {!readOnly && index===0 && <details className="rounded border bg-muted/20 p-2"><summary className="cursor-pointer text-xs">编辑模块与图数</summary>                      <div className="flex flex-wrap items-center gap-2">
                        <span className="hidden">
                          {group.family === "品牌故事"
                            ? "品牌故事 · 卡片 "
                            : group.family === "主图"
                              ? "商品图片 · "
                              : "A+ 模块 "}
                          {groupIndex + 1}
                        </span>
                        {readOnly ? (
                          <span>
                            {group.family} · {group.moduleType}
                            {group.title && " · " + group.title}
                          </span>
                        ) : (
                          <>
                            <select
                              aria-label={`模块${groupIndex + 1}归属`}
                              className="rounded border bg-background p-1"
                              value={group.family}
                              onChange={e => {
                                const family = e.target.value as ImageFamily,
                                  type = AMAZON_MODULE_CATALOG.find(
                                    m => m.family === family
                                  )!;
                                changeGroup(
                                  resizeOutlineGroup(
                                    group,
                                    family,
                                    type.name,
                                    Math.max(1, type.defaultCount)
                                  )
                                );
                              }}
                            >
                              {IMAGE_FAMILIES.map(f => (
                                <option key={f}>{f}</option>
                              ))}
                            </select>
                            <select
                              aria-label={`模块${groupIndex + 1}类型`}
                              className="max-w-[200px] rounded border bg-background p-1"
                              value={group.moduleType}
                              onChange={e => {
                                const next = moduleSpec(
                                  group.family,
                                  e.target.value
                                )!;
                                changeGroup(
                                  resizeOutlineGroup(
                                    group,
                                    group.family,
                                    next.name,
                                    group.family === "主图"
                                      ? group.items.length
                                      : Math.max(1, next.defaultCount)
                                  )
                                );
                              }}
                            >
                              {AMAZON_MODULE_CATALOG.filter(
                                m => m.family === group.family
                              ).map(m => (
                                <option key={m.name}>{m.name}</option>
                              ))}
                            </select>
                            <input
                              aria-label={`模块${groupIndex + 1}标题`}
                              value={group.title}
                              maxLength={200}
                              placeholder="模块标题（可选）"
                              className="min-w-[130px] flex-1 rounded border bg-background p-1"
                              onChange={e =>
                                changeGroup({ ...group, title: e.target.value })
                              }
                            />
                            {min !== max && (
                              <label className="text-xs">
                                {group.family === "主图" &&
                                group.moduleType === "主图"
                                  ? "备选方案"
                                  : "图片数量"}
                                <select
                                  aria-label={`模块${groupIndex + 1}图片数量`}
                                  className="ml-1 rounded border bg-background p-1"
                                  value={group.items.length}
                                  onChange={e =>
                                    changeGroup(
                                      resizeOutlineGroup(
                                        group,
                                        group.family,
                                        group.moduleType,
                                        Number(e.target.value)
                                      )
                                    )
                                  }
                                >
                                  {Array.from(
                                    { length: max - min + 1 },
                                    (_, i) => min + i
                                  ).map(n => (
                                    <option key={n}>{n}</option>
                                  ))}
                                </select>
                              </label>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`上移模块${groupIndex + 1}`}
                              disabled={!groupIndex}
                              onClick={() => moveGroup(groupIndex, -1)}
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`下移模块${groupIndex + 1}`}
                              disabled={groupIndex === data.groups.length - 1}
                              onClick={() => moveGroup(groupIndex, 1)}
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`移除模块${groupIndex + 1}`}
                              onClick={() =>
                                onChange({
                                  ...data,
                                  groups: data.groups.filter(
                                    g => g.id !== group.id
                                  ),
                                })
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {spec.guidance}
                      </p>
</details>}
                        {item.references.length > 0 && (
                          <p className="text-xs text-primary">
                            已关联 {item.references.length} 张参考图
                          </p>
                        )}
                      </td>
                      <td className="p-3">
                        {spec.media === "text" ? (
                          <span className="text-xs text-muted-foreground">
                            无需图片
                          </span>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-xs text-muted-foreground">
                              {spec.mobileWidth ? "桌面端" : "宽 × 高（像素）"}
                            </p>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                aria-label={`图片${groupIndex + 1}-${index + 1}宽度`}
                                className={box+" min-w-0 px-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"}
                                min={1}
                                max={20000}
                                disabled={readOnly}
                                value={item.width}
                                onChange={e =>
                                  changeItem(group, {
                                    ...item,
                                    width: Number(e.target.value),
                                  })
                                }
                              />
                              <span>×</span>
                              <input
                                type="number"
                                aria-label={`图片${groupIndex + 1}-${index + 1}高度`}
                                className={box+" min-w-0 px-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"}
                                min={1}
                                max={20000}
                                disabled={readOnly}
                                value={item.height}
                                onChange={e =>
                                  changeItem(group, {
                                    ...item,
                                    height: Number(e.target.value),
                                  })
                                }
                              />
                            </div>
                            {spec.mobileWidth && (
                              <>
                                <p className="text-xs text-muted-foreground">
                                  移动端
                                </p>
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    aria-label={`图片${groupIndex + 1}-${index + 1}移动端宽度`}
                                    className={box+" min-w-0 px-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"}
                                    disabled={readOnly}
                                    min={1}
                                    max={20000}
                                    value={item.mobileWidth ?? spec.mobileWidth}
                                    onChange={e =>
                                      changeItem(group, {
                                        ...item,
                                        mobileWidth: Number(e.target.value),
                                      })
                                    }
                                  />
                                  <span>×</span>
                                  <input
                                    type="number"
                                    aria-label={`图片${groupIndex + 1}-${index + 1}移动端高度`}
                                    className={box+" min-w-0 px-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"}
                                    disabled={readOnly}
                                    min={1}
                                    max={20000}
                                    value={
                                      item.mobileHeight ?? spec.mobileHeight
                                    }
                                    onChange={e =>
                                      changeItem(group, {
                                        ...item,
                                        mobileHeight: Number(e.target.value),
                                      })
                                    }
                                  />
                                </div>
                              </>
                            )}
                            <p
                              className="text-[11px] leading-relaxed text-muted-foreground"
                              title={spec.officialName}
                            >
                              {moduleSpecLabel(spec)}
                            </p>
                            {spec.source && (
                              <a
                                href={spec.source}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs text-primary underline"
                              >
                                官方规格
                              </a>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="space-y-3 p-3">
                          {!!item.manualFields?.length && <span className="inline-block rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-900">人工已修改 · 重新规划时保留</span>}
                        {readOnly ? <strong className="block text-sm">{item.title || group.title || item.content.replace(/^【本品资料待确认】/,"").split(/[：。\n]/)[0].slice(0,70)}</strong> : <input aria-label={`图片${groupIndex+1}-${index+1}标题`} className={box+" font-semibold"} placeholder="画面核心标题" maxLength={200} value={item.title ?? group.title} onChange={e=>changeItem(group,{...item,title:e.target.value})}/>}
                        {readOnly ? (
                          <p className="whitespace-pre-wrap leading-relaxed">
                            {item.content.replace(/^【本品资料待确认】/,"") || "尚未填写"}
                          </p>
                        ) : (
                          <textarea
                            aria-label={`图片${groupIndex + 1}-${index + 1}内容`}
                            className={
                              box + " min-h-[160px] resize-y leading-relaxed"
                            }
                            value={item.content}
                            maxLength={6000}
                            placeholder="这是一张什么图？画面里有哪些东西，怎样摆放、组合或呈现？"
                            onChange={e =>
                              changeItem(group, {
                                ...item,
                                content: e.target.value,
                              })
                            }
                          />
                        )}
                        {!readOnly && onAdjust && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              onAdjust({ groupId: group.id, itemId: item.id })
                            }
                          >
                            <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                            调整结果（AI）
                          </Button>
                        )}
                      </td>
                      <td className="space-y-3 p-3">
                        {chips(item)}
                        {!item.benefitIds.length &&
                          !item.featureIds.length &&
                          !item.reviewIds.length &&
                          !item.questionIds.length && (
                            <p className="text-xs text-muted-foreground">
                              尚未关联
                            </p>
                          )}
                        {!readOnly && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSearch("");
                              setLinks({ groupId: group.id, itemId: item.id });
                            }}
                          >
                            <Link2 className="mr-1.5 h-3.5 w-3.5" />
                            编辑关联
                          </Button>
                        )}
                      </td>
                      <td className="space-y-3 p-3">{chips(item,true)}</td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={open => {
          if (!open) setLinks(null);
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className="max-h-[85vh] max-w-3xl overflow-y-auto"
        >
          <DialogTitle>关联上一级结论</DialogTitle>
          <p className="text-sm text-muted-foreground">
            功能与用户获益分别关联，保留原有标注及来源。
          </p>
          <Input
            aria-label="搜索关联内容"
            placeholder="搜索功能、获益、评论或问题"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {selected &&
            selectedGroup &&
            sources.map(source => (
              <section key={source.key} className="space-y-2">
                <h3 className="font-semibold">{source.label}</h3>
                {!source.items.length && (
                  <p className="text-xs text-muted-foreground">
                    上一级尚无这类内容
                  </p>
                )}
                {source.items
                  .filter(
                    n =>
                      !search ||
                      [n.text, n.note, n.groupLabel].join(" ").includes(search)
                  )
                  .map(n => (
                    <label
                      key={n.id}
                      className="flex items-start gap-2 rounded-lg border p-3"
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={associationIds(selected,source.key).includes(n.id)}
                        onChange={e =>
                          changeItem(selectedGroup, {
                            ...selected,
                            [source.key]: e.target.checked
                              ? [...new Set([...associationIds(selected,source.key), n.id])]
                              : associationIds(selected,source.key).filter(id => id !== n.id),
                          })
                        }
                      />
                      <span className="text-sm">
                        <span className="mr-2 text-xs text-muted-foreground">
                          {n.groupLabel}
                        </span>
                        {n.text}
                        {n.note && (
                          <small className="mt-1 block whitespace-pre-wrap text-muted-foreground">
                            {n.note}
                          </small>
                        )}
                      </span>
                    </label>
                  ))}
              </section>
            ))}
          <Button onClick={() => setLinks(null)}>完成</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
