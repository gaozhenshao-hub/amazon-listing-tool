import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  MessageSquare,
  Plus,
  Trash2,
  Send,
  Image as ImageIcon,
  Undo2,
  Redo2,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  IMAGE_LAYOUTS,
  FRAME_COMPOSITIONS,
  PROMPT_STAGES,
  blankDocumentScene,
  recordManualDocument,
  imageDocumentSchema,
  type ImageDocument,
  type DocumentEntry,
  type PromptStage,
} from "@shared/imageDocument";
import type { ImageOutline } from "@shared/imagePlanning";
import type { ListingAggregation } from "@shared/listingAggregation";
import {
  researchCategories,
  researchCategory,
} from "@shared/researchCategories";
import { resolveQuestionIds } from "@shared/questionMerging";
import {
  planningReferenceKey,
  type PlanningImageReference,
} from "@shared/planningImageReference";
import PlanningAssetPicker from "./PlanningAssetPicker";
import TaskFeedbackDialog from "./TaskFeedbackDialog";
import { PageLockButton } from "./ResearchLock";

const inputClass =
  "w-full rounded-lg border bg-background px-3 py-2 text-sm disabled:bg-muted/50 disabled:text-foreground disabled:opacity-100";
const roleNames = {
  main: "主色",
  secondary: "辅助色",
  accent: "强调色",
  background: "背景色",
};
type OutlineRow = ImageOutline["groups"][number]["items"][number] & {
  family: string;
  moduleType: string;
  groupTitle: string;
  position: number;
};
type Material = {
  key: string;
  imageUrl: string;
  title: string;
  unavailable?: string;
};
import { ManualText, manualTextClass } from "./ManualText";

