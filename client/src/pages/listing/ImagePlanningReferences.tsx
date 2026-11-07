import PlanningAssetPicker from "./PlanningAssetPicker";
import ResearchReadOnly from "./ResearchReadOnly";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { AmazonStyleGallery } from "../knowledge/AmazonStyleGallery";
import type { ImageOutline } from "@shared/imagePlanning";

function ReferenceCollection({
  id,
  data,
  onChange,
  onRemove,
}: {
  id: number;
  data: ImageOutline;
  onChange: (d: ImageOutline) => void;
  onRemove: () => void;
}) {
  const query = trpc.kbImages.getSet.useQuery({ id }, { staleTime: 60000 }),
    [open, setOpen] = useState(false),
    [selected, setSelected] = useState<number | null>(null),
    [target, setTarget] = useState("");
  const set = query.data;
  const targets = data.groups.flatMap((g, gi) =>
    g.items.map((i, ii) => ({
      id: i.id,
      label: `${gi + 1}-${ii + 1} ${g.family}·${g.moduleType} ${i.content.slice(0, 22)}`,
    }))
  );
  const associate = (imageId: number) => {
    if (!target) return;
    onChange({
      ...data,
      groups: data.groups.map(g => ({
        ...g,
        items: g.items.map(i =>
          i.id === target
            ? {
                ...i,
                references: i.references.some(
                  r => r.setId === id && r.imageId === imageId
                )
                  ? i.references.filter(
                      r => !(r.setId === id && r.imageId === imageId)
                    )
                  : [...i.references, { setId: id, imageId }],
              }
            : i
        ),
      })),
    });
  };
  if (query.isLoading)
    return <div className="rounded-xl border p-6">正在读取参考套图…</div>;
  if (!set)
    return (
      <div className="space-y-2 rounded-xl border p-5">
        <p>套图已删除或暂时无法读取</p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          重试
        </Button>
        <Button variant="ghost" onClick={onRemove}>
          移除引用
        </Button>
      </div>
    );
  const group = (role: string) =>
    set.images.filter(i => i.imagePosition === role);
  return (
    <section
      className="min-w-0 rounded-xl border bg-background"
      aria-label={`参考套图 ${set.asin}`}
    >
      <div className="space-y-3 border-b p-4">
        <div className="flex justify-between gap-2">
          <div>
            <h3 className="font-semibold">{set.asin}</h3>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {set.productTitle}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onRemove}>
            移除
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            完整套图预览
          </Button>
          <Link
            href={`/knowledge/images/${id}`}
            className="self-center text-xs text-primary underline"
          >
            在知识库查看
          </Link>
        </div>
        <label className="block text-xs text-muted-foreground">
          关联到大纲图片
          <select
            aria-label={`${set.asin}关联位置`}
            className="mt-1 w-full rounded-lg border bg-background p-2 text-sm"
            value={target}
            onChange={e => setTarget(e.target.value)}
          >
            <option value="">请选择图片位置</option>
            {targets.map(t => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="max-h-[650px] space-y-4 overflow-y-auto p-3">
        {["main", "secondary", "aplus", "brand_story"].map(
          role =>
            group(role).length > 0 && (
              <div key={role}>
                <h4 className="mb-2 text-xs font-semibold text-muted-foreground">
                  {
                    {
                      main: "主图",
                      secondary: "附图",
                      aplus: "A+",
                      brand_story: "品牌故事",
                    }[role]
                  }
                </h4>
                <div className="space-y-3">
                  {group(role).map(img => {
                    const assigned = data.groups
                      .flatMap(g => g.items)
                      .find(i => i.id === target)
                      ?.references.some(
                        r => r.imageId === img.id && r.setId === id
                      );
                    return (
                      <div key={img.id} className="rounded-lg border p-2">
                        <button
                          className="block w-full"
                          onClick={() => {
                            setSelected(img.id);
                            setOpen(true);
                          }}
                        >
                          <img
                            src={img.imageUrl}
                            alt={`${set.asin} ${role} ${(img.positionIndex ?? 0) + 1}`}
                            className="max-h-[230px] w-full object-contain"
                            loading="lazy"
                          />
                        </button>
                        {target && (
                          <Button
                            variant={assigned ? "secondary" : "outline"}
                            size="sm"
                            className="mt-2 w-full"
                            onClick={() => associate(img.id)}
                          >
                            {assigned ? "已关联，点击取消" : "作为这张图的参考"}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="max-h-[92vh] w-[95vw] max-w-[1400px] overflow-y-auto"
        >
          <DialogTitle>参考套图 · {set.asin}</DialogTitle>
          <AmazonStyleGallery
            mainImages={group("main") as any}
            secondaryImages={group("secondary") as any}
            aplusImages={group("aplus") as any}
            brandStoryImages={group("brand_story") as any}
            sourceLayout={set.sourceLayout}
            presentation={set.contentPresentation}
            videos={set.videos}
            selectedImageId={selected}
            onSelectImage={setSelected}
            allowEdit={false}
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}
export default function ImagePlanningReferences({
  data,
  onChange,
  onPersist,
  readOnly=false,
  projectId,
}: {
  data: ImageOutline;
  onChange: (d: ImageOutline) => void;
  onPersist: (d: ImageOutline) => Promise<boolean>;
  readOnly?:boolean;
  projectId?:number;
}) {
  const latestData = useRef(data);
  latestData.current = data;
  const [pickerOpen,setPickerOpen]=useState(false),
    [asin, setAsin] = useState(""),
    [collecting, setCollecting] = useState(false);
  const sets = trpc.kbImages.listSets.useQuery(
      { scope: "all", includeThumbnails: false },
      { refetchInterval: data.pendingAsins.length ? 5000 : false }
    ),
    importAsin = trpc.kbImages.importByAsin.useMutation();
  const full =
    data.referenceSets.length + data.pendingAsins.length >= data.referenceSlots;
  useEffect(() => {
    const ready = data.pendingAsins
      .map(asin => ({
        asin,
        set: sets.data?.find(
          s => s.asin.toUpperCase() === asin && s.status === "confirmed"
        ),
      }))
      .filter(x => x.set);
    if (readOnly || !ready.length) return;
    onChange({
      ...data,
      referenceSets: [
        ...new Set([...data.referenceSets, ...ready.map(x => x.set!.id)]),
      ].slice(0, data.referenceSlots),
      pendingAsins: data.pendingAsins.filter(
        asin => !ready.some(x => x.asin === asin)
      ),
    });
  }, [sets.data, data, onChange,readOnly]);
  const remove = (id: number) =>
    onChange({
      ...data,
      referenceSets: data.referenceSets.filter(n => n !== id),
      groups: data.groups.map(g => ({
        ...g,
        items: g.items.map(i => ({
          ...i,
          references: i.references.filter(r => r.setId !== id),
        })),
      })),
    });
  async function collect() {
    if(readOnly)return;
    const value = asin.trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(value)) {
      toast.error("请输入10位 ASIN");
      return;
    }
    if (data.pendingAsins.includes(value)) {
      toast.info("这个 ASIN 正在采集");
      return;
    }
    const existing = sets.data?.find(s => s.asin.toUpperCase() === value);
    if (existing) {
      if (existing.status !== "confirmed") {
        toast.info("该套图尚未完成采集，请先到知识库查看进度");
        return;
      }
      if (data.referenceSets.includes(existing.id)) {
        toast.info("该套图已选为参考");
        return;
      }
      onChange({
        ...data,
        referenceSets: [...data.referenceSets, existing.id],
      });
      setAsin("");
      return;
    }
    setCollecting(true);
    try {
      if (!(await onPersist(data))) return;
      await importAsin.mutateAsync({ asin: value });
      const next = {
        ...latestData.current,
        pendingAsins: [...latestData.current.pendingAsins, value],
      };
      onChange(next);
      await onPersist(next);
      setAsin("");
      toast.success("已开始采集，完成入库后会显示在这里");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "采集暂未启动，请重试"
      );
    } finally {
      setCollecting(false);
    }
  }
  return (
    <ResearchReadOnly locked={readOnly}><div className="space-y-5">
      <div className="rounded-xl border bg-background p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">人工选择参考套图</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              默认三套，最多五套；选择整套参考后，可手动关联其中的图片。所有选择随大纲保存。
            </p>
          </div>
          <label className="text-sm">
            参考位置
            <select
              aria-label="参考套图位置数量"
              className="ml-2 rounded border bg-background p-2"
              value={data.referenceSlots}
              onChange={e => {
                const n = Number(e.target.value);
                if (n < data.referenceSets.length + data.pendingAsins.length) {
                  toast.info("请先移除多余参考套图");
                  return;
                }
                onChange({ ...data, referenceSlots: n });
              }}
            >
              {[3, 4, 5].map(n => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" onClick={()=>setPickerOpen(true)}>选择知识库ASIN集</Button>
          <Button variant="ghost" onClick={() => void sets.refetch()}>
            刷新套图
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Input
            aria-label="参考ASIN"
            placeholder="输入新 ASIN，采集后加入参考"
            className="max-w-[320px]"
            maxLength={10}
            value={asin}
            onChange={e => setAsin(e.target.value.toUpperCase())}
          />
          <Button
            disabled={!asin || full || collecting}
            onClick={() => void collect()}
          >
            {collecting ? "正在提交采集…" : "采集到知识库并引用"}
          </Button>
          <Link
            href="/knowledge/acquisition"
            className="self-center text-xs text-primary underline"
          >
            查看采集任务
          </Link>
        </div>
        {sets.error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            知识库暂时无法读取，请刷新重试。
          </p>
        )}
      </div>
      {data.pendingAsins.map(value => (
        <div
          key={value}
          className="flex items-center justify-between rounded-xl border p-4"
        >
          <p className="text-sm">{value} · 等待采集完成并入库</p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              onChange({
                ...data,
                pendingAsins: data.pendingAsins.filter(a => a !== value),
              })
            }
          >
            取消等待
          </Button>
        </div>
      ))}
      <div className="grid items-start gap-4 xl:grid-cols-3 md:grid-cols-2">
        {data.referenceSets.map(id => (
          <ReferenceCollection
            key={id}
            id={id}
            data={data}
            onChange={onChange}
            onRemove={() => remove(id)}
          />
        ))}
        {Array.from(
          {
            length: Math.max(
              0,
              data.referenceSlots -
                data.referenceSets.length -
                data.pendingAsins.length
            ),
          },
          (_, i) => (
            <div
              key={i}
              className="flex min-h-[230px] items-center justify-center rounded-xl border border-dashed bg-muted/10 text-sm text-muted-foreground"
            >
              参考套图位置{" "}
              {data.referenceSets.length + data.pendingAsins.length + i + 1}
            </div>
          )
        )}
      </div>
      {pickerOpen && <PlanningAssetPicker mode="sets" projectId={projectId} selectedSetIds={data.referenceSets} maxSelections={5-data.pendingAsins.length} onClose={()=>setPickerOpen(false)} onConfirm={({setIds})=>{onChange({...data,referenceSets:setIds,referenceSlots:Math.max(3,data.referenceSlots,setIds.length+data.pendingAsins.length),groups:data.groups.map(g=>({...g,items:g.items.map(i=>({...i,references:i.references.filter(r=>setIds.includes(r.setId))}))}))});setPickerOpen(false);}}/>}
    </div></ResearchReadOnly>
  );
}
