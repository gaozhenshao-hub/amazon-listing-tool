import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Tags } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  VIDEO_TYPES,
  VIDEO_CONTENT_TAGS,
  KNOWLEDGE_VIDEO_LIMIT,
} from "@shared/videoLabels";
import KnowledgeVideoPlayer from "./KnowledgeVideoPlayer";
import KnowledgeVideoDetail from "./KnowledgeVideoDetail";
import { KnowledgeTag, CollectionTags } from "./KnowledgeTag";
import { useLibraryBrowseState } from "./useLibraryBrowseState";
import { useKBTagOptions } from "@/hooks/useKBTagOptions";
import type { KBScope } from "@/components/KBScopeToggle";
import {
  LibrarySearch,
  LibraryToolbar,
  LibrarySelect,
  CommonTagFilters,
  LibraryPagination,
  EMPTY_COMMON_FILTERS,
  groupLibraryItems,
} from "./LibraryToolbar";

export default function VideoLibraryBrowse({ onTags }: { onTags: () => void }) {
  const tags = useKBTagOptions();
  const [scope, setScope] = useLibraryBrowseState<KBScope>(
      "video.scope",
      "shared"
    ),
    [query, setQuery] = useLibraryBrowseState("video.query", ""),
    [filters, setFilters] = useLibraryBrowseState(
      "video.filters",
      EMPTY_COMMON_FILTERS
    ),
    [group, setGroup] = useLibraryBrowseState<
      | "none"
      | "type"
      | "category"
      | "style"
      | "primaryColor"
      | "accentColor"
      | "role"
    >("video.group", "type");
  const [role, setRole] = useLibraryBrowseState<"main" | "aplus" | "">(
      "video.role",
      ""
    ),
    [page, setPage] = useLibraryBrowseState("video.page", 1),
    [type, setType] = useLibraryBrowseState("video.type", ""),
    [content, setContent] = useLibraryBrowseState("video.content", "");
  const [selected, setSelected] = useState<{
      id: number;
      label?: string;
    } | null>(null),
    [uploading, setUploading] = useState("");
  const file = useRef<HTMLInputElement>(null),
    busy = useRef(false),
    utils = trpc.useUtils();
  const facets=trpc.kbVideos.facets.useQuery({scope,query,filters:{...filters,role,type,content},groupBy:group},{staleTime:30_000});
  const result = trpc.kbVideos.list.useQuery(
    {
      scope,
      query: query || undefined,
      page,
      groupBy: group,
      category: filters.category || undefined,
      style: filters.style || undefined,
      primaryColor: filters.primaryColor || undefined,
      accentColor: filters.accentColor || undefined,
      role: role || undefined,
      type: type ? (type as (typeof VIDEO_TYPES)[number]) : undefined,
      content: content
        ? (content as (typeof VIDEO_CONTENT_TAGS)[number])
        : undefined,
    },
    {
      staleTime: 20_000,
      refetchInterval: q =>
        q.state.data?.items.some(i =>
          ["queued", "running"].includes(i.labelStatus)
        )
          ? 5000
          : false,
    }
  );
  const filterKey = JSON.stringify([
      scope,
      query,
      role,
      type,
      content,
      filters,
      group,
    ]),
    previous = useRef(filterKey);
  useEffect(() => {
    if (previous.current !== filterKey) setPage(1);
    previous.current = filterKey;
  }, [filterKey, setPage]);
  async function upload(files: FileList | null) {
    if (!files?.length || busy.current) return;
    busy.current = true;
    let saved = 0;
    try {
      for (const [index, item] of Array.from(files).entries()) {
        if (item.size > KNOWLEDGE_VIDEO_LIMIT) {
          toast.error(`${item.name} 超过 100MB，已跳过`);
          continue;
        }
        setUploading(`正在上传 ${index + 1}/${files.length}：${item.name}`);
        const form = new FormData();
        form.append("file", item);
        const response = await fetch("/api/knowledge/videos/upload", {
            method: "POST",
            body: form,
            credentials: "same-origin",
          }),
          data = await response.json();
        if (!response.ok) {
          toast.error(data.error || `${item.name} 上传失败`);
          continue;
        }
        saved++;
        if (data.duplicate) toast.info(`${item.name} 已上传过，保留原视频`);
        await utils.kbVideos.list.invalidate();
      }
      if (saved) toast.success(`已保存 ${saved} 个视频，标签将在后台自动生成`);
    } catch {
      toast.error("上传中断，已保存的视频保留，可以重新选择文件继续");
    } finally {
      busy.current = false;
      setUploading("");
      if (file.current) file.current.value = "";
    }
  }
  const groups = groupLibraryItems(
    result.data?.items || [],
    item =>
      group === "role"
        ? item.video.role === "main"
          ? "主图视频"
          : item.video.role === "aplus"
            ? "A+ 视频"
            : "待设置"
        : group === "none"
          ? ""
          : item.labels?.[group],
    group === "none"
  );
  return (
    <section className="space-y-4" aria-label="知识库视频">
      <LibrarySearch
        scope={scope}
        onScope={setScope}
        query={query}
        onQuery={setQuery}
        placeholder="搜索视频名称、ASIN"
      />
      <LibraryToolbar
        onTags={onTags}
        onImport={() => file.current?.click()}
        importLabel="视频导入"
        busy={!!uploading}
      >
        <LibrarySelect
          label="视频分组"
          value={group}
          onChange={v => setGroup(v as typeof group)}
          options={[
            { value: "type", label: "按视频类型分组" },
            { value: "style", label: "按风格分组" },
            { value: "category", label: "按类目分组" },
            { value: "primaryColor", label: "按主色分组" },
            { value: "accentColor", label: "按提亮色分组" },
            { value: "role", label: "按归属分组" },
            { value: "none", label: "不分组" },
          ]}
        />
        <CommonTagFilters value={filters} onChange={setFilters} tags={tags} facets={facets.data} />
        <LibrarySelect
          label="视频类型筛选" counts={facets.data?.counts.type} total={facets.data?.totals.type}
          allLabel="全部视频类型"
          value={type}
          onChange={setType}
          options={VIDEO_TYPES}
        />
        <LibrarySelect
          label="视频归属筛选" counts={facets.data?.counts.role} total={facets.data?.totals.role}
          allLabel="全部归属"
          value={role}
          onChange={v => setRole(v as typeof role)}
          options={[
            { value: "main", label: "主图视频" },
            { value: "aplus", label: "A+ 视频" },
          ]}
        />
        <LibrarySelect
          label="视频内容筛选" counts={facets.data?.counts.content} total={facets.data?.totals.content}
          allLabel="全部内容"
          value={content}
          onChange={setContent}
          options={VIDEO_CONTENT_TAGS}
        />
      </LibraryToolbar>
      <input
        ref={file}
        type="file"
        multiple
        accept=".mp4,.avi,.mov,.webm,.m4v"
        className="hidden"
        aria-label="选择上传视频"
        onChange={e => void upload(e.target.files)}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {facets.data?.total ?? "…"} 个视频 · 支持多选上传 · 单个 100MB / 10 分钟
        </p>
        <LibraryPagination
          page={page}
          hasMore={!!result.data?.hasMore}
          busy={result.isFetching}
          onPage={setPage}
        />
      </div>
      {uploading && (
        <p role="status" className="rounded-lg bg-primary/5 p-3 text-sm">
          {uploading}
        </p>
      )}
      {result.isLoading ? (
        <p className="py-12 text-center text-muted-foreground">正在读取视频…</p>
      ) : result.error ? (
        <div role="alert">
          视频暂时无法读取。
          <Button
            variant="outline"
            className="ml-3"
            onClick={() => result.refetch()}
          >
            重试
          </Button>
        </div>
      ) : !result.data?.items.length ? (
        <p className="rounded-xl border py-16 text-center text-muted-foreground">
          暂无符合条件的视频，可以上传视频或采集 ASIN。
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map(section => (
            <section key={section.name} className="space-y-3">
              {section.name && (
                <h2 className="text-lg font-semibold">{section.name}（{facets.data?.groups[group === "role" ? section.name === "主图视频" ? "main" : section.name === "A+ 视频" ? "aplus" : "待设置" : section.name] ?? "…"}）</h2>
              )}
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {section.items.map(item => (
                  <article
                    key={item.id}
                    className="overflow-hidden rounded-xl border bg-card shadow-sm"
                  >
                    <KnowledgeVideoPlayer video={item.video} />
                    <div className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="line-clamp-2 font-medium">
                          {item.title}
                        </h3>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelected({ id: item.id })}
                        >
                          <Tags className="mr-1 h-4 w-4" />
                          标签与片段
                        </Button>
                      </div>
                      {item.imageSetId ? (
                        <Link
                          href={`/knowledge/images/${item.imageSetId}?asin=${encodeURIComponent(item.asin || "")}`}
                          className="text-xs text-primary hover:underline"
                        >
                          {item.asin} · 查看整套
                        </Link>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          独立上传
                        </p>
                      )}
                      <div className="flex flex-wrap gap-1.5">
                        {item.labels && (
                          <>
                            <KnowledgeTag tone="video">
                              {item.labels.type}
                            </KnowledgeTag>
                          </>
                        )}
                        {!item.labels && (
                          <span className="text-xs text-muted-foreground">
                            {item.labelStatus === "failed"
                              ? "标签待重试"
                              : ["queued", "running"].includes(item.labelStatus)
                                ? "AI 正在打标…"
                                : "尚未打标"}
                          </span>
                        )}
                      </div>
                      {item.labels && (
                        <CollectionTags {...item.labels} compact />
                      )}
                      {item.labels && (
                        <div className="flex flex-wrap gap-1">
                          {[
                            ...new Set(item.labels.segments.map(s => s.label)),
                          ].map(label => (
                            <button
                              key={label}
                              onClick={() =>
                                setSelected({ id: item.id, label })
                              }
                              className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:border-primary"
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {selected !== null && (
        <KnowledgeVideoDetail
          id={selected.id}
          initialLabel={selected.label}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
