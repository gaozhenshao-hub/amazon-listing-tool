import { ImageProductionWorkspace } from "./ImageProductionWorkspace";
import { ImagePlanCopy } from "./ImagePlanCopy";
import { Fragment, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  Plus,
  Undo2,
  Redo2,
  ImageIcon,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { trpc } from "@/lib/trpc";

import {
  blankImageOutline,
  clearMainImageAssociations,
  isWhiteBackgroundMain,
  resizeOutlineGroup,
  makeOutlineGroup,
  type ImageOutline,
  type ImageOutlineGroup,
  type ImageOutlineItem,
} from "@shared/imagePlanning";
import {
  IMAGE_LAYOUTS,
  PROMPT_STAGES,
  normalizedImageLayout,
  recordManualDocument,
  type ImageDocument,
  type DocumentEntry,
} from "@shared/imageDocument";
import {
  moduleOutline,
  moduleLabels,
  moduleBrief,
  mergeAplusModules,
  documentForOutline,
} from "@shared/modulePlanning";
import {
  hasOutlineResult,
  recordManualOutline,
} from "@shared/imageOutlineEditing";
import {
  AMAZON_MODULE_CATALOG,
  IMAGE_FAMILIES,
  moduleSpec,
  type ImageFamily,
} from "@shared/imageModuleSpecs";
import {
  emptyListingAggregation,
  type ListingAggregation,
} from "@shared/listingAggregation";
import {
  researchCategories,
  researchCategory,
} from "@shared/researchCategories";
import { resolveQuestionIds } from "@shared/questionMerging";
import { DOCUMENT_REFERENCE_LOOKUP_LIMIT, planningReferenceKey } from "@shared/planningImageReference";
import type { GraphNode } from "@shared/featureBenefitEditing";
import { DocumentEntryDetail, ReferenceCards } from "./ImageDocumentEditor";
import { PageLockButton } from "./ResearchLock";
import {
  SuiteCoverageDialog,
  suiteCoverage,
  type CoverageGroup,
} from "./SuiteCoverageDialog";
import PlanningAssetPicker from "./PlanningAssetPicker";
import GenerationOptionsDialog from "./GenerationOptionsDialog";
import type { ImageCopyLimits } from "@shared/imageCopyLimits";
import { ManualText, manualTextClass } from "./ManualText";
import AggregationSourceEvidence from "./AggregationSourceEvidence";
import { AggregationReviewEvidenceDialog } from "./ReviewEvidenceDialog";
const field =
  "w-full rounded-lg border bg-background p-2 text-sm disabled:bg-muted/40 disabled:text-foreground disabled:opacity-100";
type Draft = { outline: ImageOutline; document: ImageDocument };
const assocGroups = (upstream: ListingAggregation) => [
  {
    key: "featureIds" as const,
    name: "功能",
    nodes: upstream.features || [],
    attention: false,
  },
  {
    key: "benefitIds" as const,
    name: "用户获益",
    nodes: upstream.selling,
    attention: false,
  },
  {
    key: "reviewIds" as const,
    name: "好差评",
    nodes: upstream.reviews,
    attention: true,
  },
  {
    key: "questionIds" as const,
    name: "买家问题",
    nodes: upstream.questions,
    attention: true,
  },
];
export default function SuiteDocumentWorkspace({
  projectId,
  registerSave,
  production = false,
  requestedImageId,
  onProduction,
}: {
  projectId: number;
  production?: boolean;
  requestedImageId?: string | null;
  onProduction?: (imageId: string) => void;
  registerSave: (fn: (() => Promise<boolean>) | null) => void;
}) {
  const utils = trpc.useUtils();
  const plan = trpc.imagePlanning.get.useQuery(
    { projectId },
    {
      refetchOnWindowFocus: false,
      refetchInterval: q =>
        ["queued", "running"].includes(q.state.data?.job?.status || "")
          ? 3000
          : false,
    }
  );
  const query = trpc.imageDocument.get.useQuery(
    { projectId },
    {
      refetchOnWindowFocus: false,
      refetchInterval: q =>
        ["queued", "running"].includes(q.state.data?.job?.status || "")
          ? 3000
          : false,
    }
  );
  const save = trpc.imageDocument.saveWorkspace.useMutation(),
    lock = trpc.imageDocument.lock.useMutation(),
    generateContent = trpc.imageDocument.start.useMutation(),
    confirmContent = trpc.imageDocument.confirm.useMutation(),
    dismissContent = trpc.imageDocument.dismiss.useMutation();
  const [draft, setDraft] = useState<Draft | null>(null),
    [dirty, setDirty] = useState(false),
    [past, setPast] = useState<Draft[]>([]),
    [future, setFuture] = useState<Draft[]>([]);
  const latest = useRef(draft),
    revisions = useRef({ outline: 0, document: 0 }),
    loaded = useRef(false),
    saveRef = useRef<() => Promise<boolean>>(async () => true);
  latest.current = draft;
  const [optionsOpen, setOptionsOpen] = useState(false),
    [preview, setPreview] = useState(false),
    [selection, setSelection] = useState<string | null>(null),
    [picker, setPicker] = useState<{
      id: string;
      kind: keyof DocumentEntry["references"];
    } | null>(null),
    [coverage, setCoverage] = useState<CoverageGroup[] | null>(null),
    [links, setLinks] = useState<string | null>(null),
    [merge, setMerge] = useState<string | null>(null),
    [mergeLayout, setMergeLayout] = useState<"full" | "carousel">("full");
  const [evidence, setEvidence] = useState<GraphNode | null>(null),
    [review, setReview] = useState<{ id: string; name: string } | null>(null);
  const upstream = query.data?.upstream || emptyListingAggregation(),
    locked = query.data?.locked || false;
  const working = [plan.data?.job?.status, query.data?.job?.status].some(s =>
    ["queued", "running"].includes(s || "")
  );
  const busy =
    working ||
    save.isPending ||
    lock.isPending ||
    generateContent.isPending ||
    confirmContent.isPending ||
    dismissContent.isPending;
  const candidate = query.data?.candidate;
  const promptCandidate =
    candidate?.mode === "promptSuite" || candidate?.mode === "prompts";
  const previewCandidate =
    candidate && production === promptCandidate ? candidate : null;
  const otherStepCandidate = !!candidate && !previewCandidate;
  const autoPreview = useRef(false);
  const disabled = locked || busy;
  useEffect(() => {
    if (autoPreview.current && previewCandidate) {
      autoPreview.current = false;
      setPreview(true);
    }
    if (query.data?.job?.error) autoPreview.current = false;
  }, [previewCandidate, query.data?.job?.error]);
  useEffect(() => {
    if (!query.data || !plan.data) return;
    if (
      !loaded.current ||
      (!dirty &&
        query.data.outlineRevision >= revisions.current.outline &&
        query.data.revision >= revisions.current.document &&
        (revisions.current.outline !== query.data.outlineRevision ||
          revisions.current.document !== query.data.revision))
    ) {
      const outline = clearMainImageAssociations(
        moduleOutline(
          query.data.outline.groups.length
            ? query.data.outline
            : { ...query.data.outline, groups: blankImageOutline().groups }
        )
      );
      const next = {
        outline,
        document: documentForOutline(query.data.data, outline),
      };
      setDraft(next);
      latest.current = next;
      revisions.current = {
        outline: query.data.outlineRevision,
        document: query.data.revision,
      };
      loaded.current = true;
    }
  }, [query.data, plan.data, dirty]);
  useEffect(() => {
    registerSave(() => saveRef.current());
    return () => registerSave(null);
  }, [registerSave]);
  useEffect(() => {
    if (!dirty) return;
    const stop = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", stop);
    return () => window.removeEventListener("beforeunload", stop);
  }, [dirty]);
  const active = draft?.document.entries.find(e => e.imageId === selection),
    savedMaterials = new Map(
      (query.data?.materials || []).map(material => [material.key, material])
    ),
    activeRefs = [
      ...new Map(
        [
          ...(preview ? query.data?.candidate?.data.entries || [] : []),
          ...(draft?.document.entries || []),
        ]
          .flatMap(entry =>
            Object.values(entry.references)
              .flat()
              .map(r => r.reference)
          )
          .map(r => [planningReferenceKey(r), r])
      ).values(),
    ]
      .filter(ref => !savedMaterials.has(planningReferenceKey(ref)))
      .slice(0, DOCUMENT_REFERENCE_LOOKUP_LIMIT);
  const refs = trpc.imageDocument.references.useQuery(
    { projectId, references: activeRefs },
    { enabled: activeRefs.length > 0, staleTime: 30000 }
  );
  const materials = [...(query.data?.materials || []), ...(refs.data || [])];
  const refresh = async () => {
    await Promise.all([
      utils.imageDocument.get.invalidate({ projectId }),
      utils.imagePlanning.get.invalidate({ projectId }),
      utils.analysis.researchLocks.invalidate({ projectId }),
    ]);
  };
  function change(next: Draft) {
    if (disabled || !latest.current) return false;
    setPast(p => [...p.slice(-29), latest.current!]);
    setFuture([]);
    latest.current = next;
    setDraft(next);
    setDirty(true);
    return true;
  }
  function changeOutline(outline: ImageOutline) {
    if (!draft) return;
    outline = clearMainImageAssociations(outline);
    const document = documentForOutline(draft.document, outline);
    for (const entry of document.entries) {
      const item = outline.groups
        .flatMap(g => g.items)
        .find(i => i.id === entry.imageId);
      if (item) {
        entry.width = item.width;
        entry.height = item.height;
      }
    }
    change({ outline: recordManualOutline(draft.outline, outline), document });
  }
  function changeEntry(entry: DocumentEntry) {
    const draft = latest.current;
    if (!draft) return false;
    const next = {
      ...draft.document,
      entries: draft.document.entries.map(e =>
        e.imageId === entry.imageId ? entry : e
      ),
    };
    return change({
      ...draft,
      document: recordManualDocument(draft.document, next),
    });
  }
  async function persist(force = false) {
    const value = latest.current;
    if (!value) return false;
    if (
      !dirty &&
      !force &&
      revisions.current.document > 0 &&
      revisions.current.outline > 0
    )
      return true;
    try {
      const result = await save.mutateAsync({
        projectId,
        outlineRevision: revisions.current.outline,
        revision: revisions.current.document,
        outline: value.outline,
        data: value.document,
      });
      revisions.current = {
        outline: result.outlineRevision,
        document: result.revision,
      };
      const savedCurrent = latest.current === value;
      if (savedCurrent) {
        const outline = clearMainImageAssociations(
          moduleOutline(result.outline)
        );
        const next = {
          outline,
          document: documentForOutline(result.data, outline),
        };
        setDraft(next);
        latest.current = next;
        setDirty(false);
      }
      await refresh();
      return savedCurrent;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "套图文档暂未保存，请重试");
      return false;
    }
  }
  saveRef.current = () => (!dirty ? Promise.resolve(true) : persist());
  async function toggleLock() {
    try {
      if (!locked && !(await persist(true))) return false;
      const result = await lock.mutateAsync({
        projectId,
        revision: revisions.current.document,
        locked: !locked,
      });
      revisions.current.document = result.revision;
      await refresh();
      toast.success(locked ? "已进入编辑状态" : "已保存并锁定");
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "切换未完成");
      return false;
    }
  }
  async function run(
    mode: "generate" | "promptSuite",
    feedback = "",
    preserveManual = true,
    copyLimits?: ImageCopyLimits
  ) {
    if (
      busy ||
      (candidate && !(mode === "promptSuite" && production && candidate.stale))
    )
      return;
    if (locked && !(await toggleLock())) return;
    if (!(await persist(true))) return;
    try {
      await generateContent.mutateAsync({
        projectId,
        revision: revisions.current.document,
        mode,
        message:
          mode === "generate"
            ? feedback
            : "依据已确认图片方案生成五段制作提示词，保留人工编辑的提示词。",
        preserveManual,
        ...(copyLimits && { copyLimits }),
      });
      autoPreview.current = !candidate;
      setOptionsOpen(false);
      setSelection(null);
      setPreview(false);
      await refresh();
      toast.success("任务已开始，完成后可查看结果预览");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "任务暂未开始");
    }
  }
  async function decide(accept: boolean) {
    if (!previewCandidate) return;
    const candidateId = previewCandidate.id;
    try {
      if (accept) {
        if (promptCandidate && locked && !(await toggleLock())) return;
        const result = await confirmContent.mutateAsync({
          projectId,
          candidateId,
          improve: false,
        });
        revisions.current.document = result.revision;
        const next = {
          outline: latest.current!.outline,
          document: result.data,
        };
        latest.current = next;
        setDraft(next);
        setDirty(false);
        setPast([]);
        setFuture([]);
      } else {
        if (promptCandidate && locked && !(await toggleLock())) return;
        await dismissContent.mutateAsync({ projectId, candidateId });
      }
      setPreview(false);
      await refresh();
      toast.success(accept ? "已确认本次结果" : "已放弃本次结果，保留原内容");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作未完成");
    }
  }
  if ((query.isLoading || plan.isLoading) && !draft)
    return <p className="rounded-xl border p-10">正在读取套图文档…</p>;
  if (query.error || plan.error || !draft)
    return (
      <div role="alert" className="rounded-xl border p-8">
        套图文档暂时无法读取。
        <Button variant="link" onClick={() => void refresh()}>
          重试
        </Button>
      </div>
    );
  const outline = draft.outline,
    labels = moduleLabels(outline.groups),
    selectedGroup = outline.groups.find(group =>
      group.items.some(item => item.id === selection)
    ),
    selectedPosition =
      selectedGroup?.items.findIndex(item => item.id === selection) ?? -1,
    selectedOutline = selectedGroup?.items[selectedPosition],
    linkItem = outline.groups
      .filter(group => !isWhiteBackgroundMain(group))
      .flatMap(g => g.items)
      .find(i => i.id === links);
  const referenceCards = (
    entry: DocumentEntry,
    kind: keyof DocumentEntry["references"],
    readOnly: boolean
  ) => (
    <ReferenceCards
      compact
      entry={entry}
      kind={kind}
      materials={materials}
      disabled={readOnly || disabled}
      onChange={changeEntry}
      onPick={() => setPicker({ id: entry.imageId, kind })}
    />
  );
  const renderAssociations = (item: ImageOutlineItem, attention: boolean) =>
    assocGroups(upstream)
      .filter(g => g.attention === attention)
      .map(g => (
        <div key={g.key} className="space-y-1.5">
          <p className="text-[11px] text-muted-foreground">{g.name}</p>
          {g.nodes
            .filter(n =>
              (g.key === "questionIds"
                ? resolveQuestionIds(item.questionIds, upstream.questions)
                : item[g.key]
              ).includes(n.id)
            )
            .map(n => (
              <details
                key={n.id}
                className={`rounded-lg border p-2 text-xs ${researchCategories[researchCategory(n)].className}`}
              >
                <summary className="cursor-pointer leading-5">
                  {"sentiment" in n
                    ? `${n.sentiment === "positive" ? "好评" : "差评"} · `
                    : ""}
                  {n.text}
                </summary>
                <p className="mt-2 whitespace-pre-wrap leading-5">{n.note}</p>
                {"answer" in n && n.answer && (
                  <p className="mt-2 leading-5">{String(n.answer)}</p>
                )}
                <button
                  className="mt-2 underline"
                  onClick={() =>
                    g.key === "reviewIds"
                      ? setReview({ id: n.id, name: n.text })
                      : setEvidence(n as GraphNode)
                  }
                >
                  查看证据
                </button>
              </details>
            ))}
        </div>
      ));
  function move(index: number, offset: number) {
    const groups = [...outline.groups];
    [groups[index], groups[index + offset]] = [
      groups[index + offset],
      groups[index],
    ];
    changeOutline({ ...outline, groups });
  }
  const currentTable = (value: Draft, readOnly = false) => (
    <div
      role="region"
      aria-label="套图文档表格"
      tabIndex={0}
      className="min-h-0 min-w-0 max-h-[68vh] overflow-auto rounded-2xl border bg-background"
    >
      <table className="w-full min-w-[2260px] table-fixed text-left text-sm">
        <thead className="sticky top-0 z-20 bg-background">
          <tr>
            {[
              ["模块与内容", 280],
              ["模块归属与图位规格", 210],
              ["图片方案 · 构图方式／图片内容／构图参考", 960],
              ["关联卖点", 200],
              ["用户关注", 200],
              ["效果图参考", 200],
              ["其他参考", 200],
            ].map(([name, width]) => (
              <th
                key={name}
                className={`px-4 py-4 font-semibold ${name === "模块与内容" ? "sticky left-0 z-30 bg-background" : ""}`}
                style={{ width }}
              >
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {value.outline.groups.map((group, index) => {
            const moduleName = moduleLabels(value.outline.groups)[index],
              allowed = AMAZON_MODULE_CATALOG.filter(
                s =>
                  s.family === group.family &&
                  (!group.moduleNumbers?.length ||
                    group.moduleNumbers.length < 2 ||
                    [
                      "全宽背景图",
                      "全宽背景图文",
                      "顶部图片与文字",
                      "图片轮播",
                      "导航轮播",
                      "流程轮播",
                    ].includes(s.name))
              );
            return (
              <Fragment key={group.id}>
                {group.items.map((item, imageIndex) => {
                  const entry = value.document.entries.find(
                    e => e.imageId === item.id
                  )!;
                  if (!entry) return null;
                  const changeGroup = (next: ImageOutlineGroup) =>
                    changeOutline({
                      ...outline,
                      groups: outline.groups.map(g =>
                        g.id === next.id ? next : g
                      ),
                    });
                  return (
                    <tr
                      key={item.id}
                      id={readOnly ? undefined : `suite-position-${item.id}`}
                      tabIndex={readOnly ? undefined : -1}
                      className="border-t align-top hover:bg-muted/5 focus:bg-primary/5"
                    >
                      {imageIndex === 0 && (
                        <td
                          rowSpan={group.items.length}
                          className="sticky left-0 z-10 space-y-3 border-r bg-background p-4"
                        >
                          <div
                            onContextMenu={e => {
                              if (
                                !readOnly &&
                                !disabled &&
                                group.family.includes("A+")
                              ) {
                                e.preventDefault();
                                setMerge(group.id);
                              }
                            }}
                          >
                            <p className="font-semibold text-primary">
                              {moduleName}
                            </p>
                            <p className="mt-2 text-xs text-muted-foreground">
                              {group.items.length}个图位
                            </p>
                            {!readOnly && (
                              <div className="mt-3 flex flex-wrap gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  aria-label={`${moduleName}上移`}
                                  disabled={disabled || !index}
                                  onClick={() => move(index, -1)}
                                >
                                  <ArrowUp className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  aria-label={`${moduleName}下移`}
                                  disabled={
                                    disabled ||
                                    index === outline.groups.length - 1
                                  }
                                  onClick={() => move(index, 1)}
                                >
                                  <ArrowDown className="h-3 w-3" />
                                </Button>
                                {group.family.includes("A+") && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={disabled}
                                    onClick={() => setMerge(group.id)}
                                  >
                                    合并模块
                                  </Button>
                                )}
                              </div>
                            )}
                            {!!group.moduleNumbers?.length &&
                              group.moduleNumbers.length > 1 && (
                                <p className="mt-3 text-xs text-muted-foreground">
                                  纵向合并画布
                                  <br />
                                  原模块内容已保留
                                </p>
                              )}
                          </div>
                          <div>
                            <textarea
                              aria-label={`${moduleName}模块内容`}
                              maxLength={6000}
                              className={
                                field +
                                " min-h-44 leading-6" +
                                manualTextClass(
                                  group.manualFields?.includes("brief")
                                )
                              }
                              value={moduleBrief(group)}
                              disabled={readOnly || disabled}
                              onChange={e =>
                                changeGroup({ ...group, brief: e.target.value })
                              }
                            />
                            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                              模块目标＋各图分工。说明具体讲什么、覆盖哪些获益与顾虑。
                            </p>
                            {group.mergedParts?.length && (
                              <details className="mt-3 text-xs">
                                <summary>合并前内容</summary>
                                {group.mergedParts.map(p => (
                                  <p
                                    key={p.id}
                                    className="mt-2 whitespace-pre-wrap"
                                  >
                                    A+{p.number}：{p.brief}
                                  </p>
                                ))}
                              </details>
                            )}
                          </div>
                        </td>
                      )}
                      <td className="space-y-3 border-r p-4">
                        <strong className="block">
                          {moduleName} · {imageIndex + 1}
                        </strong>
                        {imageIndex === 0 && (
                          <>
                            <select
                              aria-label={`${moduleName}一级归属`}
                              disabled={
                                readOnly ||
                                disabled ||
                                !!group.mergedParts?.length ||
                                (group.moduleNumbers?.length || 0) > 1
                              }
                              className={field}
                              value={group.family}
                              onChange={e => {
                                const family = e.target.value as ImageFamily;
                                const spec = AMAZON_MODULE_CATALOG.find(
                                  s => s.family === family
                                )!;
                                changeGroup({
                                  ...resizeOutlineGroup(
                                    group,
                                    family,
                                    spec.name,
                                    Math.max(1, spec.defaultCount)
                                  ),
                                  brief: group.brief,
                                });
                              }}
                            >
                              {IMAGE_FAMILIES.map(f => (
                                <option key={f}>{f}</option>
                              ))}
                            </select>
                            <select
                              aria-label={`${moduleName}模块类型`}
                              disabled={readOnly || disabled}
                              className={field}
                              value={group.moduleType}
                              onChange={e => {
                                const spec = moduleSpec(
                                  group.family,
                                  e.target.value
                                )!;
                                changeGroup(
                                  resizeOutlineGroup(
                                    group,
                                    group.family,
                                    spec.name,
                                    Math.max(1, spec.defaultCount)
                                  )
                                );
                              }}
                            >
                              {allowed.map(s => (
                                <option key={s.name}>{s.name}</option>
                              ))}
                            </select>
                            <label className="block text-xs text-muted-foreground">
                              图片数量
                              <input
                                aria-label={`${moduleName}图片数量`}
                                type="number"
                                min={Math.max(
                                  1,
                                  moduleSpec(group.family, group.moduleType)
                                    ?.min || 1
                                )}
                                max={
                                  group.family === "主图"
                                    ? 10
                                    : Math.max(
                                        1,
                                        moduleSpec(
                                          group.family,
                                          group.moduleType
                                        )?.max || 1
                                      )
                                }
                                disabled={readOnly || disabled}
                                value={group.items.length}
                                className={field + " mt-1"}
                                onChange={e => {
                                  const n = Number(e.target.value);
                                  const spec = moduleSpec(
                                    group.family,
                                    group.moduleType
                                  )!;
                                  if (
                                    Number.isInteger(n) &&
                                    n >= Math.max(1, spec.min) &&
                                    n <=
                                      (group.family === "主图"
                                        ? 10
                                        : Math.max(1, spec.max))
                                  )
                                    changeGroup(
                                      resizeOutlineGroup(
                                        group,
                                        group.family,
                                        group.moduleType,
                                        n
                                      )
                                    );
                                }}
                              />
                            </label>
                          </>
                        )}
                        <label className="block text-xs text-muted-foreground">
                          默认宽 × 高（像素）
                          <div className="mt-1 flex items-center gap-1">
                            {(["width", "height"] as const).map(key => (
                              <Fragment key={key}>
                                {key === "height" && <span>×</span>}
                                <input
                                  aria-label={`${moduleName}图${imageIndex + 1}${key === "width" ? "宽度" : "高度"}`}
                                  type="number"
                                  min={0}
                                  max={20000}
                                  className={
                                    field +
                                    " min-w-0" +
                                    manualTextClass(
                                      item.manualFields?.includes(key)
                                    )
                                  }
                                  value={item[key]}
                                  disabled={readOnly || disabled}
                                  onChange={e =>
                                    changeGroup({
                                      ...group,
                                      items: group.items.map(i =>
                                        i.id === item.id
                                          ? {
                                              ...i,
                                              [key]: Math.max(
                                                0,
                                                Math.min(
                                                  20000,
                                                  Number(e.target.value)
                                                )
                                              ),
                                            }
                                          : i
                                      ),
                                    })
                                  }
                                />
                              </Fragment>
                            ))}
                          </div>
                        </label>
                      </td>
                      <td className="border-r p-0">
                        <div
                          className="grid grid-cols-[1fr_1.1fr_1fr] py-4"
                          data-testid="image-plan-columns"
                        >
                          <section
                            className="min-w-0 space-y-3 px-4"
                            aria-label="整体布局与构图参考"
                          >
                            <div className="rounded-xl border bg-muted/10 p-3">
                              <label className="text-xs font-medium">
                                构图方式（整体布局）
                                <select
                                  aria-label={`${moduleName}图${imageIndex + 1}构图方式`}
                                  className={
                                    field +
                                    " mt-1" +
                                    manualTextClass(
                                      entry.manualFields?.includes("layout")
                                    )
                                  }
                                  disabled={readOnly || disabled}
                                  value={normalizedImageLayout(entry.layout)}
                                  onChange={e =>
                                    changeEntry({
                                      ...entry,
                                      layout: e.target.value,
                                    })
                                  }
                                >
                                  <option value="">请选择布局</option>
                                  {IMAGE_LAYOUTS.map(layout => (
                                    <option key={layout}>{layout}</option>
                                  ))}
                                </select>
                              </label>
                              <p className="mt-2 whitespace-pre-wrap text-xs leading-5">
                                <ManualText
                                  manual={entry.manualFields?.includes(
                                    "layoutNote"
                                  )}
                                  text={
                                    entry.layoutNote ||
                                    "说明每个区域是什么：主1是什么，辅1／辅2／辅3分别是什么。"
                                  }
                                />
                              </p>
                            </div>
                            <strong className="block">
                              <ManualText
                                manual={
                                  entry.manualFields?.includes("title") ||
                                  item.manualFields?.includes("title")
                                }
                                text={
                                  entry.title || item.title || "图片内容待细化"
                                }
                              />
                            </strong>
                            <p className="whitespace-pre-wrap text-xs leading-6">
                              <ManualText
                                manual={
                                  entry.manualFields?.includes("content") ||
                                  item.manualFields?.includes("content")
                                }
                                text={
                                  entry.content ||
                                  item.content ||
                                  "大纲生成后，在此细化背景、产品交互、文字与可视化图标。"
                                }
                              />
                            </p>
                            <div className="rounded-xl border border-dashed p-3">
                              {referenceCards(entry, "composition", readOnly)}
                            </div>
                          </section>
                          <section
                            className="min-w-0 space-y-3 border-l px-4"
                            aria-label="场景、主体与交互"
                          >
                            <h4 className="text-sm font-semibold">
                              场景、主体与交互
                            </h4>
                            {entry.scenes.some(
                              s => s.background || s.product || s.interaction
                            ) ? (
                              entry.scenes.map((scene, n) => {
                                const manual = (key: string) =>
                                  entry.manualFields?.includes("scenes") ||
                                  entry.manualFields?.includes(
                                    `scenes.${scene.id}.${key}`
                                  );
                                return (
                                  <div
                                    key={scene.id}
                                    className="space-y-2 rounded-lg bg-muted/20 p-3 text-xs leading-5"
                                  >
                                    <strong>
                                      <ManualText
                                        manual={manual(
                                          scene.region ? "region" : "name"
                                        )}
                                        text={
                                          scene.region ||
                                          scene.name ||
                                          `区域${n + 1}`
                                        }
                                      />
                                    </strong>
                                    <p>
                                      <span className="text-muted-foreground">
                                        背景／场景：
                                      </span>
                                      <ManualText
                                        manual={manual("background")}
                                        text={scene.background || "待规划"}
                                      />
                                    </p>
                                    {scene.productPresent ? (
                                      <>
                                        <p>
                                          <span className="text-muted-foreground">
                                            产品主体：
                                          </span>
                                          <ManualText
                                            manual={manual("product")}
                                            text={scene.product || "待规划"}
                                          />
                                        </p>
                                        <p>
                                          <span className="text-muted-foreground">
                                            主体交互：
                                          </span>
                                          <ManualText
                                            manual={manual("interaction")}
                                            text={
                                              scene.interaction || "无特定交互"
                                            }
                                          />
                                        </p>
                                      </>
                                    ) : (
                                      <p className="text-muted-foreground">
                                        本区域不放产品主体
                                      </p>
                                    )}
                                    {(scene.camera || scene.lighting) && (
                                      <p className="text-muted-foreground">
                                        <ManualText
                                          manual={manual("camera")}
                                          text={scene.camera}
                                        />
                                        {scene.camera && scene.lighting
                                          ? "；"
                                          : ""}
                                        <ManualText
                                          manual={manual("lighting")}
                                          text={scene.lighting}
                                        />
                                      </p>
                                    )}
                                  </div>
                                );
                              })
                            ) : (
                              <p className="text-xs leading-6 text-muted-foreground">
                                {entry.width
                                  ? "生成图片内容后，在这里直接展示场景与产品安排。"
                                  : "纯文字模块，直接规划右侧文案与排版。"}
                              </p>
                            )}
                          </section>
                          <section
                            className="min-w-0 space-y-3 border-l px-4"
                            aria-label="文字与可视化图标"
                          >
                            <ImagePlanCopy
                              copy={entry.copy}
                              manualFields={entry.manualFields}
                            />
                          </section>
                        </div>
                        <div className="border-t px-4 py-3">
                          {!readOnly && (
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setSelection(item.id)}
                              >
                                编辑图片方案
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => onProduction?.(item.id)}
                              >
                                提示词与图片制作
                              </Button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="space-y-3 border-r p-4">
                        {isWhiteBackgroundMain(group) ? (
                          <span className="text-xs text-muted-foreground">
                            白底主图
                          </span>
                        ) : (
                          <>
                            {renderAssociations(item, false)}
                            {!readOnly && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={disabled}
                                onClick={() => setLinks(item.id)}
                              >
                                编辑关联
                              </Button>
                            )}
                          </>
                        )}
                      </td>
                      <td className="space-y-3 border-r p-4">
                        {!isWhiteBackgroundMain(group) &&
                          renderAssociations(item, true)}
                      </td>
                      <td className="border-r p-4">
                        {referenceCards(entry, "effect", readOnly)}
                      </td>
                      <td className="p-4">
                        {referenceCards(entry, "other", readOnly)}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">
            {production ? "AI提示词与图片制作" : "套图文档"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {production
              ? "从已确认的图片内容生成五段提示词，按四步制作图片。"
              : "根据已选大纲细化每张图的画面内容。"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!production && (
            <Button
              disabled={
                busy ||
                otherStepCandidate ||
                (!previewCandidate && !hasOutlineResult(outline))
              }
              onClick={() =>
                previewCandidate ? setPreview(true) : setOptionsOpen(true)
              }
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {previewCandidate ? "图片内容结果预览" : "一键生成图片内容"}
            </Button>
          )}
          {!production && dirty && (
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => void persist()}
            >
              保存修改
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {dirty ? "有未保存修改" : "已保存"}
          </span>
          <Button
            size="icon"
            aria-label="撤销文档修改"
            variant="outline"
            disabled={disabled || !past.length}
            onClick={() => {
              const value = past.at(-1)!;
              setFuture([draft, ...future]);
              setPast(past.slice(0, -1));
              latest.current = value;
              setDraft(value);
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
              setPast([...past, draft]);
              setFuture(future.slice(1));
              latest.current = value;
              setDraft(value);
              setDirty(true);
            }}
          >
            <Redo2 className="h-4 w-4" />
          </Button>
          <PageLockButton
            locked={locked}
            pending={lock.isPending}
            disabled={busy}
            onToggle={() => void toggleLock()}
          />
        </div>
      </div>
      {!production && !hasOutlineResult(outline) && (
        <p className="text-xs text-muted-foreground">
          请先到第 1 步图片策划，生成并选择一个图片大纲版本。
        </p>
      )}
      {otherStepCandidate && (
        <p role="status" className="rounded-xl border p-4 text-sm">
          请先到{production ? "第 3 步套图文档" : "第 4 步 AI提示词与图片制作"}
          处理待确认结果。
        </p>
      )}
      {working && (
        <p
          role="status"
          className="rounded-xl border bg-blue-50 p-4 text-sm text-blue-900"
        >
          小L正在生成，完成后可预览并选择是否采用。
        </p>
      )}
      {(plan.data?.job?.error || query.data?.job?.error) && !working && (
        <p role="alert" className="rounded-xl border p-4 text-sm">
          {plan.data?.job?.error || query.data?.job?.error}
        </p>
      )}
      {!production ? (
        <>
          <div className="flex flex-wrap items-center gap-4 rounded-xl border p-4">
            <label className="space-y-1 text-xs">
              <span>类目</span>
              <select
                className={
                  field +
                  manualTextClass(
                    draft.document.manualFields?.includes("category")
                  )
                }
                aria-label="套图类目"
                value={draft.document.category}
                disabled={disabled}
                onChange={e =>
                  change({
                    ...draft,
                    document: recordManualDocument(draft.document, {
                      ...draft.document,
                      category: e.target.value,
                    }),
                  })
                }
              >
                <option value="">请选择类目</option>
                {query.data?.tags.categories.map(c => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span>风格建议</span>
              <select
                className={
                  field +
                  manualTextClass(
                    draft.document.manualFields?.includes("styles")
                  )
                }
                aria-label="套图风格"
                value={draft.document.styles[0] || ""}
                disabled={disabled}
                onChange={e =>
                  change({
                    ...draft,
                    document: recordManualDocument(draft.document, {
                      ...draft.document,
                      styles: e.target.value ? [e.target.value] : [],
                    }),
                  })
                }
              >
                <option value="">请选择风格</option>
                {query.data?.tags.styles.map(c => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            {draft.document.palette.map((p, index) => (
              <label key={p.role} className="flex items-center gap-2 text-xs">
                <input
                  type="color"
                  aria-label={`配色${p.role}`}
                  disabled={disabled}
                  value={p.color}
                  onChange={e =>
                    change({
                      ...draft,
                      document: recordManualDocument(draft.document, {
                        ...draft.document,
                        palette: draft.document.palette.map((color, i) =>
                          i === index
                            ? { ...color, color: e.target.value }
                            : color
                        ),
                      }),
                    })
                  }
                />
                <span>
                  {
                    {
                      main: "主色",
                      secondary: "辅助色",
                      accent: "强调色",
                      background: "背景色",
                    }[p.role]
                  }
                </span>
              </label>
            ))}
          </div>
          {outline.sourceHash &&
            outline.sourceHash !== plan.data?.sourceHash && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50/50 p-4 text-sm">
                <p>
                  上一级分析已更新，可同步关联，保留现有画面内容与人工调整。
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => {
                    const valid = {
                      featureIds: new Set(
                        (upstream.features || []).map(n => n.id)
                      ),
                      benefitIds: new Set(upstream.selling.map(n => n.id)),
                      reviewIds: new Set(upstream.reviews.map(n => n.id)),
                      questionIds: new Set(upstream.questions.map(n => n.id)),
                    };
                    changeOutline({
                      ...outline,
                      sourceHash: plan.data?.sourceHash,
                      sourceRevision: plan.data?.upstreamRevision || 0,
                      groups: outline.groups.map(g => ({
                        ...g,
                        items: g.items.map(i => ({
                          ...i,
                          ...Object.fromEntries(
                            Object.entries(valid).map(([key, ids]) => [
                              key,
                              (key === "questionIds"
                                ? resolveQuestionIds(
                                    i.questionIds,
                                    upstream.questions
                                  )
                                : i[key as keyof typeof valid]
                              ).filter(id => ids.has(id)),
                            ])
                          ),
                        })),
                      })),
                    });
                  }}
                >
                  同步关联
                </Button>
              </div>
            )}
          {currentTable(draft)}
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() =>
              changeOutline({
                ...outline,
                groups: [
                  ...outline.groups,
                  {
                    ...makeOutlineGroup("高级A+", "全宽背景图"),
                    manualFields: ["structure"],
                  },
                ],
              })
            }
          >
            <Plus className="mr-2 h-4 w-4" />
            新增模块
          </Button>
          {draft.document.entries.some(
            e =>
              !outline.groups.some(g => g.items.some(i => i.id === e.imageId))
          ) && (
            <details className="rounded-xl border p-4 text-sm">
              <summary>已保留的历史图片文档</summary>
              {draft.document.entries
                .filter(
                  e =>
                    !outline.groups.some(g =>
                      g.items.some(i => i.id === e.imageId)
                    )
                )
                .map(e => (
                  <Button
                    key={e.imageId}
                    variant="link"
                    onClick={() => setSelection(e.imageId)}
                  >
                    {e.title || "历史图片"}
                  </Button>
                ))}
            </details>
          )}
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              if (dirty && !(await persist())) return;
              if (latest.current)
                setCoverage(suiteCoverage(latest.current.outline, upstream));
            }}
          >
            一键展开卖点覆盖度
          </Button>
          {coverage && (
            <SuiteCoverageDialog
              groups={coverage}
              onClose={() => setCoverage(null)}
              onLocate={position => {
                setCoverage(null);
                requestAnimationFrame(() => {
                  const row = document.getElementById(
                    "suite-position-" + position.id
                  );
                  row?.focus({ preventScroll: true });
                  row?.scrollIntoView({ block: "center", inline: "nearest" });
                });
              }}
            />
          )}
          <Sheet
            open={!!active && !optionsOpen && !preview}
            onOpenChange={open => {
              if (!open && !picker) setSelection(null);
            }}
          >
            <SheetContent
              className="flex w-full flex-col sm:max-w-3xl"
              onInteractOutside={event => {
                if (picker) event.preventDefault();
              }}
            >
              <SheetHeader>
                <SheetTitle>
                  图片方案 · {active?.title || selectedOutline?.title || "编辑"}
                </SheetTitle>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto p-5">
                {active && (
                  <DocumentEntryDetail
                    key={active.imageId}
                    entry={active}
                    outline={
                      selectedGroup && selectedOutline
                        ? {
                            family: selectedGroup.family,
                            moduleType: selectedGroup.moduleType,
                            position: selectedPosition + 1,
                          }
                        : undefined
                    }
                    compositionOnly
                    materials={materials}
                    disabled={disabled || !selectedOutline}
                    onChange={changeEntry}
                    onPick={kind => setPicker({ id: active.imageId, kind })}
                  />
                )}
              </div>
              {selectedOutline && dirty && (
                <div className="flex justify-end border-t p-4">
                  <Button disabled={disabled} onClick={() => void persist()}>
                    保存修改
                  </Button>
                </div>
              )}
            </SheetContent>
          </Sheet>
          {picker && (
            <PlanningAssetPicker
              mode="images"
              projectId={projectId}
              referenceSetIds={outline.referenceSets}
              selectedImages={
                draft.document.entries
                  .find(e => e.imageId === picker.id)
                  ?.references[picker.kind].map(r => r.reference) || []
              }
              maxSelections={20}
              onClose={() => setPicker(null)}
              onConfirm={async selected => {
                const entry = latest.current?.document.entries.find(
                  e => e.imageId === picker.id
                );
                if (!entry) return;
                const updated = changeEntry({
                  ...entry,
                  references: {
                    ...entry.references,
                    [picker.kind]: selected.images.map(reference => ({
                      reference,
                      purpose:
                        entry.references[picker.kind].find(
                          r =>
                            planningReferenceKey(r.reference) ===
                            planningReferenceKey(reference)
                        )?.purpose || "",
                    })),
                  },
                });
                if (!updated) return;
                setPicker(null);
                if (await persist(true)) toast.success("参考图片已保存");
              }}
            />
          )}
          {merge && (
            <Dialog
              open
              onOpenChange={open => {
                if (!open) setMerge(null);
              }}
            >
              <DialogContent aria-describedby={undefined}>
                <DialogTitle>合并相邻A+模块</DialogTitle>
                <p className="text-sm leading-6 text-muted-foreground">
                  保留原模块内容与关联，再组成同一全宽画布或一个轮播。画布高度按模块数累加。
                </p>
                <select
                  aria-label="合并后模块类型"
                  value={mergeLayout}
                  className={field}
                  onChange={e =>
                    setMergeLayout(e.target.value as "full" | "carousel")
                  }
                >
                  <option value="full">全宽图</option>
                  {outline.groups.find(g => g.id === merge)?.family ===
                    "高级A+" && <option value="carousel">图片轮播</option>}
                </select>
                {[-1, 1].map(offset => {
                  const index = outline.groups.findIndex(g => g.id === merge),
                    target = outline.groups[index + offset];
                  if (!target || target.family !== outline.groups[index].family)
                    return null;
                  return (
                    <Button
                      key={offset}
                      variant="outline"
                      onClick={() => {
                        try {
                          changeOutline(
                            mergeAplusModules(
                              outline,
                              offset < 0 ? target.id : merge,
                              offset < 0 ? merge : target.id,
                              mergeLayout
                            )
                          );
                          setMerge(null);
                        } catch (e) {
                          toast.error(
                            e instanceof Error ? e.message : "模块暂时无法合并"
                          );
                        }
                      }}
                    >
                      与{labels[index + offset]}合并
                    </Button>
                  );
                })}
              </DialogContent>
            </Dialog>
          )}
        </>
      ) : (
        <ImageProductionWorkspace
          projectId={projectId}
          document={draft.document}
          locked={locked}
          busy={busy}
          requestedImageId={requestedImageId}
          promptPreviewReady={!!previewCandidate}
          promptGenerationBlocked={otherStepCandidate}
          onEntryChange={changeEntry}
          onSave={() => (dirty ? persist() : Promise.resolve(true))}
          onPrompts={() => {
            if (previewCandidate) setPreview(true);
            else void run("promptSuite");
          }}
        />
      )}
      {linkItem && (
        <Dialog
          open
          onOpenChange={open => {
            if (!open) setLinks(null);
          }}
        >
          <DialogContent
            className="max-h-[85vh] max-w-4xl overflow-y-auto"
            aria-describedby={undefined}
          >
            <DialogTitle>关联卖点与用户关注</DialogTitle>
            <div className="grid gap-5 sm:grid-cols-2">
              {assocGroups(upstream).map(g => (
                <section key={g.key}>
                  <h3 className="mb-3 font-semibold">{g.name}</h3>
                  {g.nodes.map(n => (
                    <label
                      key={n.id}
                      className={`mb-2 flex gap-2 rounded-lg border p-3 text-sm ${researchCategories[researchCategory(n)].className}`}
                    >
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={linkItem[g.key].includes(n.id)}
                        onChange={e =>
                          changeOutline({
                            ...outline,
                            groups: outline.groups.map(group => ({
                              ...group,
                              items: group.items.map(i =>
                                i.id === linkItem.id
                                  ? {
                                      ...i,
                                      [g.key]: e.target.checked
                                        ? [...i[g.key], n.id]
                                        : i[g.key].filter(id => id !== n.id),
                                    }
                                  : i
                              ),
                            })),
                          })
                        }
                      />
                      <span>
                        {n.text}
                        <small className="mt-1 block text-muted-foreground">
                          {n.note}
                        </small>
                      </span>
                    </label>
                  ))}
                </section>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}
      {optionsOpen && (
        <GenerationOptionsDialog
          title="一键生成图片内容"
          busy={busy}
          initialCopyLimits={query.data?.job?.copyLimits}
          copyTargets={draft.outline.groups.flatMap(group => isWhiteBackgroundMain(group)
            ? []
            : group.items.map((item, index) => ({
                id: item.id,
                title: [group.title, `图${index + 1}`, item.title].filter(Boolean).join(" · "),
              })))}
          onClose={() => setOptionsOpen(false)}
          onSubmit={(feedback, preserveManual, copyLimits) =>
            run("generate", feedback, preserveManual, copyLimits)
          }
        />
      )}
      {preview && previewCandidate && (
        <Dialog
          open
          onOpenChange={open => {
            if (!open) setPreview(false);
          }}
        >
          <DialogContent
            aria-describedby={undefined}
            className="flex h-[93vh] w-[97vw] max-w-[2200px] flex-col overflow-hidden"
          >
            <DialogTitle>
              {promptCandidate ? "AI提示词结果预览" : "图片内容结果预览"}
            </DialogTitle>
            <div
              className={
                promptCandidate
                  ? "min-h-0 flex-1 space-y-4 overflow-auto"
                  : "flex min-h-0 flex-1 flex-col gap-4"
              }
            >
              <p className="shrink-0 whitespace-pre-wrap text-sm leading-6">
                {previewCandidate.reply}
              </p>
              {promptCandidate
                ? previewCandidate.data.entries
                    .filter(
                      entry =>
                        !previewCandidate.imageId ||
                        entry.imageId === previewCandidate.imageId
                    )
                    .map((entry, index) => (
                      <section
                        key={entry.imageId}
                        className="space-y-3 rounded-xl border p-4"
                      >
                        <h3 className="font-semibold">
                          {index + 1}. {entry.title || "图片"}
                        </h3>
                        <div className="grid gap-3 lg:grid-cols-2">
                          {PROMPT_STAGES.map(stage => (
                            <div
                              key={stage.key}
                              className="rounded-lg bg-muted/40 p-3 text-sm"
                            >
                              <strong>{stage.name}</strong>
                              <p className="mt-2 whitespace-pre-wrap">
                                <ManualText
                                  manual={entry.manualFields?.includes(
                                    `prompts.${stage.key}`
                                  )}
                                  text={
                                    entry.prompts[stage.key] ||
                                    "本模块不需要此步骤"
                                  }
                                />
                              </p>
                            </div>
                          ))}
                        </div>
                      </section>
                    ))
                : currentTable(
                    { outline, document: previewCandidate.data },
                    true
                  )}
            </div>
            <div
              className="shrink-0 space-y-3 border-t bg-background pt-3"
              data-testid="preview-actions"
            >
              {promptCandidate && previewCandidate.stale && (
                <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">
                  {previewCandidate.staleReason ||
                    "图片内容已更新，请重新生成提示词。"}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  disabled={busy}
                  onClick={() => {
                    if (promptCandidate && previewCandidate.stale)
                      void run("promptSuite");
                    else void decide(true);
                  }}
                >
                  {promptCandidate && previewCandidate.stale
                    ? "按最新内容生成提示词"
                    : "确认本次结果"}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void decide(false)}
                >
                  放弃本次结果
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {evidence && (
        <AggregationSourceEvidence
          projectId={projectId}
          node={evidence}
          onClose={() => setEvidence(null)}
        />
      )}
      {review && (
        <AggregationReviewEvidenceDialog
          projectId={projectId}
          itemId={review.id}
          name={review.name}
          onClose={() => setReview(null)}
        />
      )}
    </section>
  );
}
