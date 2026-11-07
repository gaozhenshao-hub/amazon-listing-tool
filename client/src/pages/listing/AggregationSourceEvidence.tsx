import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import type { GraphNode } from "@shared/featureBenefitEditing";
import KnowledgeVideoPlayer from "../knowledge/KnowledgeVideoPlayer";
const labels = {
  listing: "Listing 原文",
  bullet: "五点描述",
  image: "图片",
  module: "A+／品牌故事文案",
  video: "视频片段",
  review: "评论",
  product: "本品属性",
  user: "用户补充",
} as const;
export default function AggregationSourceEvidence({
  projectId,
  node,
  onClose,
}: {
  projectId: number;
  node: GraphNode;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1),
    refs = node.evidence || [];
  const query = trpc.analysis.aggregationSourceEvidence.useQuery(
    { projectId, nodeId:node.id, page },
    { enabled: refs.length > 0, refetchOnWindowFocus: false }
  );
  return (
    <Sheet
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>查看证据 · {node.text}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 p-5">
          {node.note && (
            <p className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm">
              {node.note}
            </p>
          )}
          {node.comparisonScope && (
            <p className="text-sm text-muted-foreground">
              比较范围：{node.comparisonScope}
            </p>
          )}
          {!refs.length ? (
            <p className="text-sm text-muted-foreground">
              这是一条人工整理的内容，尚未关联原始 Listing
              或图片。详细判断可以补充在标注中。
            </p>
          ) : query.error ? (
            <div role="alert" className="space-y-2 text-sm"><p>证据暂时读取失败，请稍后重试。</p><Button variant="outline" onClick={()=>void query.refetch()}>重试</Button></div>
          ) : !query.data ? (
            <p className="text-sm">正在读取证据…</p>
          ) : (
            <>
              {query.data.items.map((item, i) => (
                <article key={i} className="space-y-3 rounded-xl border p-4">
                  <header className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <strong>{labels[item.kind]}</strong>
                    <span className="rounded bg-muted px-2 py-1 text-xs">
                      {item.basis === "user"
                        ? "用户补充"
                        : item.basis === "inferred"
                          ? "功能支持的推导获益"
                          : "直接来源"}
                    </span>
                  </header>
                  {item.asin && (
                    <p className="text-xs text-muted-foreground">
                      {item.asin} · {item.title}{" "}
                      <a
                        className="text-primary underline"
                        href={"https://www.amazon.com/dp/" + item.asin}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看 Listing
                      </a>
                    </p>
                  )}
                  {item.stale && (
                    <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">
                      来源发生变化，请核对当前内容。
                    </p>
                  )}
                  {item.imageUrl && (
                    <a href={item.imageUrl} target="_blank" rel="noreferrer">
                      <img
                        src={item.imageUrl}
                        alt="卖点来源原图"
                        className="block max-h-[480px] w-full object-contain"
                        loading="lazy"
                      />
                    </a>
                  )}
                  {item.video && (
                    <KnowledgeVideoPlayer
                      video={item.video}
                      autoplayOnSeek={false}
                      seek={
                        item.start === null
                          ? undefined
                          : { seconds: item.start, nonce: i + 1 }
                      }
                    />
                  )}
                  {item.originalText && (
                    <p className="whitespace-pre-wrap text-sm">
                      {item.originalText}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {item.quote}
                  </p>
                </article>
              ))}
              {query.data.total > query.data.pageSize && (
                <div className="flex items-center justify-between">
                  <Button
                    variant="outline"
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    上一页
                  </Button>
                  <span className="text-xs">
                    第 {page} 页 · 共 {query.data.total} 项来源
                  </span>
                  <Button
                    variant="outline"
                    disabled={page * query.data.pageSize >= query.data.total}
                    onClick={() => setPage(page + 1)}
                  >
                    下一页
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
