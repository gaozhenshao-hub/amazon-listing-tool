import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { AdjustResultButton } from "./KnowledgeAssetActions";
import AssetDeleteButton from "./AssetDeleteButton";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  VIDEO_TYPES,
  VIDEO_CONTENT_TAGS,
  videoTime,
  type VideoLabels,
  KNOWLEDGE_VIDEO_SKILL,
} from "@shared/videoLabels";
import KnowledgeVideoPlayer from "./KnowledgeVideoPlayer";
import { KnowledgeTag } from "./KnowledgeTag";

export function KnowledgeVideoContent({
  id,
  initialLabel,
  onDeleted,
}: {
  id: number;
  initialLabel?: string;
  onDeleted?: () => void;
}) {
  const {user}=useAuth();
  const utils = trpc.useUtils(),
    data = trpc.kbVideos.get.useQuery(
      { id },
      {
        refetchInterval: q =>
          q.state.data &&
          ["queued", "running"].includes(q.state.data.labelStatus)
            ? 4000
            : false,
      }
    );
  const [seek, setSeek] = useState<{ seconds: number; nonce: number }>(),
    [filter, setFilter] = useState(""),
    [edit, setEdit] = useState<VideoLabels | null>(null),
    [editRevision, setEditRevision] = useState(0),
    [role, setRole] = useState<"main" | "aplus" | null>(null);
  async function refresh() {
    await Promise.all([
      utils.kbVideos.get.invalidate({ id }),
      utils.kbVideos.list.invalidate(),
      utils.kbVideos.facets.invalidate(),
    ]);
  }
  const save = trpc.kbVideos.save.useMutation({
    onSuccess: () => {
      setEdit(null);
      void refresh();
      toast.success("标签与时间段已保存");
    },
    onError: e => toast.error(e.message),
  });
  const run = trpc.kbVideos.runTags.useMutation({
    onSuccess: () => {
      void refresh();
      toast.success("已开始分析，原标签会保留到新结果完成");
    },
    onError: e => toast.error(e.message),
  });
  const item = data.data,
    labels = edit || item?.labels,
    busy = item && ["queued", "running"].includes(item.labelStatus);
  const initialStart = item?.labels?.segments.find(
    s => s.label === initialLabel
  )?.start;
  useEffect(() => {
    if (initialLabel && initialStart !== undefined) {
      setFilter(initialLabel);
      setSeek({ seconds: initialStart, nonce: Date.now() });
    }
  }, [initialLabel, item?.id, initialStart]);
  const field = "w-full rounded-md border bg-background px-2 py-1.5 text-sm";
  return (
    <>
        {data.isLoading ? (
          <p>正在读取视频…</p>
        ) : !item ? (
          <p>视频暂时无法读取，请刷新重试。</p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
            <div className="space-y-4">
              <KnowledgeVideoPlayer video={item.video} seek={seek} />
              <div className="rounded-lg bg-muted/40 p-4">
                <p className="text-sm">
                  {item.labels?.summary ||
                    "上传完成后会自动分析视频类型和内容片段。"}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  时间段由 AI 根据画面和语音估计，可点击核对并编辑起止时间。
                </p>
              </div>
              {item.canEdit && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={Boolean(busy) || run.isPending}
                    onClick={() => run.mutate({ id, revision: item.revision })}
                  >
                    {busy
                      ? "AI 正在打标…"
                      : item.labels
                        ? "重新打标"
                        : "开始打标"}
                  </Button>
                  {["admin","super_admin"].includes(user?.role||"")&&<AssetDeleteButton kind="video" id={id} label="删除本视频" onDeleted={()=>onDeleted?.()}/>}
                  {item.labels && (
                    <Button
                      variant="outline"
                      disabled={Boolean(busy)}
                      onClick={() => {
                        setEdit(structuredClone(item.labels!));
                        setEditRevision(item.revision);
                        setRole(item.video.role);
                      }}
                    >
                      编辑标签与时间
                    </Button>
                  )}
                </div>
              )}
              {item.error && (
                <p
                  role="alert"
                  className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800"
                >
                  {item.error}
                </p>
              )}
              {item.canEdit && <AdjustResultButton kind="video" id={id} onSaved={()=>void refresh()}/>}

            </div>
            <div className="space-y-4">
              <div className="rounded-xl border p-4">
                <h3 className="mb-3 font-semibold">视频标签</h3>
                {labels ? (
                  <>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      {(
                        [
                          ["category", "类目"],
                          ["style", "风格"],
                          ["primaryColor", "主色"],
                          ["accentColor", "提亮色"],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key}>
                          <span className="mb-1 block text-xs text-muted-foreground">
                            {label}
                          </span>
                          {edit && !item.imageSetId ? (
                            <input
                              className={field}
                              aria-label={label}
                              value={edit[key]}
                              onChange={e =>
                                setEdit({ ...edit, [key]: e.target.value })
                              }
                            />
                          ) : (
                            <KnowledgeTag tone="set" color={key === "primaryColor" || key === "accentColor"}>{labels[key] || "未设置"}</KnowledgeTag>
                          )}
                        </label>
                      ))}
                    </div>
                    <div className="mt-4 space-y-3">
                      <label className="block text-sm">
                        视频归属
                        {edit && !item.imageSetId ? (
                          <select
                            className={field}
                            aria-label="视频归属"
                            value={role || ""}
                            onChange={e =>
                              setRole(
                                e.target.value
                                  ? (e.target.value as "main" | "aplus")
                                  : null
                              )
                            }
                          >
                            <option value="">待设置</option>
                            <option value="main">主图视频</option>
                            <option value="aplus">A+ 视频</option>
                          </select>
                        ) : (
                          <KnowledgeTag className="ml-2">
                            {item.video.role === "main"
                              ? "主图视频"
                              : item.video.role === "aplus"
                                ? "A+ 视频"
                                : "待设置"}
                          </KnowledgeTag>
                        )}
                      </label>
                      <label className="block text-sm">
                        视频类型
                        {edit ? (
                          <select
                            className={field}
                            aria-label="视频类型"
                            value={edit.type}
                            onChange={e =>
                              setEdit({
                                ...edit,
                                type: e.target.value as VideoLabels["type"],
                              })
                            }
                          >
                            {VIDEO_TYPES.map(t => (
                              <option key={t}>{t}</option>
                            ))}
                          </select>
                        ) : (
                          <KnowledgeTag tone="video" className="mt-2">{labels.type}</KnowledgeTag>
                        )}
                      </label>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {busy ? "正在分析视频，请稍候…" : "尚未完成打标"}
                  </p>
                )}
              </div>
              {labels && (
                <div className="rounded-xl border p-4">
                  <h3 className="font-semibold">
                    内容时间段{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      {labels.segments.length} 个片段
                    </span>
                  </h3>
                  {!edit && (
                    <div className="my-3 flex flex-wrap gap-1.5">
                      <button
                        onClick={() => setFilter("")}
                        className={`rounded-full border px-2 py-1 text-xs ${!filter ? "border-primary text-primary" : ""}`}
                      >
                        全部
                      </button>
                      {[...new Set(labels.segments.map(s => s.label))].map(
                        tag => (
                          <button
                            key={tag}
                            className={`rounded-full border px-2 py-1 text-xs ${filter === tag ? "border-primary text-primary" : ""}`}
                            onClick={() => {
                              setFilter(tag);
                              const first = labels.segments.find(
                                s => s.label === tag
                              );
                              if (first)
                                setSeek({
                                  seconds: first.start,
                                  nonce: Date.now(),
                                });
                            }}
                          >
                            {tag}
                          </button>
                        )
                      )}
                    </div>
                  )}
                  <div className="max-h-[480px] space-y-2 overflow-y-auto">
                    {labels.segments.map((segment, index) =>
                      edit ? (
                        <div
                          key={index}
                          className="space-y-2 rounded-lg border p-3"
                        >
                          <select
                            aria-label={`片段${index + 1}标签`}
                            className={field}
                            value={segment.label}
                            onChange={e =>
                              setEdit({
                                ...edit,
                                segments: edit.segments.map((s, i) =>
                                  i === index
                                    ? {
                                        ...s,
                                        label: e.target.value as typeof s.label,
                                      }
                                    : s
                                ),
                              })
                            }
                          >
                            {VIDEO_CONTENT_TAGS.map(t => (
                              <option key={t}>{t}</option>
                            ))}
                          </select>
                          <div className="flex items-center gap-2">
                            {(["start", "end"] as const).map(key => (
                              <label key={key} className="text-xs">
                                {key === "start" ? "开始秒数" : "结束秒数"}
                                <input
                                  type="number"
                                  min="0"
                                  max={item.duration || 600}
                                  step="0.1"
                                  aria-label={`片段${index + 1}${key === "start" ? "开始" : "结束"}`}
                                  className={field}
                                  value={segment[key]}
                                  onChange={e =>
                                    setEdit({
                                      ...edit,
                                      segments: edit.segments.map((s, i) =>
                                        i === index
                                          ? {
                                              ...s,
                                              [key]: Number(e.target.value),
                                            }
                                          : s
                                      ),
                                    })
                                  }
                                />
                              </label>
                            ))}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setEdit({
                                  ...edit,
                                  segments: edit.segments.filter(
                                    (_, i) => i !== index
                                  ),
                                })
                              }
                            >
                              移除
                            </Button>
                          </div>
                          <textarea
                            aria-label={`片段${index + 1}说明`}
                            className={field}
                            value={segment.description}
                            onChange={e =>
                              setEdit({
                                ...edit,
                                segments: edit.segments.map((s, i) =>
                                  i === index
                                    ? { ...s, description: e.target.value }
                                    : s
                                ),
                              })
                            }
                          />
                        </div>
                      ) : (
                        (!filter || filter === segment.label) && (
                          <button
                            key={index}
                            className="w-full rounded-lg border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5"
                            onClick={() =>
                              setSeek({
                                seconds: segment.start,
                                nonce: Date.now(),
                              })
                            }
                          >
                            <div className="flex justify-between gap-2 text-sm">
                              <span className="font-medium">
                                {segment.label}
                              </span>
                              <span className="font-mono text-primary">
                                {videoTime(segment.start)}—
                                {videoTime(segment.end)}
                              </span>
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              {segment.description}
                            </p>
                          </button>
                        )
                      )
                    )}
                  </div>
                  {edit && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setEdit({
                            ...edit,
                            segments: [
                              ...edit.segments,
                              {
                                label: "核心使用",
                                start: 0,
                                end: Math.min(item.duration || 1, 1),
                                description: "",
                              },
                            ],
                          })
                        }
                      >
                        添加片段
                      </Button>
                      <Button
                        size="sm"
                        disabled={save.isPending}
                        onClick={() =>
                          save.mutate({
                            id,
                            revision: editRevision,
                            labels: edit,
                            role,
                          })
                        }
                      >
                        保存修改
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEdit(null)}
                      >
                        取消
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
    </>
  );
}

export default function KnowledgeVideoDetail({id, initialLabel, onClose}: {id:number; initialLabel?:string; onClose:()=>void}) {
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[1400px]">
    <DialogHeader><DialogTitle>视频标签与片段</DialogTitle></DialogHeader>
    <KnowledgeVideoContent id={id} initialLabel={initialLabel} onDeleted={onClose} />
  </DialogContent></Dialog>;
}
