import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useVirtualizer } from "@tanstack/react-virtual";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import type { KBScope } from "@/components/KBScopeToggle";
import { useKBTagOptions } from "@/hooks/useKBTagOptions";
import { useLibraryBrowseState } from "./useLibraryBrowseState";
import {
  LibrarySearch,
  LibraryToolbar,
  LibrarySelect,
  CommonTagFilters,
  LibraryPagination,
  EMPTY_COMMON_FILTERS,
  groupLibraryItems,
} from "./LibraryToolbar";
import {
  SingleImagePreviewDialog,
  type BrowseImage,
} from "./SingleImagePreviewDialog";
import BrowseUnitThumbnail from "./BrowseUnitThumbnail";
import { CollectionTags, KnowledgeTag } from "./KnowledgeTag";
import { imageBelongLabel, distinctImageTags } from "./kbImageLabels";
import { activateGalleryItem } from "./galleryInteraction";
import StandaloneImageUpload from "./StandaloneImageUpload";

const groupFields = {
  type: "tagImageTypeMain",
  style: "tagDesignStyleV2",
  category: "tagCategory",
  primaryColor: "tagColorSchemeV2",
  accentColor: "tagAccentColor",
  belong: "tagImageBelong",
  sellingPoint: "tagSellingPointCategory",
  composition: "tagComposition",
} as const;
type Group = keyof typeof groupFields | "none";
const EMPTY_LOCAL = {
  belong: "",
  belongSub: "",
  type: "",
  typeSub: "",
  sellingPoint: "",
  sellingPointDetail: "",
  composition: "",
};
export default function SingleLibraryBrowse({
  onTags,
}: {
  onTags: () => void;
}) {
  const tags = useKBTagOptions(),
    [, navigate] = useLocation();
  const [scope, setScope] = useLibraryBrowseState<KBScope>(
      "single.scope",
      "shared"
    ),
    [query, setQuery] = useLibraryBrowseState("single.query", ""),
    [filters, setFilters] = useLibraryBrowseState(
      "single.filters",
      EMPTY_COMMON_FILTERS
    ),
    [local, setLocal] = useLibraryBrowseState("single.local", EMPTY_LOCAL),
    [group, setGroup] = useLibraryBrowseState<Group>("single.group", "type"),
    [page, setPage] = useLibraryBrowseState("single.page", 1);
  const [upload, setUpload] = useState(false),
    [preview, setPreview] = useState<BrowseImage | null>(null);
  const filterKey = JSON.stringify([scope, query, filters, local, group]),
    previous = useRef(filterKey);
  useEffect(() => {
    if (previous.current !== filterKey) setPage(1);
    previous.current = filterKey;
  }, [filterKey, setPage]);
  const facets=trpc.kbImages.facets.useQuery({scope,query,filters:{...filters,...local},groupBy:group},{staleTime:30_000});
  const result = trpc.kbImages.listAllImages.useQuery(
    {
      scope,
      query: query || undefined,
      page,
      groupBy: group,
      tagCategory: filters.category || undefined,
      tagDesignStyleV2: filters.style || undefined,
      tagColorSchemeV2: filters.primaryColor || undefined,
      tagAccentColor: filters.accentColor || undefined,
      tagImageTypeMain: local.type || undefined,
      tagImageTypeSub: local.typeSub || undefined,
      tagSellingPointCategory: local.sellingPoint || undefined,
      tagSellingPointDetail: local.sellingPointDetail || undefined,
      tagComposition: local.composition || undefined,
      tagImageBelong: local.belong || undefined,
      tagImageBelongSub: local.belongSub || undefined,
    },
    {
      staleTime: 30_000,
      refetchInterval: q =>
        q.state.data?.some(
          i => !i.imageSetId && ["queued", "running"].includes(i.labelStatus)
        )
          ? 4000
          : false,
    }
  );
  const rows = useMemo(
    () =>
      groupLibraryItems(
        result.data || [],
        i => (group === "none" ? "" : i[groupFields[group]]),
        group === "none"
      ).flatMap(g =>
        Array.from({ length: Math.ceil(g.items.length / 4) }, (_, n) => ({
          name: n === 0 ? g.name : "",
          items: g.items.slice(n * 4, n * 4 + 4),
        }))
      ),
    [result.data, group]
  );
  const parent = useRef<HTMLDivElement>(null),
    virtualizer = useVirtualizer({
      count: rows.length,
      getScrollElement: () => parent.current,
      estimateSize: () => 390,
      overscan: 2,
    });
  const fresh = result.data?.find(i => i.id === preview?.id) ?? preview;
  return (
    <section className="space-y-4" aria-label="单图">
      <LibrarySearch
        scope={scope}
        onScope={setScope}
        query={query}
        onQuery={setQuery}
        placeholder="搜索图片名称、ASIN、产品名"
      />
      <LibraryToolbar
        onTags={onTags}
        onImport={() => setUpload(true)}
        importLabel="图片导入"
      >
        <LibrarySelect
          label="单图分组"
          value={group}
          onChange={v => setGroup(v as Group)}
          options={[
            { value: "type", label: "按图片类型分组" },
            { value: "style", label: "按风格分组" },
            { value: "category", label: "按类目分组" },
            { value: "primaryColor", label: "按主色分组" },
            { value: "accentColor", label: "按提亮色分组" },
            { value: "belong", label: "按归属分组" },
            { value: "sellingPoint", label: "按卖点分组" },
            { value: "composition", label: "按构图分组" },
            { value: "none", label: "不分组" },
          ]}
        />
        <CommonTagFilters value={filters} onChange={setFilters} tags={tags} facets={facets.data} />
        <LibrarySelect
          label="图片类型筛选" counts={facets.data?.counts.type} total={facets.data?.totals.type}
          allLabel="全部图片类型"
          value={local.type}
          options={tags.imageTypeMainOptions}
          onChange={type => setLocal({ ...local, type, typeSub: "" })}
        />
        {local.type && (
          <LibrarySelect
            label="图片类型细分筛选" counts={facets.data?.counts.typeSub} total={facets.data?.totals.typeSub}
            allLabel="全部类型细分"
            value={local.typeSub}
            options={tags.imageTypeHierarchy[local.type] || []}
            onChange={typeSub => setLocal({ ...local, typeSub })}
          />
        )}
        <LibrarySelect
          label="卖点筛选" counts={facets.data?.counts.sellingPoint} total={facets.data?.totals.sellingPoint}
          allLabel="全部卖点"
          value={local.sellingPoint}
          options={tags.sellingPointMainOptions}
          onChange={sellingPoint =>
            setLocal({ ...local, sellingPoint, sellingPointDetail: "" })
          }
        />
        {local.sellingPoint && (
          <LibrarySelect
            label="卖点细分筛选" counts={facets.data?.counts.sellingPointDetail} total={facets.data?.totals.sellingPointDetail}
            allLabel="全部卖点细分"
            value={local.sellingPointDetail}
            options={tags.sellingPointHierarchy[local.sellingPoint] || []}
            onChange={sellingPointDetail =>
              setLocal({ ...local, sellingPointDetail })
            }
          />
        )}
        <LibrarySelect
          label="构图筛选" counts={facets.data?.counts.composition} total={facets.data?.totals.composition}
          allLabel="全部构图"
          value={local.composition}
          options={tags.compositionOptions}
          onChange={composition => setLocal({ ...local, composition })}
        />
        <LibrarySelect
          label="图片归属筛选" counts={facets.data?.counts.belong} total={facets.data?.totals.belong}
          allLabel="全部归属"
          value={local.belong}
          options={tags.imageBelongOptions.filter(b => b !== "品牌故事")}
          onChange={belong => setLocal({ ...local, belong, belongSub: "" })}
        />
        {local.belong && !!tags.imageBelongHierarchy[local.belong]?.length && (
          <LibrarySelect
            label="归属细分筛选" counts={facets.data?.counts.belongSub} total={facets.data?.totals.belongSub}
            allLabel="全部归属细分"
            value={local.belongSub}
            options={tags.imageBelongHierarchy[local.belong]}
            onChange={belongSub => setLocal({ ...local, belongSub })}
          />
        )}
      </LibraryToolbar>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {facets.data?.total ?? "…"} 张图片 · 每页 96 项
        </span>
        <LibraryPagination
          page={page}
          hasMore={facets.data ? facets.data.total > page*96 : (result.data?.length || 0) >= 96}
          busy={result.isFetching}
          onPage={setPage}
        />
      </div>
      {result.isLoading ? (
        <p className="py-12 text-center">正在读取图片…</p>
      ) : result.error ? (
        <p role="alert">
          图片暂时无法读取。
          <Button variant="link" onClick={() => result.refetch()}>
            重试
          </Button>
        </p>
      ) : !rows.length ? (
        <p className="rounded-xl border py-16 text-center text-muted-foreground">
          暂无符合条件的图片
        </p>
      ) : (
        <div ref={parent} className="h-[70vh] overflow-auto">
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: "relative",
              width: "100%",
            }}
          >
            {virtualizer.getVirtualItems().map(row => {
              const item = rows[row.index];
              return (
                <div
                  key={row.key}
                  data-index={row.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${row.start}px)`,
                  }}
                >
                  {item.name && (
                    <h2 className="mb-3 mt-4 text-lg font-semibold">
                      {item.name}（{facets.data?.groups[item.name] ?? "…"}）
                    </h2>
                  )}
                  <div className="grid grid-cols-2 gap-4 pb-4 lg:grid-cols-4">
                    {item.items.map(image => (
                      <article
                        key={image.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`放大图片 ${image.asin || image.productTitle || "独立上传"} ${imageBelongLabel(image)}`}
                        onClick={() => setPreview(image)}
                        onKeyDown={e =>
                          activateGalleryItem(e, () => setPreview(image))
                        }
                        className="group cursor-zoom-in overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <BrowseUnitThumbnail image={image} />
                        <div className="space-y-2 p-3">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="line-clamp-1">
                              {image.asin || image.productTitle || "独立上传"}
                            </span>
                            <span>
                              {image.imageSetId
                                ? imageBelongLabel(image)
                                : "独立上传"}
                            </span>
                          </div>
                          <CollectionTags
                            compact
                            category={image.tagCategory}
                            style={image.tagDesignStyleV2}
                            primaryColor={image.tagColorSchemeV2}
                            accentColor={image.tagAccentColor}
                          />
                          <div className="flex flex-wrap gap-1.5">
                            {distinctImageTags([
                              image.tagImageTypeMain,
                              image.tagSellingPointCategory,
                              image.tagComposition,
                            ]).map(t => (
                              <KnowledgeTag key={t}>{t}</KnowledgeTag>
                            ))}
                          </div>
                          {!image.imageSetId &&
                            image.labelStatus !== "complete" && (
                              <p className="text-xs text-muted-foreground">
                                {image.labelStatus === "failed"
                                  ? "标签待重试"
                                  : "AI 正在打标…"}
                              </p>
                            )}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <SingleImagePreviewDialog
        image={fresh}
        canEdit={Boolean(
          result.data?.find(i => i.id === preview?.id)?.canEditTags
        )}
        onClose={() => setPreview(null)}
        onOpenSet={id => {
          setPreview(null);
          navigate(`/knowledge/images/${id}`);
        }}
      />
      {upload && <StandaloneImageUpload onClose={() => setUpload(false)} />}
    </section>
  );
}
