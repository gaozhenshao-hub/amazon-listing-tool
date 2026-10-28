import { libraryFacets } from "@shared/libraryFacets";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import type { KBScope } from "@/components/KBScopeToggle";
import { useKBTagOptions } from "@/hooks/useKBTagOptions";
import { useLibraryBrowseState } from "./useLibraryBrowseState";
import { KbAsinSetGrid } from "./KbAsinSetGrid";
import { groupImageSets, type AsinSetGroupBy } from "./kbImageSetGrouping";
import KnowledgeContributions from "./KnowledgeContributions";
import SetImportDialog from "./SetImportDialog";
import {
  LibrarySearch,
  LibraryToolbar,
  LibrarySelect,
  CommonTagFilters,
  LibraryPagination,
  EMPTY_COMMON_FILTERS,
} from "./LibraryToolbar";

export default function SetLibraryBrowse({ onTags }: { onTags: () => void }) {
  const [, navigate] = useLocation(),
    tags = useKBTagOptions();
  const [scope, setScope] = useLibraryBrowseState<KBScope>(
      "sets.scope",
      "shared"
    ),
    [query, setQuery] = useLibraryBrowseState("sets.query", ""),
    [filters, setFilters] = useLibraryBrowseState(
      "sets.filters",
      EMPTY_COMMON_FILTERS
    ),
    [groupBy, setGroup] = useLibraryBrowseState<AsinSetGroupBy>(
      "sets.group",
      "style"
    ),
    [page, setPage] = useLibraryBrowseState("sets.page", 1);
  const [showImport, setImport] = useState(false),
    [showContributions, setContributions] = useState(false);
  const result = trpc.kbImages.listSets.useQuery(
    { scope, includeThumbnails: false },
    {
      staleTime: 60_000,
      refetchInterval: q =>
        q.state.data?.some(
          s =>
            ["crawling", "analyzing"].includes(s.status) ||
            (s.status === "confirmed" &&
              (!s.setCategory ||
                !s.setStyle ||
                !s.setPrimaryColor ||
                s.setAccentColor == null))
        )
          ? 5000
          : false,
    }
  );
  const filterKey = JSON.stringify([scope, query, filters, groupBy]),
    previous = useRef(filterKey);
  useEffect(() => {
    if (previous.current !== filterKey) setPage(1);
    previous.current = filterKey;
  }, [filterKey, setPage]);
  const facets=libraryFacets((result.data||[]).filter(s=>!query||[s.asin,s.productTitle,s.brand].some(v=>v?.toLowerCase().includes(query.toLowerCase()))).map(s=>({style:s.setStyle,category:s.setCategory,primaryColor:s.setPrimaryColor,accentColor:s.setAccentColor})),filters,["style","category","primaryColor","accentColor"]);
  const filtered = (result.data || []).filter(
    s =>
      (!query ||
        [s.asin, s.productTitle, s.brand].some(v =>
          v?.toLowerCase().includes(query.toLowerCase())
        )) &&
      (!filters.style || s.setStyle === filters.style) &&
      (!filters.category || s.setCategory === filters.category) &&
      (!filters.primaryColor || s.setPrimaryColor === filters.primaryColor) &&
      (!filters.accentColor ||
        s.setAccentColor ===
          (filters.accentColor === "__none" ? "" : filters.accentColor))
  );
  const count = Math.max(1, Math.ceil(filtered.length / 50)),
    currentPage = Math.min(page, count),
    pageSets = groupImageSets(filtered, groupBy)
      .flatMap(g => g.items)
      .slice((currentPage - 1) * 50, currentPage * 50);
  const thumbnails = trpc.kbImages.setThumbnails.useQuery(
    { ids: pageSets.map(s => s.id), scope },
    { enabled: pageSets.length > 0, staleTime: 120_000 }
  );
  const sets = pageSets.map(s => ({
    ...s,
    thumbnailImages:
      thumbnails.data?.find(t => t.id === s.id)?.thumbnailImages || [],
  }));
  return (
    <section className="space-y-4" aria-label="ASIN集">
      <LibrarySearch
        scope={scope}
        onScope={setScope}
        query={query}
        onQuery={setQuery}
        placeholder="搜索 ASIN、产品名、品牌"
      />
      <LibraryToolbar
        onTags={onTags}
        onImport={() => setImport(true)}
        importLabel="套图导入"
      >
        <LibrarySelect
          label="ASIN集分组"
          value={groupBy}
          onChange={v => setGroup(v as AsinSetGroupBy)}
          options={[
            { value: "style", label: "按风格分组" },
            { value: "category", label: "按类目分组" },
            { value: "primaryColor", label: "按主色分组" },
            { value: "accentColor", label: "按提亮色分组" },
            { value: "none", label: "不分组" },
          ]}
        />
        <CommonTagFilters value={filters} onChange={setFilters} tags={tags} facets={facets} />
      </LibraryToolbar>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {filtered.length} 个 ASIN 集 · 每页 50 个
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setContributions(true)}
          >
            采集贡献榜
          </Button>
        </div>
        <LibraryPagination
          page={currentPage}
          total={count}
          hasMore={currentPage < count}
          onPage={setPage}
        />
      </div>
      {result.isLoading ? (
        <p className="py-12 text-center">正在读取套图…</p>
      ) : result.error ? (
        <p role="alert">
          套图暂时无法读取。
          <Button variant="link" onClick={() => result.refetch()}>
            重试
          </Button>
        </p>
      ) : !sets.length ? (
        <p className="rounded-xl border py-16 text-center text-muted-foreground">
          暂无符合条件的套图
        </p>
      ) : (
        <KbAsinSetGrid
          sets={sets}
          groupCounts={Object.fromEntries(groupImageSets(filtered,groupBy).map(g=>[g.key,g.items.length]))}
          groupBy={groupBy}
          statusMap={{
            crawling: { label: "采集中", variant: "secondary" },
            analyzing: { label: "AI分析中", variant: "secondary" },
            pending_review: { label: "待确认", variant: "default" },
            confirmed: { label: "已入库", variant: "outline" },
          }}
          onOpen={id => {
            const asin = sets.find(s => s.id === id)?.asin;
            navigate(
              `/knowledge/images/${id}${asin ? `?asin=${encodeURIComponent(asin)}` : ""}`
            );
          }}
        />
      )}
      <KnowledgeContributions
        open={showContributions}
        onClose={() => setContributions(false)}
      />
      {showImport && <SetImportDialog onClose={() => setImport(false)} />}
    </section>
  );
}
