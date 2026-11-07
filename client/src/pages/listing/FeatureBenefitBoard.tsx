import { ManualText, manuallyEdited, manualTextClass } from "./ManualText";
import { RESEARCH_CATEGORIES, researchCategories, researchCategory, differentiationClass, type ResearchCategory } from "@shared/researchCategories";
import { useLayoutEffect, useRef, useState } from "react";
import {
  Plus,
  MessageSquareText,
  Search,
  Link2,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  FEATURE_GROUPS,
  SELLING_GROUPS,
  featureGroupLabels,
  sellingGroupLabels,
  type ListingAggregation,
} from "@shared/listingAggregation";
import {
  editGraphNode, graphPlanned, benefitPriority,
  moveGraphNode,
  removeGraphNode,
  type GraphNode,
  type GraphSide,
} from "@shared/featureBenefitEditing";
import { toast } from "sonner";

type Props = {
  readOnly?: boolean;
  data: ListingAggregation;
  onChange: (next: ListingAggregation) => void;
  onEvidence: (side: GraphSide, node: GraphNode) => void;
};
type Editor = { side: GraphSide; node: GraphNode; fresh?: boolean };
type Link = NonNullable<ListingAggregation["links"]>[number];
export default function FeatureBenefitBoard({
  data,
  readOnly = false,
  onChange,
  onEvidence,
}: Props) {
  const [editor, setEditor] = useState<Editor | null>(null),
    [linkEditor, setLinkEditor] = useState<Link | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null),
    [focused, setFocused] = useState<string | null>(null);
  const dragged = useRef<{ side: GraphSide; id: string } | null>(null),
    container = useRef<HTMLDivElement>(null),
    completedGesture = useRef(false);
  const pointerDrag=useRef<{side:GraphSide;id:string;text:string;x:number;y:number;moved:boolean}|null>(null);
  const [dragPreview,setDragPreview]=useState<{text:string;x:number;y:number}|null>(null);
  const [lines, setLines] = useState<Array<{ link: Link; path: string }>>([]);
  const features = data.features || [],
    links = data.links || [];
  const originalNode = editor && (editor.side === "feature" ? features : data.selling).find(item => item.id === editor.node.id);
  const editedField = (key: "text" | "note" | "badges") => !!editor && (
    manuallyEdited(editor.node, key) || JSON.stringify(editor.node[key]) !== JSON.stringify(originalNode?.[key])
  );
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const measure = () => {
      const origin = root.getBoundingClientRect();
      const nodes = new Map(
        Array.from(root.querySelectorAll<HTMLElement>("[data-node-id]")).map(
          n => [n.dataset.nodeId, n.getBoundingClientRect()]
        )
      );
      setLines(
        (data.links || []).flatMap(link => {
          const a = nodes.get(link.featureId),
            b = nodes.get(link.benefitId);
          if (!a || !b) return [];
          const x1 = a.right - origin.left + 3,
            y1 = a.top + a.height / 2 - origin.top,
            x2 = b.left - origin.left - 3,
            y2 = b.top + b.height / 2 - origin.top,
            middle = (x1 + x2) / 2;
          return [
            {
              link,
              path:
                "M " +
                x1 +
                " " +
                y1 +
                " C " +
                middle +
                " " +
                y1 +
                ", " +
                middle +
                " " +
                y2 +
                ", " +
                x2 +
                " " +
                y2,
            },
          ];
        })
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(root);
    root.querySelectorAll("[data-node-id]").forEach(n => observer?.observe(n));
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [data.features, data.selling, data.links]);
  const open = (side: GraphSide, node: GraphNode, fresh = false) =>
    !readOnly && setEditor({ side, node: { ...node, category:researchCategory(node), differentiated:node.differentiated ?? node.group==="differentiated", availability:node.availability || (node.group==="improve"?"planned":"current"), group:side==="feature"?({core:"quality",design:"design",details:"detail",information:"information"} as const)[researchCategory(node)] : benefitPriority(node) } as GraphNode, fresh });
  const add = (side: GraphSide, group: string) =>
    open(
      side,
      {
        id: crypto.randomUUID(),
        text: "",
        note: "",
        group: side === "feature" ? (({core:"quality",design:"design",details:"detail",information:"information"} as any)[group] || "quality") : group==="improve"?"secondary":group,
        category: side === "feature" && group!=="improve"?group:"core",
        availability:group==="improve"?"planned":"current",
        manual: true,
      } as GraphNode,
      true
    );
  const connect = (featureId: string, benefitId: string) => {
    if(readOnly)return;
    if (
      links.some(l => l.featureId === featureId && l.benefitId === benefitId)
    ) {
      setConnecting(null);
      return;
    }
    onChange({
      ...data,
      excludedLinks: (data.excludedLinks || []).filter(
        k => k !== featureId + ":" + benefitId
      ),
      links: [
        ...links,
        {
          id: crypto.randomUUID(),
          featureId,
          benefitId,
          note: "",
          manual: true,
        },
      ],
    });
    setConnecting(null);
  };
  const nodeView = (side: GraphSide, node: GraphNode) => (
    <ContextMenu key={node.id}>
      <ContextMenuTrigger asChild>
        <article
          data-node-id={node.id}
          data-side={side}
          draggable={!readOnly}
          onPointerDown={e=>{
            if(readOnly || e.button!==0 || (e.target as HTMLElement).closest("button,input,textarea,select,a"))return;
            pointerDrag.current={side,id:node.id,text:node.text,x:e.clientX,y:e.clientY,moved:false};
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={e=>{
            const start=pointerDrag.current;
            if(!start || start.id!==node.id)return;
            if(!start.moved && Math.hypot(e.clientX-start.x,e.clientY-start.y)<6)return;
            start.moved=true;e.preventDefault();
            setDragPreview({text:start.text,x:e.clientX,y:e.clientY});
          }}
          onPointerUp={e=>{
            const start=pointerDrag.current;
            if(start?.id===node.id && start.moved){
              e.preventDefault();e.stopPropagation();
              const target=document.elementFromPoint(e.clientX,e.clientY),group=target?.closest<HTMLElement>("[data-group]"),before=target?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
              if(group?.dataset.side===side && group.dataset.group && before!==node.id)onChange(moveGraphNode(data,side,node.id,group.dataset.group,before));
            }
            pointerDrag.current=null;dragged.current=null;setDragPreview(null);
            try{e.currentTarget.releasePointerCapture?.(e.pointerId);}catch{/* The browser may already have released a canceled pointer. */}
          }}
          onPointerCancel={()=>{pointerDrag.current=null;dragged.current=null;setDragPreview(null);}}
          onDragStart={e => {
            if(pointerDrag.current?.id===node.id){e.preventDefault();return;}
            dragged.current = { side, id: node.id };
            e.dataTransfer?.setData("text/plain", node.id);
          }}
          onDragEnd={() => {
            dragged.current = null;
          }}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            e.stopPropagation();
            if (!readOnly && dragged.current?.side === side)
              onChange(
                moveGraphNode(
                  data,
                  side,
                  dragged.current.id,
                  (e.currentTarget.closest("[data-group]") as HTMLElement)?.dataset.group || node.group,
                  node.id
                )
              );
            dragged.current = null;
          }}
          onMouseEnter={() => setFocused(node.id)}
          onMouseLeave={() => setFocused(null)}
          onDoubleClick={() => open(side, node)}
          className="relative z-10 cursor-grab rounded-lg border bg-background px-3 py-2 shadow-sm active:cursor-grabbing"
        >
          <div className="flex items-start gap-2">
            <span className="min-w-0 flex-1 break-words text-sm font-medium">
              <ManualText text={node.text} manual={manuallyEdited(node, "text")} />
            </span>
            <button
              type="button"
              disabled={readOnly}
              title={side === "feature" ? "连接到卖点" : "选择支撑功能"}
              aria-label={
                (side === "feature" ? "连接功能：" : "连接卖点：") + node.text
              }
              className={
                "shrink-0 rounded-full border p-1 " +
                (connecting === node.id || (side === "benefit" && connecting)
                  ? "border-primary bg-primary/10 text-primary"
                  : "text-muted-foreground")
              }
              onDragStart={e => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onPointerDown={e => {
                if (side === "feature") {
                  e.stopPropagation();
                  completedGesture.current = false;
                  setConnecting(node.id);
                }
              }}
              onPointerUp={() => {
                if (side === "benefit" && connecting) {
                  completedGesture.current = true;
                  connect(connecting, node.id);
                }
              }}
              onClick={() => {
                if (side === "feature") setConnecting(node.id);
                else if (connecting && !completedGesture.current)
                  connect(connecting, node.id);
              }}
            >
              <Link2 className="h-3.5 w-3.5" />
            </button>
          </div>
          {node.note && (
            <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
              <ManualText text={node.note} manual={manuallyEdited(node, "note")} />
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
            {(node.differentiated || node.group === "differentiated") && <span className={"rounded-md border-2 px-2.5 py-1 text-sm " + differentiationClass}>差异化</span>}
            {(node.availability === "planned" || node.group === "improve") && <span className="rounded border px-1.5 text-orange-800">{side==="feature"?"待改进功能":"待实现卖点"}</span>}
            {side==="benefit" && <span className={"rounded border px-2 py-0.5 "+researchCategories[researchCategory(node)].className}>{researchCategories[researchCategory(node)].name}</span>}
          </div>
          {(node.badges || []).length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {node.badges!.map(b => (
                <small
                  key={b}
                  className="rounded bg-primary/10 px-1.5 text-primary"
                >
                  {b}
                </small>
              ))}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:text-foreground"
              disabled={readOnly}
              onClick={() => open(side, node)}
              aria-label={"标注：" + node.text}
            >
              <MessageSquareText className="h-3 w-3" />
              {node.note ? "编辑标注" : "添加标注"}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:text-foreground"
              onClick={() => onEvidence(side, node)}
              aria-label={"查看证据：" + node.text}
            >
              <Search className="h-3 w-3" />
              查看证据{" "}
              {node.evidence?.length ? "(" + node.evidence.length + ")" : ""}
            </button>
          </div>
        </article>
      </ContextMenuTrigger>
      <ContextMenuContent hidden={readOnly}>
        <ContextMenuItem onSelect={() => open(side, node)}>
          <Pencil className="mr-2 h-4 w-4" />
          {side === "feature" ? "编辑功能" : "编辑卖点"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => open(side, node)}>
          编辑详细标注
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onEvidence(side, node)}>
          查看证据
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-destructive"
          onSelect={() => onChange(removeGraphNode(data, side, node.id))}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          移除此项
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
  const column = (side: GraphSide) => {
    const isFeature = side === "feature",
      groups = isFeature ? [...RESEARCH_CATEGORIES,"improve"] : ["primary","secondary","necessary","improve"],
      nodes = isFeature ? features : data.selling;
    const descriptor=(group:string)=>group==="improve"?{name:isFeature?"待改进功能":"待实现卖点",description:"尚未实现的内容单独保留，规划时不作为本品已有能力。",className:"border-orange-200 bg-orange-50 text-orange-900"}:isFeature?researchCategories[group as ResearchCategory]:({primary:{name:"主要卖点",description:"与核心使用目的和购买决策最相关、优先表达的用户获益。",className:"border-emerald-200 bg-emerald-50 text-emerald-900"},secondary:{name:"次要卖点",description:"补充主要价值，提升使用体验与选择吸引力的用户获益。",className:"border-blue-200 bg-blue-50 text-blue-900"},necessary:{name:"必要卖点",description:"帮助买家选择、理解与正确使用产品的必要信息及对应获益。",className:"border-slate-200 bg-slate-50 text-slate-700"}} as const)[group as "primary"|"secondary"|"necessary"];
    return (
      <div className="relative min-w-0 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">
            {isFeature ? "功能 Feature" : "卖点 Benefits"}
          </h2>
          <small className="text-muted-foreground">{nodes.length} 项</small>
        </div>
        {groups.map(group => (
          <section
            key={group}
            data-group={group}
            data-side={side}
            className={"min-h-24 rounded-xl border p-3 " + descriptor(group).className}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              if (!readOnly && dragged.current?.side === side)
                onChange(moveGraphNode(data, side, dragged.current.id, group));
              dragged.current = null;
            }}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div><h3 className="text-sm font-semibold">{descriptor(group).name}</h3><p className="mt-1 text-[11px] leading-relaxed opacity-75">{descriptor(group).description}</p></div>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                aria-label={"添加" + descriptor(group).name}
                disabled={readOnly}
                onClick={() => add(side, group)}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="space-y-2">
              {nodes
                .filter(n => group==="improve"?graphPlanned(n):!graphPlanned(n) && (isFeature?researchCategory(n)===group:benefitPriority(n)===group))
                .map(node => nodeView(side, node))}
            </div>
          </section>
        ))}
      </div>
    );
  };
  return (
    <div className="space-y-3">
      {dragPreview && <div aria-hidden="true" className="pointer-events-none fixed z-[350] max-w-xs rounded-lg border bg-background px-3 py-2 text-sm shadow-lg" style={{left:dragPreview.x+12,top:dragPreview.y+12}}>{dragPreview.text}</div>}
      <p className="text-xs text-muted-foreground">
        拖动调整归类和顺序，右键或双击编辑；从功能的连接点拖到卖点，也可依次点击两端。点击连线可修改关联。
      </p>
      {connecting && (
        <div className="flex items-center justify-between rounded border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          请选择右侧卖点建立关联。
          <button
            type="button"
            className="text-primary"
            onClick={() => setConnecting(null)}
          >
            取消连接
          </button>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border bg-background p-4">
        <div
          ref={container}
          className="relative grid min-w-[680px] grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)] items-start gap-0"
        >
          <svg
            aria-label="功能与卖点连线"
            className="pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible"
          >
            {lines.map(({ link, path }) => (
              <g key={link.id}>
                <path
                  d={path}
                  fill="none"
                  stroke={
                    focused === link.featureId || focused === link.benefitId
                      ? "var(--primary)"
                      : "#94a3b8"
                  }
                  strokeWidth={
                    focused === link.featureId || focused === link.benefitId
                      ? 2.5
                      : 1.3
                  }
                  opacity={
                    focused &&
                    focused !== link.featureId &&
                    focused !== link.benefitId
                      ? 0.15
                      : 0.7
                  }
                />
                <path
                  d={path}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                  className="pointer-events-auto cursor-pointer"
                  role="button"
                  tabIndex={0}
                  aria-label={
                    "编辑连线：" +
                    features.find(n => n.id === link.featureId)?.text +
                    " → " +
                    data.selling.find(n => n.id === link.benefitId)?.text
                  }
                  onClick={() => !readOnly && setLinkEditor({ ...link })}
                  onContextMenu={e => {
                    e.preventDefault();
                    if(!readOnly)setLinkEditor({ ...link });
                  }}
                  onKeyDown={e => {
                    if (!readOnly && e.key === "Enter") setLinkEditor({ ...link });
                  }}
                />
              </g>
            ))}
          </svg>
          {column("feature")}
          <div aria-hidden="true" />
          {column("benefit")}
        </div>
      </div>
      <Sheet
        open={!!editor}
        onOpenChange={open => {
          if (!open) setEditor(null);
        }}
      >
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>
              {editor?.side === "feature" ? "编辑功能" : "编辑卖点"}
            </SheetTitle>
          </SheetHeader>
          {editor && (
            <div className="space-y-4 p-4">
              <label className="block space-y-1 text-sm">
                <span>简短名称</span>
                <input
                  aria-label="节点名称"
                  className={"w-full rounded border p-2" + manualTextClass(editedField("text"))}
                  maxLength={500}
                  value={editor.node.text}
                  onChange={e =>
                    setEditor({
                      ...editor,
                      node: { ...editor.node, text: e.target.value },
                    })
                  }
                />
              </label>
              {editor.side==="benefit" && <label className="block space-y-1 text-sm"><span>卖点重要性</span><select aria-label="卖点重要性" className="w-full rounded border p-2" value={editor.node.group} onChange={e=>setEditor({...editor,node:{...editor.node,group:e.target.value} as GraphNode})}>{(["primary","secondary","necessary"] as const).map(g=><option key={g} value={g}>{sellingGroupLabels[g]}</option>)}</select></label>}
              <label className="block space-y-1 text-sm"><span>统一分类</span><select aria-label="统一分类" className="w-full rounded border p-2" value={researchCategory(editor.node)} onChange={e=>setEditor({...editor,node:{...editor.node,category:e.target.value as ResearchCategory,...(editor.side==="feature" ? {group:({core:"quality",design:"design",details:"detail",information:"information"} as const)[e.target.value as ResearchCategory]} : {})}})}>{RESEARCH_CATEGORIES.map(key=><option key={key} value={key}>{researchCategories[key].name}</option>)}</select></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editor.node.differentiated ?? editor.node.group==="differentiated"} onChange={e=>setEditor({...editor,node:{...editor.node,differentiated:e.target.checked,group:editor.node.group==="differentiated"?(editor.side==="feature"?"quality":"secondary"):editor.node.group}})} />差异化（独立黄标签）</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editor.node.availability==="planned" || editor.node.group==="improve"} onChange={e=>setEditor({...editor,node:{...editor.node,availability:e.target.checked?"planned":"current",group:editor.node.group==="improve"?(editor.side==="feature"?"quality":"secondary"):editor.node.group}})} />待改进 / 待实现</label>
              <label className="block space-y-1 text-sm">
                <span>详细标注</span>
                <textarea
                  aria-label="详细标注"
                  rows={7}
                  maxLength={3000}
                  className={"w-full rounded border p-2" + manualTextClass(editedField("note"))}
                  placeholder="补充解释、使用体验、适用条件和判断依据"
                  value={editor.node.note}
                  onChange={e =>
                    setEditor({
                      ...editor,
                      node: { ...editor.node, note: e.target.value },
                    })
                  }
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span>补充标记</span>
                <input
                  aria-label="补充标记"
                  className={"w-full rounded border p-2" + manualTextClass(editedField("badges"))}
                  placeholder="例如：差异化、待核实，用顿号分隔"
                  value={(editor.node.badges || []).join("、")}
                  onChange={e =>
                    setEditor({
                      ...editor,
                      node: {
                        ...editor.node,
                        badges: e.target.value
                          .split(/[、，,]/)
                          .map(s => s.trim())
                          .filter(Boolean)
                          .slice(0, 12),
                      },
                    })
                  }
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span>比较范围</span>
                <textarea
                  aria-label="比较范围"
                  rows={3}
                  maxLength={1000}
                  className="w-full rounded border p-2"
                  placeholder="相对哪些竞品有差异，哪些判断仍需核实"
                  value={editor.node.comparisonScope || ""}
                  onChange={e =>
                    setEditor({
                      ...editor,
                      node: { ...editor.node, comparisonScope: e.target.value },
                    })
                  }
                />
              </label>
              <div className="flex gap-2">
                <Button
                  disabled={!editor.node.text.trim()}
                  onClick={() => {
                    const node = {
                      ...editor.node,
                      text: editor.node.text.trim(),
                      manual: true,
                    };
                    if (editor.fresh) {
                      const key =
                        editor.side === "feature" ? "features" : "selling";
                      onChange({
                        ...data,
                        [key]: [...(data[key] || []), node],
                      });
                    } else onChange(editGraphNode(data, editor.side, node));
                    setEditor(null);
                  }}
                >
                  应用修改
                </Button>
                <Button
                  variant="outline"
                  onClick={() => onEvidence(editor.side, editor.node)}
                >
                  查看证据
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <Sheet
        open={!!linkEditor}
        onOpenChange={open => {
          if (!open) setLinkEditor(null);
        }}
      >
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>编辑功能与卖点关联</SheetTitle>
          </SheetHeader>
          {linkEditor && (
            <div className="space-y-4 p-4">
              <label className="block text-sm">
                支撑功能
                <select
                  aria-label="关联功能"
                  className="mt-1 w-full rounded border p-2"
                  value={linkEditor.featureId}
                  onChange={e =>
                    setLinkEditor({ ...linkEditor, featureId: e.target.value })
                  }
                >
                  {features.map(n => (
                    <option key={n.id} value={n.id}>
                      {n.text}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                用户获益
                <select
                  aria-label="关联卖点"
                  className="mt-1 w-full rounded border p-2"
                  value={linkEditor.benefitId}
                  onChange={e =>
                    setLinkEditor({ ...linkEditor, benefitId: e.target.value })
                  }
                >
                  {data.selling.map(n => (
                    <option key={n.id} value={n.id}>
                      {n.text}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                关联说明
                <textarea
                  aria-label="关联说明"
                  rows={6}
                  maxLength={3000}
                  className="mt-1 w-full rounded border p-2"
                  value={linkEditor.note}
                  onChange={e =>
                    setLinkEditor({ ...linkEditor, note: e.target.value })
                  }
                />
              </label>
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    if (
                      links.some(
                        l =>
                          l.id !== linkEditor.id &&
                          l.featureId === linkEditor.featureId &&
                          l.benefitId === linkEditor.benefitId
                      )
                    ) {
                      toast.error("这两个节点已有关联");
                      return;
                    }
                    const prior = links.find(l => l.id === linkEditor.id)!;
                    onChange({
                      ...data,
                      excludedLinks: [
                        ...new Set([
                          ...(data.excludedLinks || []).filter(
                            k =>
                              k !==
                              linkEditor.featureId + ":" + linkEditor.benefitId
                          ),
                          ...(prior.featureId !== linkEditor.featureId ||
                          prior.benefitId !== linkEditor.benefitId
                            ? [prior.featureId + ":" + prior.benefitId]
                            : []),
                        ]),
                      ],
                      links: links.map(l =>
                        l.id === linkEditor.id
                          ? { ...linkEditor, manual: true }
                          : l
                      ),
                    });
                    setLinkEditor(null);
                  }}
                >
                  应用关联
                </Button>
                <Button
                  variant="outline"
                  className="text-destructive"
                  onClick={() => {
                    onChange({
                      ...data,
                      excludedLinks: [
                        ...new Set([
                          ...(data.excludedLinks || []),
                          linkEditor.featureId + ":" + linkEditor.benefitId,
                        ]),
                      ],
                      links: links.filter(l => l.id !== linkEditor.id),
                    });
                    setLinkEditor(null);
                  }}
                >
                  移除关联
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
