import { Streamdown } from "streamdown";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useResearchLock, ResearchLockButton } from "./ResearchLock";
export default function ImageBriefingPanel({
  projectId,
  onContinue,
}: {
  projectId: number;
  onContinue: () => void;
}) {
  const utils = trpc.useUtils();
  const outlines = trpc.imagePlanning.versions.useQuery({ projectId }, {
    refetchInterval: query => ["queued", "running"].includes(query.state.data?.job?.status || "") ? 2500 : false,
  });
  const generateOutline = trpc.imagePlanning.generate.useMutation();
  const useVersion = trpc.imagePlanning.useVersion.useMutation();
  const outlining = generateOutline.isPending || ["queued", "running"].includes(outlines.data?.job?.status || "");
  const lock = useResearchLock(projectId, "planning"),
    query = trpc.imagePlanning.briefing.useQuery(
      { projectId },
      {
        refetchInterval: q =>
          ["queued", "running"].includes(q.state.data?.job?.status || "")
            ? 2500
            : false,
      }
    );
  const improve = trpc.imagePlanning.improveBriefing.useMutation();
  const send = trpc.imagePlanning.sendBriefing.useMutation(),
    clear = trpc.imagePlanning.clearBriefing.useMutation(),
    [message, setMessage] = useState(""),
    end = useRef<HTMLDivElement>(null);
  const working =
    send.isPending ||
    ["queued", "running"].includes(query.data?.job?.status || "");
  const submit = async (opener = false) => {
    if (lock.locked || working) return;
    try {
      await send.mutateAsync({
        projectId,
        message: opener ? "" : message || "请结合目前资料继续给出图片策划建议",
        opener,
      });
      setMessage("");
      await query.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "对话未发送");
    }
  };
  async function generateVersion() {
    if (!outlines.data || outlining || working) return;
    try {
      await generateOutline.mutateAsync({
        projectId,
        revision: outlines.data.revision,
        mode: "generate",
        saveAsVersion: true,
      });
      await outlines.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "大纲暂未生成");
    }
  }
  async function selectVersion(versionId: string) {
    if (!outlines.data) return;
    try {
      await useVersion.mutateAsync({ projectId, versionId, revision: outlines.data.revision });
      await Promise.all([
        outlines.refetch(),
        utils.imagePlanning.get.invalidate({ projectId }),
        utils.imageDocument.get.invalidate({ projectId }),
        utils.analysis.researchLocks.invalidate({ projectId }),
      ]);
      toast.success("套图文档已切换到选定的大纲");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "大纲版本暂未切换");
      await outlines.refetch();
    }
  }
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "nearest" });
  }, [query.data?.messages.length]);
  return (
    <section className="overflow-hidden rounded-2xl border bg-background">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 p-5">
        <div>
          <h2 className="text-lg font-semibold">图片策划</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            和图片策划大师讨论表达重点、画面风格与配色。交流会一直保存到你主动清空。
          </p>
        </div>
        <div className="flex gap-2">
          <ResearchLockButton state={lock} />
          <Button
            variant="outline"
            disabled={lock.locked || clear.isPending || working}
            onClick={async () => {
              if (
                !window.confirm(
                  "清空当前项目的图片策划对话？此操作不会删除卖点或图片大纲。"
                )
              )
                return;
              try {
                await clear.mutateAsync({ projectId });
                await query.refetch();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "清空失败");
              }
            }}
          >
            清空对话
          </Button>
        </div>
      </header>
      <div
        className="max-h-[58vh] min-h-64 space-y-4 overflow-y-auto p-5"
        aria-live="polite"
      >
        {query.error && <p role="alert">{query.error.message}</p>}
        {query.data?.messages.map(m => (
          <article
            key={m.id}
            className={
              "max-w-[90%] rounded-2xl p-4 text-sm " +
              (m.role === "user"
                ? "ml-auto bg-primary/10"
                : "border bg-muted/20")
            }
          >
            <strong className="mb-2 block text-xs text-muted-foreground">
              {m.role === "user" ? "你" : "图片策划大师 · 小L"}
            </strong>
            {m.role === "assistant" ? (
              <div className="prose prose-sm max-w-none leading-7">
                <Streamdown>{m.text}</Streamdown>
              </div>
            ) : (
              <p className="whitespace-pre-wrap leading-7">{m.text}</p>
            )}
          </article>
        ))}
        {working && (
          <p className="text-sm text-muted-foreground">
            小L正在结合卖点、评论与买家问题思考…
          </p>
        )}
        {query.data?.job?.error && (
          <p role="alert" className="text-sm text-destructive">
            {query.data.job.error}
            <Button
              size="sm"
              variant="ghost"
              disabled={lock.locked || working}
              onClick={() => void submit(query.data?.messages.length === 0)}
            >
              重试
            </Button>
          </p>
        )}
        {!query.isLoading && !query.error && !query.data?.opened && !query.data?.messages.length && <div className="mx-auto max-w-2xl space-y-5 py-8 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-2xl">✦</div><h3 className="text-xl font-semibold">你好，我是图片策划大师 · 小L</h3><p className="text-sm leading-7 text-muted-foreground">我会结合已确认的功能与用户获益、好差评、买家问题和竞品图片，与你讨论表达重点、画面风格和配色。你可以随时提出想法，我们的交流会保存在这个项目里。</p><Button size="lg" className="min-w-56 py-7 text-base" disabled={lock.locked || working} onClick={()=>void submit(true)}>开始对话</Button><p className="text-xs text-muted-foreground">资料已经充分时，也可以直接进入图片大纲。</p></div>}
        <div ref={end} />
      </div>
      <div className="space-y-3 border-t p-4">
        {(query.data?.opened || !!query.data?.messages.length) && <>
        <textarea
          aria-label="图片策划对话"
          value={message}
          maxLength={4000}
          disabled={lock.locked || working}
          onChange={e => setMessage(e.target.value)}
          placeholder={
            lock.locked
              ? "已锁定，可浏览之前的交流"
              : "比如：主图更突出产品结构，附图加强舒适与选码说明；你建议用什么配色？"
          }
          className="min-h-24 w-full resize-y rounded-xl border bg-background p-3 text-sm"
        />
        </>}
        <div className="flex items-center justify-between gap-3">
          <Button
            disabled={lock.locked || working || !message.trim()}
            onClick={() => void submit()}
          >
            发送
          </Button>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={
                lock.locked ||
                working ||
                improve.isPending ||
                query.data?.job?.status !== "succeeded"
              }
              onClick={async () => {
                const feedback = window.prompt(
                  "这次策划有哪些值得保留或改进的地方？提交后建立独立改进草稿。"
                );
                if (!feedback?.trim()) return;
                try {
                  await improve.mutateAsync({ projectId, feedback });
                  toast.success("已建立独立改进草稿，正式技能保持原有版本");
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : "改进草稿未创建"
                  );
                }
              }}
            >
              用于改进
            </Button>
            <Button variant="outline" onClick={onContinue}>
              继续：找参考图
            </Button>
            <Button disabled={!outlines.data || outlining || working || useVersion.isPending} onClick={() => void generateVersion()}>
              {outlining ? "正在生成图片大纲…" : "一键生成图片大纲"}
            </Button>
          </div>
        </div>
      </div>
      <section className="space-y-3 border-t p-5" aria-label="图片大纲版本">
        <h3 className="font-semibold">图片大纲版本</h3>
        <p className="text-xs text-muted-foreground">选定版本后，套图文档和图片制作会切换到该版本。可以随时切回。</p>
        {outlines.error && <p role="alert">{outlines.error.message}</p>}
        {["failed", "canceled"].includes(outlines.data?.job?.status || "") && (
          <p role="alert" className="text-sm text-destructive">大纲未生成，请重试。</p>
        )}
        {outlining && <p role="status" className="text-sm">正在根据策划对话生成新版本。</p>}
        {outlines.data?.versions.map((version, index) => (
          <article key={version.id || "legacy"} className="space-y-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-center gap-3">
              <h4 className="font-medium">{version.legacy ? "原有大纲" : `版本 ${index + (outlines.data?.versions[0]?.legacy ? 0 : 1)}`}</h4>
              {version.selected && <span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">使用中</span>}
            </div>
            <details open={index === (outlines.data?.versions.length || 0) - 1}>
              <summary className="cursor-pointer text-sm">查看大纲</summary>
              <p className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap text-sm leading-6">{version.text}</p>
            </details>
            {!version.selected && version.id && (
              <Button variant="outline" disabled={useVersion.isPending || outlining} onClick={() => void selectVersion(version.id!)}>
                使用该版本
              </Button>
            )}
          </article>
        ))}
      </section>
    </section>
  );
}
