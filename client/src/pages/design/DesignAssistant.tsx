import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AiResultActions } from "@/components/ai/AiResultActions";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { defaultDesignParams, isDesignPending } from "@shared/designStudio";

type Reference = { id: string; name: string; bytes: number };
type Group = "products" | "composition" | "effect";
type References = Record<Group, Reference[]>;
const empty: References = { products: [], composition: [], effect: [] };
const label: Record<Group, string> = {
  products: "产品主体",
  composition: "构图参考",
  effect: "效果图参考",
};
const detail: Record<Group, string> = {
  products: "可上传多张不同角度的产品照片，保持产品结构、颜色和细节。",
  composition: "上传线稿、手绘或文字示意，决定产品位置和画面内容。",
  effect: "上传效果图，参考风格、色彩、光线和质感。",
};

export default function DesignAssistant({ mode }: { mode: "chat" | "scene" }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [refs, setRefs] = useState<References>(empty);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [revisionAsset, setRevisionAsset] = useState<string | null>(null);
  const [improvementId, setImprovementId] = useState<string | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const editor = useRef<HTMLTextAreaElement>(null);
  const restored = useRef<string | null>(null);
  const submitting = useRef(false);
  const createId = useRef<string | null>(null);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const utils = trpc.useUtils();
  const conversations = trpc.designStudio.conversations.useQuery({
    limit: 100,
    kind: mode,
  });
  const history = trpc.designStudio.history.useQuery(
    { id: selected!, limit: 100 },
    {
      enabled: !!selected,
      refetchInterval: 4000,
      refetchIntervalInBackground: false,
    }
  );
  const create = trpc.designStudio.create.useMutation();
  const chat = trpc.designStudio.chat.useMutation();
  const generate = trpc.designStudio.generate.useMutation();
  const check = trpc.designStudio.check.useMutation();
  const improve = trpc.designStudio.sceneImprovement.useMutation();
  const busy =
    sending ||
    uploading ||
    !!history.data?.chats.some(item => isDesignPending(item.status)) ||
    !!history.data?.items.some(item => isDesignPending(item.status));
  const current = history.data?.chats.at(-1);
  useEffect(() => {
    if (
      mode !== "scene" ||
      !selected ||
      !history.data ||
      restored.current === selected
    )
      return;
    restored.current = selected;
    const scene = (history.data.chats.at(-1)?.params as any)?.scene;
    if (
      scene &&
      Array.isArray(scene.products) &&
      scene.composition &&
      scene.effect
    ) {
      const asRef = (id: string, name: string): Reference => ({
        id,
        name,
        bytes: 0,
      });
      setRefs({
        products: scene.products.map((id: string, i: number) =>
          asRef(id, `产品主体 ${i + 1}`)
        ),
        composition: [asRef(scene.composition, "构图参考")],
        effect: [asRef(scene.effect, "效果图参考")],
      });
    }
  }, [mode, selected, history.data]);
  const refresh = async () => {
    await Promise.all([
      utils.designStudio.history.invalidate(),
      utils.designStudio.conversations.invalidate(),
    ]);
  };
  async function upload(group: Group, files: FileList | null) {
    if (!files?.length) return;
    const items = Array.from(files);
    if (
      (group !== "products" && items.length !== 1) ||
      (group === "products" && items.length + refs.products.length > 14)
    )
      return void toast.error("产品主体最多 14 张，构图和效果参考各 1 张");
    const currentBytes = Object.entries(refs)
      .flatMap(([key, value]) =>
        key === group && group !== "products" ? [] : value
      )
      .reduce((n, r) => n + r.bytes, 0);
    if (
      items.some(f => f.size > 10 * 1024 * 1024) ||
      currentBytes + items.reduce((n, f) => n + f.size, 0) > 30 * 1024 * 1024
    )
      return void toast.error("每张图片最多 10MB，合计最多 30MB");
    setUploading(true);
    try {
      const loaded: Reference[] = [];
      for (const file of items) {
        const form = new FormData();
        form.append("image", file);
        const res = await fetch("/api/design/upload", {
          method: "POST",
          body: form,
          credentials: "same-origin",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "上传失败");
        loaded.push(data);
      }
      setRefs(previous => ({
        ...previous,
        [group]:
          group === "products" ? [...previous.products, ...loaded] : loaded,
      }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }
  async function submit() {
    if (busy || submitting.current || !prompt.trim()) return;
    if (
      mode === "scene" &&
      (!refs.products.length ||
        refs.composition.length !== 1 ||
        refs.effect.length !== 1)
    )
      return void toast.error("请上传三组参考图");
    if (revisionAsset && refs.products.length + 3 > 16)
      return void toast.error("调整时最多使用 13 张产品主体图");
    submitting.current = true;
    setSending(true);
    try {
      let id = selected;
      if (!id) {
        createId.current ||= crypto.randomUUID();
        id = createId.current;
        await create.mutateAsync({ id, kind: mode });
        setSelected(id);
      }
      const all = [...refs.products, ...refs.composition, ...refs.effect]
        .map(r => r.id)
        .concat(revisionAsset ? [revisionAsset] : []);
      const data = {
        conversationId: id,
        prompt,
        params: defaultDesignParams,
        references: all,
        referenceMode: "replace" as const,
        ...(mode === "scene"
          ? {
              scene: {
                products: refs.products.map(r => r.id),
                composition: refs.composition[0].id,
                effect: refs.effect[0].id,
                ...(revisionAsset ? { revision: revisionAsset } : {}),
              },
            }
          : {}),
      };
      const signature = JSON.stringify(data);
      if (request.current?.signature !== signature)
        request.current = { signature, id: crypto.randomUUID() };
      await chat.mutateAsync({ ...data, requestId: request.current.id });
      request.current = null;
      setPrompt("");
      setRevisionAsset(null);
      setAdjustOpen(false);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "发送失败");
    } finally {
      submitting.current = false;
      setSending(false);
    }
  }
  async function confirm() {
    if (!selected || !current?.plan?.ready || busy || submitting.current)
      return;
    submitting.current = true;
    setSending(true);
    try {
      const signature = `generate:${selected}:${current.id}`;
      if (request.current?.signature !== signature)
        request.current = { signature, id: crypto.randomUUID() };
      await generate.mutateAsync({
        conversationId: selected,
        requestId: request.current.id,
        planId: current.id,
      });
      request.current = null;
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "生成失败");
    } finally {
      submitting.current = false;
      setSending(false);
    }
  }
  const choose = (id: string | null) => {
    setSelected(id);
    setPrompt("");
    setRefs(empty);
    setRevisionAsset(null);
    restored.current = null;
    createId.current = null;
    request.current = null;
  };
  return (
    <div className="mx-auto flex max-w-7xl gap-5 p-5 max-md:flex-col">
      <aside className="w-60 shrink-0 rounded-xl border bg-card p-4 max-md:w-full">
        <Button className="w-full" onClick={() => choose(null)} disabled={busy}>
          新建{mode === "chat" ? "对话" : "场景图"}
        </Button>
        <p className="my-4 text-sm text-muted-foreground">仅本人可查看</p>
        <div className="space-y-1">
          {conversations.data?.items.map(item => (
            <button
              key={item.id}
              onClick={() => choose(item.id)}
              className={`w-full truncate rounded-md p-2 text-left text-sm ${selected === item.id ? "bg-muted font-medium" : "hover:bg-muted"}`}
            >
              {item.title}
            </button>
          ))}
        </div>
      </aside>
      <main className="min-w-0 flex-1 space-y-5">
        <header>
          <h1 className="text-2xl font-semibold">
            {mode === "chat" ? "美工 AI 对话" : "场景图生成"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "chat"
              ? "GEM 3.8 · 你的对话仅自己可见"
              : "GEM 3.8 策划 · Image 2.5 生图"}
          </p>
        </header>
        {mode === "scene" && (
          <div className="grid gap-3 md:grid-cols-3">
            {(["products", "composition", "effect"] as Group[]).map(group => (
              <section key={group} className="rounded-xl border bg-card p-4">
                <h2 className="font-semibold">{label[group]}</h2>
                <p className="mt-1 min-h-10 text-xs text-muted-foreground">
                  {detail[group]}
                </p>
                <input
                  aria-label={label[group]}
                  type="file"
                  accept="image/*"
                  multiple={group === "products"}
                  disabled={busy}
                  onChange={e => {
                    void upload(group, e.target.files);
                    e.target.value = "";
                  }}
                  className="mt-3 block w-full text-xs"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  {refs[group].map(r => (
                    <div key={r.id} className="relative">
                      <img
                        src={`/api/design/assets/${r.id}`}
                        alt={r.name}
                        className="h-20 w-20 rounded-md object-cover"
                      />
                      <button
                        aria-label={`移除 ${r.name}`}
                        className="absolute right-0 top-0 rounded bg-black/70 px-1 text-white"
                        onClick={() =>
                          setRefs(v => ({
                            ...v,
                            [group]: v[group].filter(x => x.id !== r.id),
                          }))
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
        <section className="min-h-64 space-y-4 rounded-xl border bg-card p-4">
          {!history.data?.chats.length && !history.data?.items.length && (
            <p className="text-sm text-muted-foreground">
              {mode === "chat"
                ? "输入问题，开始聊天。"
                : "上传参考图并描述需求，AI 将先整理方案供你确认。"}
            </p>
          )}
          {history.data?.chats.map(turn => (
            <div key={turn.id} className="space-y-2">
              <p className="whitespace-pre-wrap rounded-lg bg-muted p-3">
                {turn.prompt}
              </p>
              {turn.reply && (
                <p className="whitespace-pre-wrap p-2">{turn.reply}</p>
              )}
              {turn.error && (
                <p className="text-sm text-destructive">{turn.error}</p>
              )}
              {isDesignPending(turn.status) && (
                <p className="text-sm text-muted-foreground">正在思考…</p>
              )}
              {mode === "scene" && turn.plan?.ready && (
                <div className="rounded-lg border p-3">
                  <p className="font-medium">图片方案</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm">
                    {turn.plan.promptTranslation || turn.plan.prompt}
                  </p>
                  {turn.id === current?.id && !turn.generationId && (
                    <Button
                      className="mt-3"
                      onClick={() => void confirm()}
                      disabled={busy}
                    >
                      确认并生成
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
          {history.data?.items.map(item => (
            <div key={item.id}>
              <p className="text-sm">
                {item.status === "succeeded"
                  ? "生成完成"
                  : item.error ||
                    (item.status === "unknown"
                      ? "生成状态需要核对"
                      : item.status === "failed"
                        ? "图片生成失败"
                        : "图片正在生成…")}
              </p>
              {item.status === "unknown" && item.canCheck && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={check.isPending}
                  onClick={async () => {
                    try {
                      await check.mutateAsync({ id: item.id });
                      await refresh();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "检查失败");
                    }
                  }}
                >
                  检查进度
                </Button>
              )}
              <div className="mt-2 flex flex-wrap gap-3">
                {item.assetIds.map(id => (
                  <a
                    key={id}
                    href={`/api/design/assets/${id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      className="max-h-96 rounded-lg"
                      src={`/api/design/assets/${id}`}
                      alt="生成的场景图"
                    />
                  </a>
                ))}
              </div>
              {mode === "scene" &&
                item.status === "succeeded" &&
                item.assetIds[0] && (
                  <div className="mt-3">
                    <AiResultActions
                      context={{
                        businessModule: "design",
                        sourceResultId: item.id,
                        input: item.prompt,
                        originalResult: item.assetIds[0],
                        editedResult: "",
                        feedback: "",
                        targetType: "skill",
                        targetKey: "design.scene.plan",
                        scope: "current_result",
                      }}
                      onAdjust={() => {
                        setRevisionAsset(item.assetIds[0]);
                        setAdjustOpen(true);
                      }}
                      onImprove={() => {
                        setFeedback("");
                        setImprovementId(item.id);
                      }}
                    />
                  </div>
                )}
            </div>
          ))}
        </section>
        <div className="space-y-2">
          {revisionAsset && (
            <p className="text-sm text-muted-foreground">
              正在调整已生成的图片{" "}
              <button
                className="underline"
                onClick={() => setRevisionAsset(null)}
              >
                取消调整
              </button>
            </p>
          )}
          <textarea
            ref={editor}
            className="min-h-28 w-full rounded-lg border bg-background p-3"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder={
              mode === "chat"
                ? "输入想聊的内容…"
                : "描述希望呈现的场景，也可以补充产品不能改变的细节…"
            }
          />
          <Button
            onClick={() => void submit()}
            disabled={busy || !prompt.trim()}
          >
            {mode === "chat" ? "发送" : "策划场景图"}
          </Button>
        </div>
        <Dialog
          open={!!improvementId}
          onOpenChange={open => {
            if (!open && !improve.isPending) setImprovementId(null);
          }}
        >
          <DialogContent>
            <DialogTitle>用于改进场景图技能</DialogTitle>
            <p className="text-sm text-muted-foreground">
              说明哪里需要改进。系统会把本次输入、参考图、原结果和意见保存为技能草稿，不会自动修改正式技能。
            </p>
            <textarea
              className="min-h-28 rounded-lg border bg-background p-3"
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              placeholder="例如：产品标识变形，应该保持原样"
            />
            <Button
              disabled={improve.isPending || feedback.trim().length < 2}
              onClick={async () => {
                try {
                  await improve.mutateAsync({
                    generationId: improvementId!,
                    feedback,
                  });
                  setImprovementId(null);
                  toast.success("已保存技能改进草稿");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "保存失败");
                }
              }}
            >
              创建改进草稿
            </Button>
          </DialogContent>
        </Dialog>
        <Dialog
          open={adjustOpen}
          onOpenChange={open => {
            if (!open && !sending) {
              setAdjustOpen(false);
              setRevisionAsset(null);
            }
          }}
        >
          <DialogContent className="sm:max-w-xl">
            <DialogTitle>调整这张场景图</DialogTitle>
            <p className="text-sm text-muted-foreground">
              告诉 AI
              需要修改什么，它会结合当前图片和三组参考图重新策划；确认方案后才会生成。
            </p>
            {revisionAsset && (
              <img
                src={`/api/design/assets/${revisionAsset}`}
                alt="待调整场景图"
                className="max-h-52 rounded-lg object-contain"
              />
            )}
            <textarea
              className="min-h-28 rounded-lg border bg-background p-3"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="描述要调整的地方…"
            />
            <Button
              disabled={busy || !prompt.trim()}
              onClick={() => void submit()}
            >
              发送调整意见
            </Button>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
