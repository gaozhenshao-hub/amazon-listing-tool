import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { manualTextClass } from "./ManualText";
import {
  PROMPT_STAGES,
  type ImageDocument,
  type DocumentEntry,
} from "@shared/imageDocument";
import {
  IMAGE_PRODUCTION_STAGES,
  productionPromptsReady,
  type ProductionStage,
} from "@shared/imageProduction";
import {
  defaultDesignParams,
  designStatusLabels,
  isDesignPending,
} from "@shared/designStudio";

const field = "w-full rounded-lg border bg-background p-3 text-sm";
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "操作未完成，请重试";
const assetUrl = (id: string, projectId: number) =>
  `/api/design/listing/${projectId}/assets/${id}`;

export function ImageProductionWorkspace({
  projectId,
  document,
  locked,
  busy,
  onSave,
  onPrompts,
  promptPreviewReady,
  promptGenerationBlocked,
  onEntryChange,
  requestedImageId,
}: {
  projectId: number;
  document: ImageDocument;
  locked: boolean;
  busy: boolean;
  onSave: () => Promise<boolean>;
  onPrompts: () => void;
  promptPreviewReady?: boolean;
  promptGenerationBlocked?: boolean;
  onEntryChange: (entry: DocumentEntry) => void;
  requestedImageId?: string | null;
}) {
  const [selected, setSelected] = useState(document.entries[0]?.imageId || "");
  const anchor = useRef<HTMLElement>(null);
  useEffect(() => {
    if (requestedImageId) {
      setSelected(requestedImageId);
      anchor.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    }
  }, [requestedImageId]);
  const entry =
    document.entries.find(e => e.imageId === selected) || document.entries[0];
  return (
    <section
      ref={anchor}
      className="space-y-5 rounded-2xl border bg-background p-5"
      aria-label="AI提示词与图片制作"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">AI 提示词与图片制作</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            先确认图片内容，再生成五段提示词，按四步制作图片。每步可继续对话调整。
          </p>
        </div>
        <Button
          disabled={
            busy ||
            promptGenerationBlocked ||
            (!promptPreviewReady && !document.organized)
          }
          onClick={onPrompts}
        >
          {promptPreviewReady ? "AI提示词结果预览" : "一键生成 AI 提示词"}
        </Button>
      </div>
      {!document.organized && (
        <p className="text-sm text-amber-800">
          请先采用图片内容结果，再生成提示词。
        </p>
      )}
      <label className="block text-sm">
        当前制作图位
        <select
          className={field + " mt-2"}
          value={entry?.imageId || ""}
          onChange={e => setSelected(e.target.value)}
        >
          {document.entries.map((e, i) => (
            <option key={e.imageId} value={e.imageId}>
              {i + 1}. {e.title || "待规划图片"} · {e.width} × {e.height}
            </option>
          ))}
        </select>
      </label>
      {entry && (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            {PROMPT_STAGES.map(stage => (
              <label
                key={stage.key}
                className="block rounded-xl border p-4 text-sm"
              >
                <strong>{stage.name}</strong>
                <p className="my-2 text-xs text-muted-foreground">
                  {stage.description}
                </p>
                <textarea
                  className={
                    field +
                    " min-h-32 " +
                    manualTextClass(
                      entry.manualFields?.includes(`prompts.${stage.key}`)
                    )
                  }
                  aria-label={`${stage.name}制作提示词`}
                  disabled={locked || busy}
                  value={entry.prompts[stage.key] || ""}
                  maxLength={6000}
                  onChange={e =>
                    onEntryChange({
                      ...entry,
                      prompts: {
                        ...entry.prompts,
                        [stage.key]: e.target.value,
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
          <Button
            variant="outline"
            disabled={locked || busy}
            onClick={() => void onSave()}
          >
            保存提示词修改
          </Button>
          {entry.width && entry.height ? (
            <ProductionImage
              key={entry.imageId}
              projectId={projectId}
              entry={entry}
              promptsReady={productionPromptsReady(entry, document)}
              onSave={onSave}
              blocked={
                busy ||
                !!promptPreviewReady ||
                !!promptGenerationBlocked ||
                !document.organized
              }
            />
          ) : (
            <p>当前模块为原生文字，无需生成图片。</p>
          )}
        </>
      )}
    </section>
  );
}

function ProductionImage({
  projectId,
  entry,
  onSave,
  blocked,
  promptsReady,
}: {
  projectId: number;
  entry: DocumentEntry;
  onSave: () => Promise<boolean>;
  blocked: boolean;
  promptsReady: boolean;
}) {
  const utils = trpc.useUtils();
  const query = trpc.imageProduction.get.useQuery(
    { projectId, imageId: entry.imageId },
    { refetchOnWindowFocus: false }
  );
  const save = trpc.imageProduction.saveReferences.useMutation();
  const open = trpc.imageProduction.open.useMutation();
  const [uploading, setUploading] = useState(false);
  const [step, setStep] = useState<
    | (Awaited<ReturnType<typeof open.mutateAsync>> & { readOnly?: boolean })
    | null
  >(null);
  const [opening, setOpening] = useState(false);
  async function refs(
    kind: "productAssets" | "compositionAssets",
    assets: string[]
  ) {
    if (!query.data) return;
    await save.mutateAsync({
      projectId,
      imageId: entry.imageId,
      revision: query.data.revision,
      kind,
      assets,
    });
    await query.refetch();
  }
  async function upload(
    kind: "productAssets" | "compositionAssets",
    files: File[]
  ) {
    if (uploading || !files.length || !query.data) return;
    setUploading(true);
    try {
      const ids = [...query.data.data[kind]];
      if (ids.length + files.length > (kind === "productAssets" ? 14 : 4))
        throw new Error(
          kind === "productAssets"
            ? "本品参考图最多14张"
            : "上传构图参考最多4张"
        );
      for (const file of files) {
        if (file.size > 10 * 1024 * 1024) throw new Error("每张图片不超过10MB");
        const form = new FormData();
        form.append("image", file);
        const response = await fetch(
          `/api/design/listing/${projectId}/upload`,
          { method: "POST", credentials: "same-origin", body: form }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "图片上传失败");
        ids.push(data.id);
      }
      await refs(kind, ids);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setUploading(false);
    }
  }
  async function openStep(stage: ProductionStage) {
    if (opening) return;
    setOpening(true);
    try {
      if (!(await onSave())) return;
      const result = await open.mutateAsync({
        projectId,
        imageId: entry.imageId,
        stage,
      });
      setStep(result);
      await query.refetch();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setOpening(false);
    }
  }
  if (query.isLoading) return <p>正在读取图片制作记录…</p>;
  if (query.error)
    return (
      <div role="alert">
        图片制作记录暂时无法读取。
        <Button variant="link" onClick={() => void query.refetch()}>
          重试
        </Button>
      </div>
    );
  if (!query.data) return null;
  const state = query.data.data;
  return (
    <div className="space-y-5">
      {(["compositionAssets", "productAssets"] as const).map(kind => (
        <section
          key={kind}
          tabIndex={0}
          className="rounded-xl border p-4 outline-offset-4"
          aria-label={
            kind === "productAssets" ? "本品参考图上传区" : "构图参考上传区"
          }
          onPaste={e => {
            const files = Array.from(e.clipboardData.files).filter(f =>
              f.type.startsWith("image/")
            );
            if (files.length) {
              e.preventDefault();
              void upload(kind, files);
            }
          }}
        >
          <h3 className="font-semibold">
            {kind === "productAssets" ? "本品参考图" : "手动构图参考"}
          </h3>
          <p className="my-2 text-xs leading-5 text-muted-foreground">
            {kind === "productAssets"
              ? state.productAssets.length
                ? "优先使用这里指定的本品图；可上传不同角度及配件照片。"
                : `当前未指定，将使用“本品信息补充”的 ${query.data.fallbackPhotos.length} 张照片。`
              : `优先使用这里上传的结构图；未上传时使用图片方案中手动选定的 ${entry.references.composition.length} 张构图参考；都没有则只使用提示词。`}
          </p>
          <div className="flex flex-wrap gap-3">
            {state[kind].map(id => (
              <div key={id} className="w-28">
                <a
                  href={assetUrl(id, projectId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={assetUrl(id, projectId)}
                    alt={
                      kind === "productAssets" ? "本品参考图" : "人工构图参考"
                    }
                    className="h-24 w-28 rounded border object-contain"
                  />
                </a>
                <Button
                  variant="link"
                  size="sm"
                  disabled={uploading || save.isPending}
                  onClick={() =>
                    void refs(
                      kind,
                      state[kind].filter(x => x !== id)
                    ).catch(e => toast.error(errorText(e)))
                  }
                >
                  移除
                </Button>
              </div>
            ))}
          </div>
          <label className="mt-3 inline-block cursor-pointer rounded-lg border px-3 py-2 text-sm">
            {uploading ? "正在上传…" : "上传图片"}
            <input
              aria-label={
                kind === "productAssets" ? "上传本品参考图" : "上传构图参考"
              }
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              disabled={uploading || save.isPending || blocked}
              onChange={e => {
                void upload(kind, Array.from(e.target.files || []));
                e.target.value = "";
              }}
            />
          </label>
          <span className="ml-3 text-xs text-muted-foreground">
            也可点击此区域后按 Ctrl+V 粘贴图片
          </span>
          {kind === "productAssets" && !state.productAssets.length && (
            <p className="mt-2 text-xs">
              {query.data.fallbackPhotos.map(p => p.name).join("、") ||
                "还没有本品图，请先补充。"}
            </p>
          )}
        </section>
      ))}
      <div>
        <h3 className="mb-3 font-semibold">一键生成图片</h3>
        {!promptsReady && (
          <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            图片方案尚无对应的五段提示词，或方案已有修改。请先一键生成并确认提示词，再开始四步制作。
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-4">
          {IMAGE_PRODUCTION_STAGES.map((s, i) => {
            const enabled =
              !i || query.data!.current[IMAGE_PRODUCTION_STAGES[i - 1].key];
            const previous = state.stages[s.key];
            return (
              <div key={s.key} className="space-y-2 rounded-xl border p-3">
                <Button
                  className="w-full"
                  disabled={
                    blocked || opening || uploading || !enabled || !promptsReady
                  }
                  onClick={() => void openStep(s.key)}
                >
                  {i + 1}. {s.label}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {query.data!.current[s.key]
                    ? "已采用，可继续对话调整"
                    : previous?.acceptedAssetId
                      ? "基于旧版本，请更新本步骤"
                      : !enabled
                        ? "请先采用上一步图片"
                        : "打开 Image 2.5 对话"}
                </p>
                {previous?.acceptedAssetId && (
                  <a
                    href={assetUrl(previous.acceptedAssetId, projectId)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      src={assetUrl(previous.acceptedAssetId, projectId)}
                      alt={`${s.label}已采用结果`}
                      className="h-32 w-full rounded object-contain"
                    />
                  </a>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          每步单独触发；选定结果并“采用此图”后开启下一步。产品嵌入同时执行交互与光影融合。
        </p>
      </div>
      {!!state.archives.length && (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer text-sm">
            历史制作版本（{state.archives.length}）
          </summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {state.archives.map((old, i) => (
              <Button
                key={old.conversationId}
                variant="outline"
                size="sm"
                onClick={() => setStep({ ...old, readOnly: true })}
              >
                {i + 1}.{" "}
                {IMAGE_PRODUCTION_STAGES.find(s => s.key === old.stage)?.label}{" "}
                · 查看旧版
              </Button>
            ))}
          </div>
        </details>
      )}
      {step && (
        <ProductionDialog
          key={step.conversationId}
          projectId={projectId}
          entry={entry}
          step={step}
          onClose={() => setStep(null)}
          onAdopt={async () => {
            await utils.imageProduction.get.invalidate({
              projectId,
              imageId: entry.imageId,
            });
          }}
        />
      )}
    </div>
  );
}

function ProductionDialog({
  projectId,
  entry,
  step,
  onClose,
  onAdopt,
}: {
  projectId: number;
  entry: DocumentEntry;
  step: {
    conversationId: string;
    stage: ProductionStage;
    prompt: string;
    references: string[];
    readOnly?: boolean;
  };
  onClose: () => void;
  onAdopt: () => Promise<void>;
}) {
  const utils = trpc.useUtils();
  const [message, setMessage] = useState(step.prompt);
  const [revision, setRevision] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const pendingRequest = useRef<{ signature: string; id: string } | null>(null);
  const guard = useRef(false);
  const history = trpc.designStudio.history.useQuery(
    { id: step.conversationId, limit: 500 },
    { refetchInterval: 3000 }
  );
  const chat = trpc.designStudio.chat.useMutation();
  const generate = trpc.designStudio.generate.useMutation();
  const adopt = trpc.imageProduction.adopt.useMutation();
  const check = trpc.designStudio.check.useMutation();
  const latest = history.data?.chats.at(-1);
  const busy =
    step.readOnly ||
    sending ||
    adopt.isPending ||
    history.data?.chats.some(x => isDesignPending(x.status)) ||
    history.data?.items.some(x => isDesignPending(x.status));
  const stage = IMAGE_PRODUCTION_STAGES.find(s => s.key === step.stage)!;
  const ratio = entry.width / entry.height;
  const closest = (
    [
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "3:2",
      "2:3",
      "5:4",
      "4:5",
      "2:1",
      "1:2",
      "21:9",
      "9:21",
    ] as const
  ).reduce((best, key) => {
    const value = (s: string) => {
      const [w, h] = s.split(":").map(Number);
      return w / h;
    };
    return Math.abs(Math.log(value(key) / ratio)) <
      Math.abs(Math.log(value(best) / ratio))
      ? key
      : best;
  });
  const params = { ...defaultDesignParams, aspect_ratio: closest };
  async function refresh() {
    await utils.designStudio.history.invalidate({ id: step.conversationId });
  }
  function requestId(signature: string) {
    if (pendingRequest.current?.signature !== signature)
      pendingRequest.current = { signature, id: crypto.randomUUID() };
    return pendingRequest.current.id;
  }
  async function send() {
    if (busy || guard.current || !message.trim()) return;
    guard.current = true;
    setSending(true);
    try {
      const references = [
        ...new Set([...step.references, ...(revision ? [revision] : [])]),
      ];
      const payload = {
        conversationId: step.conversationId,
        prompt: message,
        params,
        references,
        referenceMode: "replace" as const,
      };
      await chat.mutateAsync({
        ...payload,
        requestId: requestId(JSON.stringify(payload)),
      });
      pendingRequest.current = null;
      setMessage("");
      setRevision(null);
      await refresh();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      guard.current = false;
      setSending(false);
    }
  }
  async function createImage() {
    if (busy || guard.current || !latest?.plan?.ready) return;
    guard.current = true;
    setSending(true);
    try {
      await generate.mutateAsync({
        conversationId: step.conversationId,
        planId: latest.id,
        requestId: requestId("generate:" + latest.id),
      });
      pendingRequest.current = null;
      await refresh();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      guard.current = false;
      setSending(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[92vh] w-[95vw] max-w-6xl flex-col overflow-hidden"
      >
        <DialogTitle>
          Image 2.5 · {stage.label} · {entry.title || "当前图片"}
        </DialogTitle>
        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-1">
          <p className="text-xs text-muted-foreground">
            {step.readOnly
              ? "正在查看历史版本，图片和对话保留供参考；继续制作请返回当前版本。"
              : `使用“${stage.name}”方法。对话先整理方案，点击“确认并生成”才生图；关闭后记录保留。`}
          </p>
          <a
            href={`/emperor/skills?workbench=${encodeURIComponent(stage.skill)}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs underline"
          >
            查看或优化本步骤的方法
          </a>
          <p className="text-xs text-muted-foreground">
            目标尺寸 {entry.width} × {entry.height}；模型使用接近的 {closest}{" "}
            比例、{params.resolution} 分辨率。请核对生成结果的实际尺寸。
          </p>
          {!!step.references.length && (
            <div className="flex flex-wrap gap-2">
              {step.references.map((id, i) => (
                <a
                  key={id}
                  href={assetUrl(id, projectId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={assetUrl(id, projectId)}
                    alt={`本步骤参考图${i + 1}`}
                    className="h-20 w-24 rounded border object-contain"
                  />
                  <span className="text-xs">参考图 {i + 1}</span>
                </a>
              ))}
            </div>
          )}
          {history.error && (
            <p role="alert">
              对话暂时无法读取。
              <Button variant="link" onClick={() => void refresh()}>
                重试
              </Button>
            </p>
          )}
          {history.data?.chats.map(turn => (
            <div
              key={turn.id}
              className="space-y-2 rounded-xl bg-muted/40 p-4 text-sm"
            >
              <p className="whitespace-pre-wrap">
                <strong>你：</strong>
                {turn.prompt}
              </p>
              <p className="whitespace-pre-wrap">
                <strong>美工助手：</strong>
                {turn.reply || turn.error || "正在整理需求…"}
              </p>
            </div>
          ))}
          {latest?.plan?.ready && (
            <details open className="rounded-xl border p-4">
              <summary className="text-sm font-semibold">
                本次实际生图提示词
              </summary>
              <p className="mt-3 whitespace-pre-wrap text-sm">
                {latest.plan.prompt}
              </p>
              {latest.plan.promptTranslation && (
                <p className="mt-3 whitespace-pre-wrap text-sm">
                  中文对照：{latest.plan.promptTranslation}
                </p>
              )}
              <Button
                className="mt-3"
                disabled={busy || !!latest.generationId}
                onClick={() => void createImage()}
              >
                {latest.generationId
                  ? "已提交，可在下方查看结果"
                  : "确认并生成"}
              </Button>
            </details>
          )}
          {history.data?.items.map(item => (
            <section key={item.id} className="space-y-3 rounded-xl border p-4">
              <p className="text-sm">
                {designStatusLabels[item.status] || "正在核对"}
                {item.error ? ` · ${item.error}` : ""}
              </p>
              {item.status === "unknown" && item.canCheck && (
                <Button
                  variant="outline"
                  disabled={check.isPending}
                  onClick={async () => {
                    try {
                      await check.mutateAsync({ id: item.id });
                      await refresh();
                    } catch (e) {
                      toast.error(errorText(e));
                    }
                  }}
                >
                  查询已有任务进度
                </Button>
              )}
              {item.assetIds.map(id => (
                <div key={id} className="space-y-3">
                  <a
                    href={assetUrl(id, projectId)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      src={assetUrl(id, projectId)}
                      alt={`${stage.label}生成结果`}
                      className="max-h-[55vh] w-full rounded object-contain"
                    />
                  </a>
                  <div className="flex gap-2">
                    <Button
                      disabled={busy || item.status !== "succeeded"}
                      onClick={async () => {
                        try {
                          await adopt.mutateAsync({
                            projectId,
                            imageId: entry.imageId,
                            stage: step.stage,
                            conversationId: step.conversationId,
                            generationId: item.id,
                            assetId: id,
                          });
                          await onAdopt();
                          toast.success("已采用此图，下一步可以继续");
                          onClose();
                        } catch (e) {
                          toast.error(errorText(e));
                        }
                      }}
                    >
                      采用此图
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setRevision(id);
                        setMessage("请保留这张图未提到的部分，调整：");
                      }}
                    >
                      调整这张图（AI）
                    </Button>
                    <a
                      className="self-center text-sm underline"
                      href={assetUrl(id, projectId) + "?download=1"}
                    >
                      下载
                    </a>
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
        <div className="shrink-0 space-y-2 border-t pt-3">
          {revision && (
            <p className="text-xs">
              本轮会带入你选中的图片继续调整。
              <Button
                size="sm"
                variant="link"
                onClick={() => setRevision(null)}
              >
                取消选中
              </Button>
            </p>
          )}
          <textarea
            aria-label="图片制作对话"
            className={field + " h-24"}
            maxLength={8000}
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="说明希望如何调整，可多轮沟通"
          />
          <div className="flex gap-2">
            <Button
              disabled={busy || !message.trim()}
              onClick={() => void send()}
            >
              {busy ? "处理中…" : "发送给美工助手"}
            </Button>
            <Button variant="outline" onClick={onClose}>
              保存记录并返回
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
