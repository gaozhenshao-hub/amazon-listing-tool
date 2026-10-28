import { useState } from "react";
import { Tags } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import KnowledgeVideoDetail from "./KnowledgeVideoDetail";
import KnowledgeVideoPlayer from "./KnowledgeVideoPlayer";
import { CollectionTags, KnowledgeTag } from "./KnowledgeTag";

/** The collection stays a continuous visual reference; editing lives in video detail. */
export default function KnowledgeVideoInline({ id }: { id: number }) {
  const [detail, setDetail] = useState(false);
  const result = trpc.kbVideos.get.useQuery(
    { id },
    {
      staleTime: 30_000,
      refetchInterval: q =>
        q.state.data && ["queued", "running"].includes(q.state.data.labelStatus)
          ? 4000
          : false,
    }
  );
  const item = result.data;
  if (!item)
    return (
      <p className="p-4 text-sm">
        {result.isLoading ? "正在读取视频…" : "视频暂时无法读取"}
        {result.error && (
          <Button variant="link" onClick={() => result.refetch()}>
            重试
          </Button>
        )}
      </p>
    );
  return (
    <>
      <div className="grid items-start gap-4 leading-normal md:grid-cols-[minmax(0,1fr)_280px]">
        <KnowledgeVideoPlayer video={item.video} />
        <aside className="space-y-4 overflow-y-auto rounded-xl border bg-background p-4 text-sm md:h-0 md:min-h-full">
          <h3 className="font-semibold">视频标签</h3>
          {item.labels ? (
            <>
              <CollectionTags {...item.labels} />
              <div className="space-y-3">
                <p>
                  <span className="mr-2 text-xs text-muted-foreground">
                    视频归属
                  </span>
                  <KnowledgeTag>
                    {item.video.role === "main"
                      ? "主图视频"
                      : item.video.role === "aplus"
                        ? "A+ 视频"
                        : "待设置"}
                  </KnowledgeTag>
                </p>
                <KnowledgeTag tone="video">{item.labels.type}</KnowledgeTag>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">
              {item.labelStatus === "failed" ? "标签待重试" : "AI 正在打标…"}
            </p>
          )}
          {item.labels?.summary && (
            <div className="border-t pt-4">
              <h4 className="mb-2 text-xs text-muted-foreground">视频简介</h4>
              <p>{item.labels.summary}</p>
            </div>
          )}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setDetail(true)}
          >
            <Tags className="mr-2 h-4 w-4" />
            标签与片段
          </Button>
        </aside>
      </div>
      {detail && (
        <KnowledgeVideoDetail id={id} onClose={() => setDetail(false)} />
      )}
    </>
  );
}