function TextField({
  label,
  value,
  onChange,
  disabled = false,
  multiline = false,
  small = false,
  max = 6000,
  manual,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  multiline?: boolean;
  small?: boolean;
  max?: number;
  manual?: boolean;
}) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {multiline ? (
        <textarea
          aria-label={label}
          maxLength={max}
          className={
            inputClass +
            (small ? " min-h-24" : " min-h-32") +
            manualTextClass(manual)
          }
          disabled={disabled}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      ) : (
        <input
          aria-label={label}
          maxLength={max}
          className={inputClass + manualTextClass(manual)}
          disabled={disabled}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      )}
    </label>
  );
}
export function ReferenceCards({
  entry,
  kind,
  materials,
  onChange,
  onPick,
  disabled,
  compact = false,
}: {
  entry: DocumentEntry;
  kind: keyof DocumentEntry["references"];
  materials: Material[];
  onChange: (entry: DocumentEntry) => void;
  onPick: () => void;
  disabled: boolean;
  compact?: boolean;
}) {
  const title = {
      composition: "构图参考",
      effect: "效果图参考",
      other: "其他参考",
    }[kind],
    list = entry.references[kind];
  return (
    <section
      className={compact ? "space-y-2" : "space-y-3 rounded-xl border p-4"}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold">{title}</h4>
        {!disabled && (
          <Button variant="outline" size="sm" onClick={onPick}>
            <ImageIcon className="mr-1 h-4 w-4" />
            {compact ? `选择${title}` : "选择参考图片"}
          </Button>
        )}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        {kind === "composition"
          ? "参考区域分配、主体摆放与信息层级，分别设置整体版式和画面构图。"
          : kind === "effect"
            ? "参考风格、画面质感、光影、色调及场景氛围。"
            : "请填写具体想参考什么；保留这个说明，再由小L使用。"}
      </p>
      {!list.length ? (
        <p className="py-3 text-sm text-muted-foreground">
          尚未选择，可按需要补充
        </p>
      ) : (
        list.map((item, index) => {
          const key = planningReferenceKey(item.reference),
            material = materials.find(m => m.key === key);
          return (
            <article
              key={key}
              className={
                compact
                  ? "space-y-2 rounded-lg bg-muted/30 p-2"
                  : "flex gap-3 rounded-lg bg-muted/30 p-3"
              }
            >
              {material?.imageUrl ? (
                <a
                  href={material.imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0"
                >
                  <img
                    src={material.imageUrl}
                    alt={material.title}
                    className={
                      compact
                        ? "max-h-32 w-full rounded-md object-contain"
                        : "h-24 w-28 rounded-md bg-background object-contain"
                    }
                  />
                </a>
              ) : (
                <div className="flex h-24 w-28 shrink-0 items-center justify-center rounded-md bg-muted text-center text-xs">
                  参考图暂不可读取
                  <br />
                  原有选择已保留
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="mb-2 truncate text-xs text-muted-foreground">
                  {material?.title || item.reference.label || "已选参考图"}
                </p>
                {compact && (disabled || kind === "effect") ? (
                  item.purpose && (
                    <p className="whitespace-pre-wrap text-xs">
                      {item.purpose}
                    </p>
                  )
                ) : (
                  <TextField
                    small
                    multiline
                    label="参考目的"
                    value={item.purpose}
                    max={1000}
                    disabled={disabled}
                    onChange={purpose =>
                      onChange({
                        ...entry,
                        references: {
                          ...entry.references,
                          [kind]: list.map((r, i) =>
                            i === index ? { ...r, purpose } : r
                          ),
                        },
                      })
                    }
                  />
                )}
              </div>
              {!disabled && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`移除${title}${index + 1}`}
                  onClick={() =>
                    onChange({
                      ...entry,
                      references: {
                        ...entry.references,
                        [kind]: list.filter((_, i) => i !== index),
                      },
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </article>
          );
        })
      )}
    </section>
  );
}

export function DocumentEntryDetail({
  entry,
  outline,
  materials,
  disabled,
  onChange,
  onPick,
  onPrompt,
  compositionOnly = false,
}: {
  entry: DocumentEntry;
  outline?: Pick<OutlineRow, "family" | "moduleType" | "position">;
  materials: Material[];
  disabled: boolean;
  onChange: (entry: DocumentEntry) => void;
  onPick: (kind: keyof DocumentEntry["references"]) => void;
  onPrompt?: (stage: PromptStage) => void;
  compositionOnly?: boolean;
}) {
  const [tab, setTab] = useState("content"),
    update = (patch: Partial<DocumentEntry>) =>
      onChange({ ...entry, ...patch }),
    textOnly = entry.width === 0 && entry.height === 0;
  const manual = (path: string) => entry.manualFields?.includes(path);
  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-muted/30 p-4">
        <p className="text-xs text-muted-foreground">
          {outline
            ? `${outline.family} · ${outline.moduleType} · 图片${outline.position}`
            : "已保留的历史图位"}
        </p>
        <p className="mt-2 font-semibold">
          <ManualText
            text={entry.title || "未填写画面标题"}
            manual={manual("title")}
          />
        </p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
          <ManualText
            text={entry.content || "请先完善大纲的画面内容"}
            manual={manual("content")}
          />
        </p>
      </div>
      <nav className="flex flex-wrap gap-2">
        {[
          ["content", "画面内容"],
          ["scene", "画面拆解"],
          ["reference", "参考与构图"],
          ["copy", "文字与可视化图标"],
          ...(onPrompt ? [["prompts", "分步提示词"]] : []),
        ].map(([key, title]) => (
          <Button
            key={key}
            size="sm"
            variant={tab === key ? "default" : "outline"}
            onClick={() => setTab(key)}
          >
            {title}
          </Button>
        ))}
      </nav>
      {tab === "content" && (
        <div className="space-y-4">
          <TextField
            label="画面核心标题"
            manual={manual("title")}
            value={entry.title}
            max={200}
            disabled={disabled}
            onChange={title => update({ title })}
          />
          <TextField
            label="画面内容"
            manual={manual("content")}
            value={entry.content}
            multiline
            disabled={disabled}
            onChange={content => update({ content })}
          />
          <div className="grid grid-cols-2 gap-4">
            {(["width", "height"] as const).map(key => (
              <label key={key} className="text-sm">
                {key === "width" ? "宽度（像素）" : "高度（像素）"}
                <input
                  type="number"
                  min={0}
                  max={20000}
                  value={entry[key]}
                  disabled={disabled}
                  className={inputClass + manualTextClass(manual(key))}
                  onChange={e =>
                    update({
                      [key]: Math.min(
                        20000,
                        Math.max(0, Number(e.target.value))
                      ),
                    })
                  }
                />
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            此处调整仅作用于套图文档；纯文字模块宽高保持0。
          </p>
        </div>
      )}
      {tab === "reference" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {([["layout", "构图方式（整体布局）", IMAGE_LAYOUTS]] as const).map(
              ([key, title, options]) => (
                <label className="space-y-2 text-sm" key={key}>
                  <span className="font-medium">{title}</span>
                  <select
                    className={inputClass + manualTextClass(manual(key))}
                    disabled={disabled}
                    value={entry[key]}
                    onChange={e => update({ [key]: e.target.value })}
                  >
                    <option value="">请选择</option>
                    {entry[key] && !options.includes(entry[key] as never) && (
                      <option>{entry[key]}</option>
                    )}
                    {options.map(o => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </label>
              )
            )}
          </div>
          <TextField
            label="构图安排与区域说明"
            manual={manual("layoutNote")}
            value={entry.layoutNote}
            multiline
            disabled={disabled}
            onChange={layoutNote => update({ layoutNote })}
          />
          {(compositionOnly
            ? (["composition"] as const)
            : (["composition", "effect", "other"] as const)
          ).map(kind => (
            <ReferenceCards
              key={kind}
              {...{ entry, kind, materials, disabled, onChange }}
              onPick={() => onPick(kind)}
            />
          ))}
        </div>
      )}
      {tab === "scene" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-semibold">场景、产品与交互</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                单画面一个场景；多场景分别说明区域。品牌背景可以不含产品。
              </p>
            </div>
            {!disabled && !textOnly && (
              <Button
                size="sm"
                variant="outline"
                disabled={entry.scenes.length >= 12}
                onClick={() =>
                  update({
                    scenes: [
                      ...entry.scenes,
                      {
                        ...blankDocumentScene(),
                        name: `场景${entry.scenes.length + 1}`,
                      },
                    ],
                  })
                }
              >
                <Plus className="mr-1 h-4 w-4" />
                增加场景
              </Button>
            )}
          </div>
          {textOnly && (
            <p className="rounded-xl border p-5 text-sm text-muted-foreground">
              这是纯文字模块，直接设置文字与排版。
            </p>
          )}
          {entry.scenes.map((scene, index) => {
            const change = (patch: Partial<typeof scene>) =>
              update({
                scenes: entry.scenes.map(s =>
                  s.id === scene.id ? { ...s, ...patch } : s
                ),
              });
            return (
              <section
                key={scene.id}
                className="space-y-4 rounded-xl border p-4"
              >
                <div className="flex justify-between">
                  <h4 className="font-semibold">
                    {scene.name || `场景${index + 1}`}
                  </h4>
                  {!disabled && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        update({
                          scenes: entry.scenes.filter(s => s.id !== scene.id),
                        })
                      }
                    >
                      移除场景
                    </Button>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label="场景名称"
                    manual={
                      manual("scenes") || manual(`scenes.${scene.id}.name`)
                    }
                    value={scene.name}
                    max={300}
                    disabled={disabled}
                    onChange={name => change({ name })}
                  />
                  <TextField
                    label="所在区域"
                    manual={
                      manual("scenes") || manual(`scenes.${scene.id}.region`)
                    }
                    value={scene.region}
                    max={300}
                    disabled={disabled}
                    onChange={region => change({ region })}
                  />
                </div>
                <TextField
                  multiline
                  label="场景或背景"
                  manual={
                    manual("scenes") || manual(`scenes.${scene.id}.background`)
                  }
                  value={scene.background}
                  disabled={disabled}
                  onChange={background => change({ background })}
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={scene.productPresent}
                    disabled={disabled}
                    onChange={e => change({ productPresent: e.target.checked })}
                  />
                  这个场景包含产品主体
                </label>
                {scene.productPresent && (
                  <>
                    <TextField
                      multiline
                      label="产品主体、角度、位置与配件"
                      manual={
                        manual("scenes") || manual(`scenes.${scene.id}.product`)
                      }
                      value={scene.product}
                      disabled={disabled}
                      onChange={product => change({ product })}
                    />
                    <TextField
                      multiline
                      label="产品与场景或人物的交互"
                      manual={
                        manual("scenes") ||
                        manual(`scenes.${scene.id}.interaction`)
                      }
                      value={scene.interaction}
                      disabled={disabled}
                      onChange={interaction => change({ interaction })}
                    />
                  </>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label="光影与质感"
                    manual={
                      manual("scenes") || manual(`scenes.${scene.id}.lighting`)
                    }
                    value={scene.lighting}
                    multiline
                    small
                    disabled={disabled}
                    onChange={lighting => change({ lighting })}
                  />
                  <TextField
                    label="镜头与视角"
                    manual={
                      manual("scenes") || manual(`scenes.${scene.id}.camera`)
                    }
                    value={scene.camera}
                    multiline
                    small
                    max={300}
                    disabled={disabled}
                    onChange={camera => change({ camera })}
                  />
                </div>
              </section>
            );
          })}
        </div>
      )}
      {tab === "copy" && (
        <div className="space-y-4">
          <TextField
            label="文案语言"
            max={50}
            manual={manual("copy.language")}
            value={entry.copy.language}
            disabled={disabled}
            onChange={language => update({ copy: { ...entry.copy, language } })}
          />
          {(
            [
              ["headline", "主标题（图片上显示的短句）", 500],
              ["headlineZh", "主标题中文译文", 500],
              ["headlinePosition", "主标题位置", 300],
              ["subtitle", "副标题（简短支撑说明）", 1000],
              ["subtitleZh", "副标题中文译文", 1000],
              ["subtitlePosition", "副标题位置", 300],
              ["body", "上图短句或必要清单", 6000],
              ["bodyZh", "短句或清单中文译文", 6000],
              ["bodyPosition", "短句或清单位置", 300],
              ["annotations", "辅助标注、尺寸线与放大框", 6000],
            ] as const
          ).map(([key, label, max]) => (
            <TextField
              key={key}
              {...{ label, max, disabled }}
              multiline
              manual={manual(`copy.${key}`)}
              value={entry.copy[key] || ""}
              onChange={value =>
                update({ copy: { ...entry.copy, [key]: value } })
              }
            />
          ))}
          <div className="flex justify-between">
            <h4 className="font-semibold">可视化图标与短标签</h4>
            {!disabled && (
              <Button
                size="sm"
                variant="outline"
                disabled={entry.copy.icons.length >= 30}
                onClick={() =>
                  update({
                    copy: {
                      ...entry.copy,
                      icons: [
                        ...entry.copy.icons,
                        {
                          id: crypto.randomUUID(),
                          label: "",
                          visual: "",
                          position: "",
                        },
                      ],
                    },
                  })
                }
              >
                增加可视化图标
              </Button>
            )}
          </div>
          {entry.copy.icons.map(icon => (
            <div key={icon.id} className="space-y-3 rounded-xl border p-4">
              {(
                [
                  ["label", "表达什么", 300],
                  ["labelZh", "图标标签中文译文", 300],
                  ["visual", "图标外观", 1000],
                  ["position", "放在哪里", 300],
                ] as const
              ).map(([key, label, max]) => (
                <TextField
                  key={key}
                  {...{ label, max, disabled }}
                  manual={
                    manual("copy.icons") ||
                    manual(`copy.icons.${icon.id}.${key}`)
                  }
                  value={icon[key] || ""}
                  onChange={value =>
                    update({
                      copy: {
                        ...entry.copy,
                        icons: entry.copy.icons.map(i =>
                          i.id === icon.id ? { ...i, [key]: value } : i
                        ),
                      },
                    })
                  }
                />
              ))}
              {!disabled && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    update({
                      copy: {
                        ...entry.copy,
                        icons: entry.copy.icons.filter(i => i.id !== icon.id),
                      },
                    })
                  }
                >
                  移除此图标
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === "prompts" && onPrompt && (
        <div className="space-y-4">
          <p className="rounded-xl bg-blue-50 p-3 text-sm leading-6 text-blue-900">
            先生成整体结构，再按背景、产品、交互融合、文字图标五段提示词制作。这里生成和编辑提示词；后续执行时依次使用上一步的画面。
          </p>
          {PROMPT_STAGES.map(stage => (
            <section
              key={stage.key}
              className="space-y-3 rounded-xl border p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="font-semibold">{stage.name}</h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {stage.description}
                  </p>
                </div>
                {!disabled &&
                  !(textOnly && ["scene", "product"].includes(stage.key)) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onPrompt(stage.key)}
                    >
                      <Sparkles className="mr-1 h-4 w-4" />
                      {entry.prompts[stage.key]
                        ? "调整该步提示词"
                        : "生成该步提示词"}
                    </Button>
                  )}
              </div>
              <TextField
                multiline
                label={`${stage.name}提示词`}
                manual={manual(`prompts.${stage.key}`)}
                value={entry.prompts[stage.key]}
                disabled={
                  disabled ||
                  (textOnly && ["scene", "product"].includes(stage.key))
                }
                onChange={value =>
                  update({ prompts: { ...entry.prompts, [stage.key]: value } })
                }
              />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function DocumentOverview({
  data,
  outline,
  upstream,
  onOpen,
}: {
  data: ImageDocument;
  outline: OutlineRow[];
  upstream: ListingAggregation;
  onOpen: (id: string) => void;
}) {
  const associations = (row: OutlineRow, attention = false) =>
    [
      {
        label: "功能",
        ids: row.featureIds,
        items: upstream.features || [],
        attention: false,
      },
      {
        label: "用户获益",
        ids: row.benefitIds,
        items: upstream.selling,
        attention: false,
      },
      {
        label: "好差评",
        ids: row.reviewIds,
        items: upstream.reviews,
        attention: true,
      },
      {
        label: "买家问题",
        ids: resolveQuestionIds(row.questionIds, upstream.questions),
        items: upstream.questions,
        attention: true,
      },
    ]
      .filter(group => group.attention === attention)
      .map(group => (
        <div key={group.label} className="mb-3 space-y-2">
          <p className="text-[11px] text-muted-foreground">{group.label}</p>
          {group.items
            .filter(node => group.ids.includes(node.id))
            .map(node => (
              <details
                key={node.id}
                className={
                  "rounded-lg border p-2 text-xs " +
                  researchCategories[researchCategory(node)].className
                }
              >
                <summary className="cursor-pointer leading-5">
                  {"sentiment" in node
                    ? node.sentiment === "positive"
                      ? "好评 · "
                      : "差评 · "
                    : ""}
                  {node.text}
                </summary>
                {node.note && (
                  <p className="mt-2 whitespace-pre-wrap leading-5">
                    {node.note}
                  </p>
                )}
                {"answer" in node && node.answer && (
                  <p className="mt-2 whitespace-pre-wrap leading-5">
                    {String(node.answer)}
                  </p>
                )}
              </details>
            ))}
        </div>
      ));
  const rows = outline
      .map(o => ({
        outline: o,
        entry: data.entries.find(e => e.imageId === o.id),
      }))
      .filter(r => r.entry),
    archived = data.entries.filter(e => !outline.some(o => o.id === e.imageId));
  return (
    <>
      <div className="overflow-auto rounded-xl border">
        <table className="w-full min-w-[1630px] table-fixed text-left text-sm">
          <thead className="bg-muted/40">
            <tr>
              {[
                ["序号 / 图片归属", 160],
                ["画面内容", 240],
                ["构图参考", 180],
                ["画面拆解", 190],
                ["效果图参考", 160],
                ["其他参考", 140],
                ["分步提示词", 170],
                ["关联卖点", 200],
                ["用户关注", 200],
              ].map(([name, width]) => (
                <th key={name} style={{ width }} className="p-4 font-semibold">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map(({ outline: o, entry: e }) => {
                const item = e!;
                return (
                  <tr
                    key={item.imageId}
                    className="border-t align-top hover:bg-muted/10"
                  >
                    <td className="p-4">
                      <p className="font-semibold">
                        {o.position} · {o.family}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {o.moduleType}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {item.width && item.height
                          ? `${item.width} × ${item.height}`
                          : "文字模块"}
                      </p>
                      {!!item.manualFields?.length && (
                        <span className="mt-3 inline-block rounded bg-amber-100 px-2 py-1 text-xs text-amber-900">
                          人工已调整
                        </span>
                      )}
                    </td>
                    <td className="p-4">
                      <p className="font-semibold">
                        {item.title || "待填写画面标题"}
                      </p>
                      <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs leading-6 text-muted-foreground">
                        {item.content || "尚未填写画面内容"}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-3"
                        onClick={() => onOpen(item.imageId)}
                      >
                        查看与编辑文档
                      </Button>
                    </td>
                    <td className="p-4">
                      <p>{item.layout || "待选整体版式"}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {item.framing || "待选画面构图"}
                      </p>
                      <p className="mt-3 text-xs text-muted-foreground">
                        已选{item.references.composition.length}张参考图
                      </p>
                    </td>
                    <td className="p-4">
                      <p>
                        {item.scenes.length
                          ? `${item.scenes.length}个场景`
                          : item.width
                            ? "尚未拆解"
                            : "文字排版"}
                      </p>
                      <p className="mt-2 line-clamp-3 text-xs leading-6 text-muted-foreground">
                        {item.scenes
                          .map(s => s.background)
                          .filter(Boolean)
                          .join("；") ||
                          item.copy.headline ||
                          "设置背景、主体、交互与文字与可视化图标"}
                      </p>
                    </td>
                    <td className="p-4">
                      <p>{item.references.effect.length}张</p>
                      <p className="mt-2 line-clamp-3 text-xs leading-6 text-muted-foreground">
                        {item.references.effect
                          .map(r => r.purpose)
                          .join("；") || "风格、质感与氛围"}
                      </p>
                    </td>
                    <td className="p-4">
                      <p>{item.references.other.length}张</p>
                      <p className="mt-2 line-clamp-3 text-xs leading-6 text-muted-foreground">
                        {item.references.other.map(r => r.purpose).join("；") ||
                          "按需补充并填写目的"}
                      </p>
                    </td>
                    <td className="space-y-2 p-4">
                      {PROMPT_STAGES.map(stage => (
                        <p key={stage.key} className="text-xs">
                          <span
                            className={
                              item.prompts[stage.key]
                                ? "text-emerald-700"
                                : "text-muted-foreground"
                            }
                          >
                            {item.prompts[stage.key] ? "✓ " : "○ "}
                            {stage.name}
                          </span>
                        </p>
                      ))}
                    </td>
                    <td className="p-4">{associations(o)}</td>
                    <td className="p-4">{associations(o, true)}</td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  colSpan={9}
                  className="p-12 text-center text-muted-foreground"
                >
                  完成图片大纲后，每张图会显示在这里。可以先返回前一步规划。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {archived.length > 0 && (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            已从大纲移除的文档（{archived.length}张，保留原有人工内容）
          </summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {archived.map(e => (
              <Button
                key={e.imageId}
                variant="outline"
                size="sm"
                onClick={() => onOpen(e.imageId)}
              >
                {e.title || "历史图位"}
              </Button>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

export default function ImageDocumentEditor({
  projectId,
  registerSave,
}: {
  projectId: number;
  registerSave?: (fn: (() => Promise<boolean>) | null) => void;
}) {
  const utils = trpc.useUtils(),
    query = trpc.imageDocument.get.useQuery(
      { projectId },
      {
        refetchOnWindowFocus: false,
        refetchInterval: q =>
          ["queued", "running"].includes(q.state.data?.job?.status || "")
            ? 3000
            : false,
      }
    );
  const save = trpc.imageDocument.save.useMutation(),
    lock = trpc.imageDocument.lock.useMutation(),
    sync = trpc.imageDocument.sync.useMutation(),
    start = trpc.imageDocument.start.useMutation(),
    confirm = trpc.imageDocument.confirm.useMutation(),
    dismiss = trpc.imageDocument.dismiss.useMutation();
  const [data, setData] = useState<ImageDocument | null>(null),
    [dirty, setDirty] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [picker, setPicker] = useState<keyof DocumentEntry["references"] | null>(
      null
    ),
    [preview, setPreview] = useState(false),
    [previewImage, setPreviewImage] = useState<string | null>(null),
    [feedback, setFeedback] = useState(false),
    [conversation, setConversation] = useState<{
      imageId?: string;
      stage?: PromptStage;
      candidate?: boolean;
    } | null>(null),
    [message, setMessage] = useState(""),
    [past, setPast] = useState<ImageDocument[]>([]),
    [future, setFuture] = useState<ImageDocument[]>([]);
  const latest = useRef(data),
    revision = useRef(0),
    loaded = useRef(false),
    saveRef = useRef<() => Promise<boolean>>(async () => true);
  latest.current = data;
  const locked = query.data?.locked ?? false,
    working =
      ["queued", "running"].includes(query.data?.job?.status || "") ||
      start.isPending,
    busy =
      working ||
      save.isPending ||
      lock.isPending ||
      sync.isPending ||
      confirm.isPending ||
      dismiss.isPending,
    disabled = locked || busy;
  const candidate = query.data?.candidate,
    outline: OutlineRow[] =
      query.data?.outline.groups
        .flatMap(g =>
          g.items.map(i => ({
            ...i,
            family: g.family,
            moduleType: g.moduleType,
            groupTitle: g.title,
            position: 0,
          }))
        )
        .map((i, index) => ({ ...i, position: index + 1 })) || [];
  useEffect(() => {
    if (
      query.data &&
      (!loaded.current || (!dirty && query.data.revision !== revision.current))
    ) {
      setData(query.data.data);
      latest.current = query.data.data;
      revision.current = query.data.revision;
      loaded.current = true;
    }
  }, [query.data, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const stop = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", stop);
    return () => window.removeEventListener("beforeunload", stop);
  }, [dirty]);
  useEffect(() => {
    registerSave?.(() => saveRef.current());
    return () => registerSave?.(null);
  }, [registerSave]);
  const refs =
      selected && data
        ? data.entries.find(e => e.imageId === selected)?.references
        : null,
    selectedRefs = refs
      ? Object.values(refs)
          .flat()
          .map(r => r.reference)
      : [];
  const materialsQuery = trpc.imageDocument.references.useQuery(
      { projectId, references: selectedRefs },
      { enabled: selectedRefs.length > 0, staleTime: 30000 }
    ),
    materials = [
      ...(query.data?.materials || []),
      ...(materialsQuery.data || []),
    ];
  function change(next: ImageDocument) {
    if (disabled || !latest.current) return;
    setPast(p => [...p.slice(-19), latest.current!]);
    setFuture([]);
    const marked = recordManualDocument(latest.current, next);
    setData(marked);
    latest.current = marked;
    setDirty(true);
  }
  function updateEntry(entry: DocumentEntry) {
    if (data)
      change({
        ...data,
        entries: data.entries.map(e =>
          e.imageId === entry.imageId ? entry : e
        ),
      });
  }
  async function persist() {
    if (!latest.current) return false;
    if (!dirty && revision.current > 0) return true;
    const parsed = imageDocumentSchema.safeParse(latest.current);
    if (!parsed.success) {
      toast.error("请检查文档内容、尺寸和色卡");
      return false;
    }
    try {
      const result = await save.mutateAsync({
        projectId,
        revision: revision.current,
        data: parsed.data,
      });
      revision.current = result.revision;
      latest.current = result.data;
      setData(result.data);
      setDirty(false);
      await utils.imageDocument.get.invalidate({ projectId });
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "文档未保存，请重试"
      );
      return false;
    }
  }
  saveRef.current = async () => !dirty || (await persist());
  async function toggleLock() {
    try {
      if (!locked && !(await persist())) return;
      const result = await lock.mutateAsync({
        projectId,
        revision: revision.current,
        locked: !locked,
      });
      revision.current = result.revision;
      await query.refetch();
      toast.success(locked ? "已进入编辑状态" : "已保存并锁定");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "暂时无法切换");
    }
  }
  async function run(
    mode: "generate" | "adjust" | "prompts",
    text = "",
    imageId?: string,
    stage?: PromptStage,
    fromCandidate = false
  ) {
    if (!(await persist())) return;
    try {
      await start.mutateAsync({
        projectId,
        revision: revision.current,
        mode,
        imageId,
        stage,
        message: text,
        candidateId: fromCandidate ? candidate?.id : undefined,
      });
      setFeedback(false);
      setMessage("");
      await query.refetch();
      toast.success("已开始整理，完成后点击结果预览");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "任务暂未开始");
    }
  }
  async function accept() {
    if (!candidate || candidate.stale || dirty) return;
    try {
      await confirm.mutateAsync({
        projectId,
        candidateId: candidate.id,
        improve: false,
      });
      setPreview(false);
      setConversation(null);
      setPast([]);
      setFuture([]);
      await query.refetch();
      toast.success("已采用套图文档");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "暂时无法确认");
    }
  }
  async function cancel() {
    if (!candidate) return;
    try {
      await dismiss.mutateAsync({ projectId, candidateId: candidate.id });
      setPreview(false);
      setConversation(null);
      await query.refetch();
      toast.success("已放弃本次预览，原文档保留");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "暂时无法取消");
    }
  }
  if (query.isLoading && !data)
    return (
      <div className="rounded-xl border p-10 text-muted-foreground">
        正在读取套图文档…
      </div>
    );
  if (query.error || !data)
    return (
      <div role="alert" className="rounded-xl border p-8">
        套图文档暂时无法读取。
        <Button variant="link" onClick={() => void query.refetch()}>
          重试
        </Button>
      </div>
    );
  const entry = data.entries.find(e => e.imageId === selected),
    detailOutline = outline.find(o => o.id === selected),
    valid = outline.some(o => o.content.trim()),
    selectedPreview = candidate?.data.entries.find(
      e => e.imageId === previewImage
    );
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">套图文档</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            把每张图的参考、画面拆解与四步提示词准备好。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="mr-2 text-xs text-muted-foreground">
            {dirty ? "有修改，锁定时保存" : "已保存"}
          </span>
          <Button
            size="icon"
            aria-label="撤销文档修改"
            variant="outline"
            disabled={disabled || !past.length}
            onClick={() => {
              setFuture(f => [data, ...f]);
              const value = past.at(-1)!;
              setPast(p => p.slice(0, -1));
              setData(value);
              latest.current = value;
              setDirty(true);
            }}
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            aria-label="重做文档修改"
            variant="outline"
            disabled={disabled || !future.length}
            onClick={() => {
              const value = future[0];
              setPast(p => [...p, data]);
              setFuture(f => f.slice(1));
              setData(value);
              latest.current = value;
              setDirty(true);
            }}
          >
            <Redo2 className="h-4 w-4" />
          </Button>
          <PageLockButton
            locked={locked}
            disabled={busy}
            onToggle={() => void toggleLock()}
          />
        </div>
      </div>
      {query.data?.outlineChanged && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
          <span>
            图片大纲或参考套图已更新。同步后补入新图，人工修改和旧图文档会保留。
          </span>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={async () => {
              if (!(await persist())) return;
              try {
                await sync.mutateAsync({
                  projectId,
                  revision: revision.current,
                });
                await query.refetch();
                toast.success("已同步大纲");
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : "同步未完成"
                );
              }
            }}
          >
            同步大纲
          </Button>
        </div>
      )}
      {query.data?.sourcesChanged && !query.data.outlineChanged && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          卖点、评论、买家问题或参考资料已更新，请检查文档；需要小L更新时点击重新整理。人工修改仍会保留。
        </p>
      )}
      <div className="space-y-5 rounded-2xl border bg-background p-5">
        <div className="grid gap-5 md:grid-cols-[1fr_2fr]">
          <label className="space-y-2 text-sm">
            <span className="font-semibold">类目</span>
            <select
              className={inputClass}
              value={data.category}
              disabled={disabled}
              onChange={e => change({ ...data, category: e.target.value })}
            >
              <option value="">选择知识库类目</option>
              {data.category &&
                !query.data?.tags.categories.includes(data.category) && (
                  <option>{data.category}</option>
                )}
              {query.data?.tags.categories.map(c => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <div>
            <p className="mb-2 text-sm font-semibold">风格建议</p>
            <div className="flex max-h-32 flex-wrap gap-2 overflow-auto">
              {query.data?.tags.styles.map(style => (
                <label
                  key={style}
                  className={
                    "cursor-pointer rounded-full border px-3 py-1.5 text-xs " +
                    (data.styles.includes(style)
                      ? "border-primary bg-primary/10 text-primary"
                      : "text-muted-foreground")
                  }
                >
                  <input
                    className="sr-only"
                    type="checkbox"
                    checked={data.styles.includes(style)}
                    disabled={disabled}
                    onChange={e =>
                      change({
                        ...data,
                        styles: e.target.checked
                          ? [...data.styles, style].slice(0, 10)
                          : data.styles.filter(s => s !== style),
                      })
                    }
                  />
                  {style}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold">配色建议</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {data.palette.map((swatch, index) => (
              <label
                key={swatch.role}
                className="flex gap-3 rounded-xl border p-3"
              >
                <input
                  type="color"
                  aria-label={`${roleNames[swatch.role]}色卡`}
                  className="h-14 w-14 shrink-0 cursor-pointer rounded-md border-0 bg-transparent"
                  disabled={disabled}
                  value={swatch.color}
                  onChange={e =>
                    change({
                      ...data,
                      palette: data.palette.map((p, i) =>
                        i === index ? { ...p, color: e.target.value } : p
                      ),
                    })
                  }
                />
                <div className="min-w-0">
                  <p className="text-xs font-semibold">
                    {roleNames[swatch.role]}{" "}
                    <span className="font-normal text-muted-foreground">
                      {swatch.color.toUpperCase()}
                    </span>
                  </p>
                  <input
                    aria-label={`${roleNames[swatch.role]}用途`}
                    maxLength={300}
                    className="mt-2 w-full border-b bg-transparent text-xs"
                    value={swatch.note}
                    placeholder="颜色用途"
                    disabled={disabled}
                    onChange={e =>
                      change({
                        ...data,
                        palette: data.palette.map((p, i) =>
                          i === index ? { ...p, note: e.target.value } : p
                        ),
                      })
                    }
                  />
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
        <p className="text-sm text-muted-foreground">
          {working
            ? `小L正在整理… ${query.data?.job?.progress || 0}%`
            : query.data?.job?.error ||
              `${outline.length}张图片 · 所有AI任务均由你点击触发`}
        </p>
        <div className="flex flex-wrap gap-2">
          {candidate ? (
            <Button disabled={busy} onClick={() => setPreview(true)}>
              套图文档结果预览{candidate.stale || dirty ? "（资料已更新）" : ""}
            </Button>
          ) : (
            <Button
              disabled={disabled || !valid || query.data?.outlineChanged}
              onClick={() =>
                data.organized ? setFeedback(true) : void run("generate")
              }
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {data.organized ? "重新整理套图文档" : "一键制作套图文档"}
            </Button>
          )}
        </div>
      </div>
      <DocumentOverview
        {...{ data, outline }}
        upstream={query.data!.upstream}
        onOpen={setSelected}
      />
      {entry && (
        <Dialog
          open
          onOpenChange={open => {
            if (!open) setSelected(null);
          }}
        >
          <DialogContent
            aria-describedby={undefined}
            className="flex max-h-[94vh] max-w-[1100px] flex-col overflow-hidden"
          >
            <DialogTitle>
              图片{detailOutline?.position || ""} · {entry.title || "套图文档"}
            </DialogTitle>
            <div className="min-h-0 overflow-y-auto pr-2">
              <DocumentEntryDetail
                {...{ entry, materials, disabled }}
                outline={detailOutline}
                onChange={updateEntry}
                onPick={setPicker}
                onPrompt={stage => {
                  setConversation({ imageId: entry.imageId, stage });
                  setMessage(
                    entry.prompts[stage]
                      ? ""
                      : "请根据当前画面拆解、所选参考用途和前后步骤，生成这一步的完整提示词。"
                  );
                }}
              />
            </div>
            <div className="flex justify-end border-t pt-3">
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() => {
                  setConversation({ imageId: entry.imageId });
                  setMessage("");
                }}
              >
                <MessageSquare className="mr-2 h-4 w-4" />
                调整结果（AI）
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {entry && picker && (
        <PlanningAssetPicker
          mode="images"
          projectId={projectId}
          referenceSetIds={query.data?.outline.referenceSets}
          selectedImages={entry.references[picker].map(r => r.reference)}
          onClose={() => setPicker(null)}
          onConfirm={({ images }) => {
            const old = entry.references[picker];
            updateEntry({
              ...entry,
              references: {
                ...entry.references,
                [picker]: images.map(reference => ({
                  reference,
                  purpose:
                    old.find(
                      r =>
                        planningReferenceKey(r.reference) ===
                        planningReferenceKey(reference)
                    )?.purpose || "",
                })),
              },
            });
            setPicker(null);
          }}
        />
      )}
      {feedback && (
        <TaskFeedbackDialog
          title="重新整理套图文档"
          busy={busy}
          onClose={() => setFeedback(false)}
          onSubmit={text => run("generate", text)}
        />
      )}
      {conversation && (
        <Sheet
          open
          onOpenChange={open => {
            if (!open && !busy) setConversation(null);
          }}
        >
          <SheetContent className="flex w-full flex-col sm:max-w-xl">
            <SheetHeader>
              <SheetTitle>
                {conversation.stage
                  ? PROMPT_STAGES.find(s => s.key === conversation.stage)?.name
                  : conversation.candidate
                    ? "改进套图文档预览"
                    : "调整结果（AI）"}
              </SheetTitle>
            </SheetHeader>
            <p className="text-sm leading-6 text-muted-foreground">
              说明希望怎样调整。小L先给出预览，确认后采用；人工修改会保留。
            </p>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-4">
              {candidate &&
                (conversation.candidate ||
                  candidate.imageId === conversation.imageId) &&
                candidate.history.map((h, index) => (
                  <div
                    key={index}
                    className={
                      "whitespace-pre-wrap rounded-xl p-3 text-sm leading-6 " +
                      (h.role === "user"
                        ? "ml-8 bg-primary/10"
                        : "mr-4 bg-muted/50")
                    }
                  >
                    {h.text}
                  </div>
                ))}
              {working && (
                <p className="text-sm text-muted-foreground">
                  正在整理，请稍候…
                </p>
              )}
              {candidate && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setPreview(true)}
                >
                  查看最新结果预览
                </Button>
              )}
            </div>
            <textarea
              aria-label="套图文档调整意见"
              className={inputClass + " min-h-32"}
              maxLength={4000}
              value={message}
              disabled={busy || locked}
              onChange={e => setMessage(e.target.value)}
              placeholder="对结果哪里不满意？希望怎样改进？"
            />
            <Button
              disabled={disabled || !message.trim()}
              onClick={() =>
                void run(
                  conversation.stage
                    ? "prompts"
                    : conversation.imageId
                      ? "adjust"
                      : "generate",
                  message,
                  conversation.imageId,
                  conversation.stage,
                  !!candidate &&
                    (conversation.candidate ||
                      candidate.imageId === conversation.imageId)
                )
              }
            >
              <Send className="mr-2 h-4 w-4" />
              发送给小L
            </Button>
          </SheetContent>
        </Sheet>
      )}
      {preview && candidate && (
        <Dialog open onOpenChange={setPreview}>
          <DialogContent
            aria-describedby={undefined}
            className="flex max-h-[94vh] max-w-[1500px] flex-col overflow-hidden"
          >
            <DialogTitle>套图文档结果预览</DialogTitle>
            <div className="min-h-0 space-y-4 overflow-y-auto">
              <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                {candidate.reply}
              </p>
              <div className="flex flex-wrap gap-3 rounded-xl border p-4">
                <span>类目：{candidate.data.category || "未设置"}</span>
                <span>
                  风格：{candidate.data.styles.join("、") || "未设置"}
                </span>
                {candidate.data.palette.map(p => (
                  <span
                    key={p.role}
                    className="inline-flex items-center gap-1 text-xs"
                  >
                    <i
                      style={{ backgroundColor: p.color }}
                      className="h-5 w-5 rounded border"
                    />
                    {roleNames[p.role]}
                  </span>
                ))}
              </div>
              {(candidate.stale || dirty) && (
                <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                  资料或人工内容已更新。请保存当前修改后重新整理，避免覆盖。
                </p>
              )}
              <DocumentOverview
                data={candidate.data}
                outline={outline}
                upstream={query.data!.upstream}
                onOpen={setPreviewImage}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
              <div className="flex gap-2">
                <Button
                  disabled={disabled || candidate.stale || dirty}
                  onClick={() => void accept()}
                >
                  确认
                </Button>
                <Button
                  variant="outline"
                  disabled={disabled}
                  onClick={() => void cancel()}
                >
                  取消
                </Button>
                <Button
                  variant="outline"
                  disabled={disabled || candidate.stale || dirty}
                  onClick={() => {
                    setPreview(false);
                    setConversation({
                      candidate: true,
                      imageId: candidate.imageId || undefined,
                      stage: (candidate.stage || undefined) as
                        | PromptStage
                        | undefined,
                    });
                    setMessage("");
                  }}
                >
                  改进
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {selectedPreview && (
        <Dialog
          open
          onOpenChange={open => {
            if (!open) setPreviewImage(null);
          }}
        >
          <DialogContent
            aria-describedby={undefined}
            className="flex max-h-[92vh] max-w-[1050px] flex-col overflow-hidden"
          >
            <DialogTitle>
              预览 · {selectedPreview.title || "图片文档"}
            </DialogTitle>
            <div className="overflow-y-auto">
              <DocumentEntryDetail
                entry={selectedPreview}
                outline={outline.find(o => o.id === previewImage)}
                materials={materials}
                disabled
                onChange={() => {}}
                onPick={() => {}}
                onPrompt={() => {}}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
