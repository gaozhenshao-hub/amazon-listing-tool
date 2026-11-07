import { useState } from "react";
import { X, Check, Lightbulb, Image as ImageIcon, Layers } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useKBTagOptions } from "@/hooks/useKBTagOptions";
import { toast } from "sonner";
import {
  type PlanningImageReference,
  planningReferenceKey,
  planningImageRoleLabel,
} from "@shared/planningImageReference";
import {
  CommonTagFilters,
  EMPTY_COMMON_FILTERS,
  LibrarySelect,
  groupLibraryItems,
} from "../knowledge/LibraryToolbar";
import { CollectionTags } from "../knowledge/KnowledgeTag";
import {
  groupImageSets,
  type AsinSetGroupBy,
} from "../knowledge/kbImageSetGrouping";
import { AmazonStyleGallery } from "../knowledge/AmazonStyleGallery";
type Library = "knowledge" | "reference" | "competitor";
type Picture = {
  ref: PlanningImageReference;
  url: string;
  title: string;
  group?: string;
  liked?: boolean;
};
type Tab = { key: string; title: string; setId?: number; picture?: Picture };
type Props = {
  mode: "sets" | "images";
  projectId?: number;
  referenceSetIds?: number[];
  selectedSetIds?: number[];
  selectedImages?: PlanningImageReference[];
  maxSelections?: number;
  onClose: () => void;
  onConfirm: (selection: {
    setIds: number[];
    images: PlanningImageReference[];
  }) => void;
};
function SelectionBox({
  checked,
  label,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <label
      className="inline-flex cursor-pointer items-center gap-2 rounded-lg border bg-background/95 p-2 text-xs shadow-sm"
      onClick={e => e.stopPropagation()}
    >
      <input
        aria-label={label}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="h-4 w-4 accent-primary"
      />
      <span>{checked ? "已选中" : "选择"}</span>
    </label>
  );
}
function SetDetail({
  id,
  mode,
  library,
  selected,
  setSelected,
  selectedImages,
  toggleImage,
  openPicture,
}: {
  id: number;
  mode: Props["mode"];
  library: Library;
  selected: boolean;
  setSelected: () => void;
  selectedImages: PlanningImageReference[];
  toggleImage: (p: Picture) => void;
  openPicture: (p: Picture) => void;
}) {
  const query = trpc.kbImages.getSet.useQuery({ id }, { staleTime: 60000 }),
    [original, setOriginal] = useState(mode === "sets"),
    [focused, setFocused] = useState<number | null>(null);
  if (query.isLoading) return <p className="p-10 text-center">正在读取套图…</p>;
  if (query.error || !query.data)
    return (
      <p role="alert" className="p-8">
        套图暂时无法读取。
        <Button variant="link" onClick={() => void query.refetch()}>
          重试
        </Button>
      </p>
    );
  const set = query.data,
    images = set.images,
    role = (name: string) =>
      images.filter(i => i.imagePosition === name) as any;
  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-start gap-4 rounded-xl border bg-muted/20 p-4">
        {mode === "sets" && (
          <SelectionBox
            label={`选择套图${set.asin}`}
            checked={selected}
            onChange={setSelected}
          />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">
            {set.asin} · {set.productTitle}
          </h3>
          <div className="mt-2">
            <CollectionTags
              category={set.setCategory}
              style={set.setStyle}
              primaryColor={set.setPrimaryColor}
              accentColor={set.setAccentColor}
            />
          </div>
        </div>
        {mode === "images" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOriginal(v => !v)}
          >
            {original ? "逐图选择" : "查看原始排版"}
          </Button>
        )}
      </header>
      {original ? (
        <AmazonStyleGallery
          mainImages={role("main")}
          secondaryImages={role("secondary")}
          aplusImages={role("aplus")}
          brandStoryImages={role("brand_story")}
          sourceLayout={set.sourceLayout}
          presentation={set.contentPresentation}
          selectedImageId={focused}
          onSelectImage={setFocused}
          allowEdit={false}
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {images.map((image, index) => {
            const ref: PlanningImageReference =
                library === "reference"
                  ? {
                      source: "reference",
                      setId: id,
                      imageId: image.id,
                      label: `${set.asin} · 图片${index + 1}`,
                    }
                  : {
                      source: "knowledge",
                      setId: id,
                      imageId: image.id,
                      label: `${set.asin} · 图片${index + 1}`,
                    },
              picture = { ref, url: image.imageUrl, title: ref.label },
              chosen = selectedImages.some(
                r => planningReferenceKey(r) === planningReferenceKey(ref)
              );
            return (
              <article
                key={image.id}
                className={
                  "relative overflow-hidden rounded-xl border bg-background " +
                  (chosen ? "ring-2 ring-primary" : "")
                }
              >
                <div className="absolute left-2 top-2 z-10">
                  <SelectionBox
                    label={`选择图片${set.asin}-${index + 1}`}
                    checked={chosen}
                    onChange={() => toggleImage(picture)}
                  />
                </div>
                <button
                  className="block w-full p-3 pt-12 text-left"
                  onClick={() => openPicture(picture)}
                >
                  <img
                    loading="lazy"
                    src={image.imageUrl}
                    alt={picture.title}
                    className="h-44 w-full object-contain"
                  />
                  <p className="mt-3 text-xs text-muted-foreground">
                    {picture.title}
                  </p>
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
export default function PlanningAssetPicker({
  mode,
  projectId,
  referenceSetIds = [],
  selectedSetIds = [],
  selectedImages = [],
  maxSelections = mode === "sets" ? 5 : 20,
  onClose,
  onConfirm,
}: Props) {
  const tags = useKBTagOptions(),
    [library, setLibrary] = useState<Library>("knowledge"),
    [view, setView] = useState<"sets" | "images">("sets"),
    [query, setQuery] = useState(""),
    [filters, setFilters] = useState(EMPTY_COMMON_FILTERS),
    [groupBy, setGroupBy] = useState("style"),
    [page, setPage] = useState(1),
    [chosenSets, setChosenSets] = useState(selectedSetIds),
    [chosenImages, setChosenImages] = useState(selectedImages),
    [tabs, setTabs] = useState<Tab[]>([]),
    [active, setActive] = useState("browse");
  const sets = trpc.kbImages.listSets.useQuery(
    { scope: "all", includeThumbnails: false },
    { enabled: library !== "competitor", staleTime: 60000 }
  );
  const filtered = (sets.data || []).filter(
    s =>
      s.status === "confirmed" &&
      (library !== "reference" || referenceSetIds.includes(s.id)) &&
      (!query ||
        [s.asin, s.productTitle, s.brand, s.setCategory, s.setStyle]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!filters.category || s.setCategory === filters.category) &&
      (!filters.style || s.setStyle === filters.style) &&
      (!filters.primaryColor || s.setPrimaryColor === filters.primaryColor) &&
      (!filters.accentColor ||
        s.setAccentColor ===
          (filters.accentColor === "__none" ? "" : filters.accentColor))
  );
  const sorted = groupImageSets(
      filtered,
      (groupBy === "asin" ? "none" : groupBy) as AsinSetGroupBy
    ).flatMap(g => g.items),
    pageSets = sorted.slice((page - 1) * 24, page * 24);
  const thumbs = trpc.kbImages.setThumbnails.useQuery(
    { ids: pageSets.map(s => s.id), scope: "all" },
    {
      enabled:
        active === "browse" &&
        library !== "competitor" &&
        pageSets.length > 0 &&
        (mode === "sets" || view === "sets" || library === "reference"),
      staleTime: 120000,
    }
  );
  const singles = trpc.kbImages.listAllImages.useQuery(
    {
      scope: "all",
      page,
      query: query || undefined,
      groupBy: [
        "style",
        "category",
        "primaryColor",
        "accentColor",
        "none",
      ].includes(groupBy)
        ? (groupBy as
            | "style"
            | "category"
            | "primaryColor"
            | "accentColor"
            | "none")
        : "none",
      tagCategory: filters.category || undefined,
      tagDesignStyleV2: filters.style || undefined,
      tagColorSchemeV2: filters.primaryColor || undefined,
      tagAccentColor: filters.accentColor || undefined,
    },
    {
      enabled:
        mode === "images" &&
        library === "knowledge" &&
        view === "images" &&
        active === "browse",
      staleTime: 30000,
    }
  );
  const competitors = trpc.imagePlanning.competitorImages.useQuery(
    { projectId: projectId || 0 },
    {
      enabled: mode === "images" && library === "competitor" && !!projectId,
      staleTime: 30000,
    }
  );
  function changeLibrary(next: Library) {
    setLibrary(next);
    setActive("browse");
    setQuery("");
    setFilters(EMPTY_COMMON_FILTERS);
    setPage(1);
    setGroupBy(next === "competitor" ? "none" : "style");
  }
  function toggleSet(id: number) {
    setChosenSets(current => {
      if (current.includes(id)) return current.filter(n => n !== id);
      if (current.length >= maxSelections) {
        toast.info(`最多选择${maxSelections}套参考图`);
        return current;
      }
      return [...current, id];
    });
  }
  function toggleImage(picture: Picture) {
    const key = planningReferenceKey(picture.ref);
    setChosenImages(current => {
      if (current.some(r => planningReferenceKey(r) === key))
        return current.filter(r => planningReferenceKey(r) !== key);
      if (current.length >= maxSelections) {
        toast.info(`本处最多选择${maxSelections}张参考图`);
        return current;
      }
      return [...current, picture.ref];
    });
  }
  function openSet(id: number, title: string) {
    const key = `${library}:set:${id}`;
    setTabs(current =>
      current.some(t => t.key === key)
        ? current
        : [...current, { key, title, setId: id }]
    );
    setActive(key);
  }
  function openPicture(picture: Picture) {
    const key = "picture:" + planningReferenceKey(picture.ref);
    setTabs(current =>
      current.some(t => t.key === key)
        ? current
        : [...current, { key, title: picture.title, picture }]
    );
    setActive(key);
  }
  const current = tabs.find(t => t.key === active),
    count = mode === "sets" ? chosenSets.length : chosenImages.length;
  const imageMap = new Map<number, any>();
  for (const image of singles.data || [])
    for (const member of [image, ...image.moduleImages])
      if (!imageMap.has(member.id))
        imageMap.set(member.id, { ...image, ...member });
  const pictures: Picture[] =
    library === "competitor"
      ? (competitors.data || [])
          .filter(
            i =>
              !query ||
              [i.asin, i.title, planningImageRoleLabel(i.role)]
                .join(" ")
                .toLowerCase()
                .includes(query.toLowerCase())
          )
          .map(i => ({
            ref: {
              source: "competitor",
              analysisId: i.analysisId,
              hash: i.hash,
              label: `${i.asin} · ${planningImageRoleLabel(i.role)}${i.ordinal || ""}`,
            },
            url: i.imageUrl,
            title:
              i.asin +
              " · " +
              planningImageRoleLabel(i.role) +
              (i.ordinal || ""),
            group: i.asin,
            liked: i.liked,
          }))
      : [...imageMap.values()].map(i => ({
          ref: {
            source: "knowledge",
            imageId: i.id,
            ...(i.imageSetId ? { setId: i.imageSetId } : {}),
            label: i.asin || i.originalFilename || "知识库图片",
          },
          url: i.imageUrl,
          title: i.asin || i.originalFilename || "知识库图片",
          group:
            groupBy === "style"
              ? i.tagDesignStyleV2
              : groupBy === "category"
                ? i.tagCategory
                : groupBy === "primaryColor"
                  ? i.tagColorSchemeV2
                  : groupBy === "accentColor"
                    ? i.tagAccentColor
                    : "全部图片",
        }));
  const pictureGroups =
    library === "competitor" && groupBy === "none"
      ? [{ name: "亮灯图片优先", items: pictures }]
      : groupLibraryItems(
          pictures,
          p => p.group || "未分类",
          groupBy === "none"
        );
  const browseSets =
    mode === "sets" ||
    library === "reference" ||
    (library === "knowledge" && view === "sets");
  const pictureGrid = (
    <div className="space-y-5">
      {pictureGroups.map(group => (
        <section key={group.name}>
          <h3 className="mb-3 text-sm font-semibold">{group.name}</h3>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {group.items.map(picture => {
              const key = planningReferenceKey(picture.ref),
                chosen = chosenImages.some(
                  r => planningReferenceKey(r) === key
                );
              return (
                <article
                  key={key}
                  className={
                    "relative overflow-hidden rounded-xl border " +
                    (chosen ? "ring-2 ring-primary" : "")
                  }
                >
                  <div className="absolute left-2 top-2 z-10">
                    <SelectionBox
                      label={`选择${picture.title}`}
                      checked={chosen}
                      onChange={() => toggleImage(picture)}
                    />
                  </div>
                  {picture.liked && (
                    <span
                      className="absolute right-2 top-3 rounded-full bg-yellow-100 p-1.5 text-yellow-700"
                      title="已亮灯收藏"
                    >
                      <Lightbulb className="h-4 w-4" />
                    </span>
                  )}
                  <button
                    className="block w-full p-3 pt-12 text-left"
                    onClick={() => openPicture(picture)}
                  >
                    <img
                      loading="lazy"
                      src={picture.url}
                      alt={picture.title}
                      className="h-40 w-full object-contain"
                    />
                    <p className="mt-3 truncate text-xs">{picture.title}</p>
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="flex h-[92vh] w-[96vw] max-w-[1600px] flex-col gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <header className="space-y-4 border-b p-5 pr-12">
          <DialogTitle>
            {mode === "sets" ? "选择知识库ASIN集" : "选择参考图片"}
          </DialogTitle>
          {mode === "images" && (
            <nav className="flex flex-wrap gap-2" aria-label="参考图片来源">
              {(
                [
                  ["knowledge", "知识库"],
                  ["reference", "参考图库"],
                  ["competitor", "竞品库"],
                ] as const
              ).map(([key, label]) => (
                <Button
                  key={key}
                  size="sm"
                  variant={library === key ? "default" : "outline"}
                  onClick={() => changeLibrary(key)}
                >
                  {label}
                </Button>
              ))}
            </nav>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium">筛选</span>
            {library !== "competitor" && (
              <CommonTagFilters
                value={filters}
                onChange={value => {
                  setFilters(value);
                  setPage(1);
                }}
                tags={tags}
              />
            )}
            <LibrarySelect
              label="参考资料分组"
              value={groupBy}
              onChange={value => {
                setGroupBy(value);
                setPage(1);
              }}
              options={
                library === "competitor"
                  ? [
                      { value: "asin", label: "按竞品ASIN分组" },
                      { value: "none", label: "不分组 · 亮灯优先" },
                    ]
                  : [
                      { value: "style", label: "按风格分组" },
                      { value: "category", label: "按类目分组" },
                      { value: "primaryColor", label: "按主色分组" },
                      { value: "accentColor", label: "按提亮色分组" },
                      { value: "none", label: "不分组" },
                    ]
              }
            />
            <Input
              aria-label="搜索参考资料"
              placeholder={
                library === "competitor"
                  ? "搜索竞品ASIN、图片归属"
                  : "搜索ASIN、商品名、品牌或标签"
              }
              value={query}
              onChange={e => {
                setQuery(e.target.value);
                setPage(1);
              }}
              className="max-w-xs"
            />
          </div>
          <nav
            className="flex items-center gap-2 overflow-x-auto pb-1"
            aria-label="选图对话框标签页"
          >
            <Button
              size="sm"
              variant={active === "browse" ? "secondary" : "ghost"}
              onClick={() => setActive("browse")}
            >
              资料列表
            </Button>
            {tabs.map(tab => (
              <div
                key={tab.key}
                className="flex shrink-0 items-center rounded-md border"
              >
                <button
                  className={
                    "max-w-48 truncate px-3 py-2 text-xs " +
                    (active === tab.key ? "bg-primary/10 text-primary" : "")
                  }
                  onClick={() => setActive(tab.key)}
                >
                  {tab.title}
                </button>
                <button
                  aria-label={`关闭预览${tab.title}`}
                  className="p-1.5 text-muted-foreground"
                  onClick={() => {
                    setTabs(tabs.filter(t => t.key !== tab.key));
                    if (active === tab.key) setActive("browse");
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </nav>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {active !== "browse" && current?.setId ? (
            <SetDetail
              key={current.key}
              id={current.setId}
              mode={mode}
              library={
                current.key.startsWith("reference:") ? "reference" : "knowledge"
              }
              selected={chosenSets.includes(current.setId)}
              setSelected={() => toggleSet(current.setId!)}
              selectedImages={chosenImages}
              toggleImage={toggleImage}
              openPicture={openPicture}
            />
          ) : active !== "browse" && current?.picture ? (
            <div className="space-y-4">
              <SelectionBox
                label={`选择当前图片${current.picture.title}`}
                checked={chosenImages.some(
                  r =>
                    planningReferenceKey(r) ===
                    planningReferenceKey(current.picture!.ref)
                )}
                onChange={() => toggleImage(current.picture!)}
              />
              <h3 className="text-sm font-medium">{current.picture.title}</h3>
              <img
                src={current.picture.url}
                alt={current.picture.title}
                className="mx-auto max-h-[58vh] max-w-full object-contain"
              />
            </div>
          ) : (
            <>
              {mode === "images" && library === "knowledge" && (
                <div className="mb-4 flex gap-2">
                  <Button
                    size="sm"
                    variant={view === "sets" ? "secondary" : "outline"}
                    onClick={() => {
                      setView("sets");
                      setPage(1);
                    }}
                  >
                    <Layers className="mr-1 h-4 w-4" />
                    按ASIN集浏览
                  </Button>
                  <Button
                    size="sm"
                    variant={view === "images" ? "secondary" : "outline"}
                    onClick={() => {
                      setView("images");
                      setPage(1);
                    }}
                  >
                    <ImageIcon className="mr-1 h-4 w-4" />
                    全部单图
                  </Button>
                </div>
              )}
              {(
                browseSets
                  ? sets.isLoading
                  : library === "competitor"
                    ? competitors.isLoading
                    : singles.isLoading
              ) ? (
                <p className="py-12 text-center text-muted-foreground">
                  正在读取参考资料…
                </p>
              ) : (
                  browseSets
                    ? sets.error
                    : library === "competitor"
                      ? competitors.error
                      : singles.error
                ) ? (
                <p role="alert" className="py-8">
                  参考资料暂时无法读取，请关闭后重试。
                </p>
              ) : browseSets ? (
                <div className="space-y-5">
                  {groupImageSets(
                    pageSets,
                    (groupBy === "asin" ? "none" : groupBy) as AsinSetGroupBy
                  ).map(group => (
                    <section key={group.key}>
                      <h3 className="mb-3 text-sm font-semibold">
                        {group.key === "all" ? "全部ASIN集" : group.key}
                      </h3>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {group.items.map(set => {
                          const selected = chosenSets.includes(set.id),
                            images =
                              thumbs.data?.find(t => t.id === set.id)
                                ?.thumbnailImages || [];
                          return (
                            <article
                              key={set.id}
                              className={
                                "relative rounded-xl border bg-background p-3 " +
                                (mode === "sets" && selected
                                  ? "ring-2 ring-primary"
                                  : "")
                              }
                            >
                              {mode === "sets" && (
                                <div className="absolute left-3 top-3 z-10">
                                  <SelectionBox
                                    label={`选择套图${set.asin}`}
                                    checked={selected}
                                    onChange={() => toggleSet(set.id)}
                                  />
                                </div>
                              )}
                              <button
                                className={
                                  "block w-full text-left " +
                                  (mode === "sets" ? "pt-10" : "")
                                }
                                onClick={() => openSet(set.id, set.asin)}
                              >
                                <div className="grid h-36 grid-cols-3 gap-1 overflow-hidden rounded-lg bg-muted/20">
                                  {images.slice(0, 6).map(i => (
                                    <img
                                      key={i.id}
                                      src={i.imageUrl}
                                      alt={set.asin}
                                      loading="lazy"
                                      className="h-[70px] w-full object-contain"
                                    />
                                  ))}
                                </div>
                                <p className="mt-3 font-semibold">{set.asin}</p>
                                <p className="my-2 line-clamp-2 text-xs text-muted-foreground">
                                  {set.productTitle}
                                </p>
                              </button>
                              <CollectionTags
                                compact
                                category={set.setCategory}
                                style={set.setStyle}
                                primaryColor={set.setPrimaryColor}
                                accentColor={set.setAccentColor}
                              />
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                  {!pageSets.length && (
                    <p className="py-12 text-center text-muted-foreground">
                      {library === "reference"
                        ? "先在找参考图步骤选取参考套图。"
                        : "暂无符合条件的ASIN集。"}
                    </p>
                  )}
                </div>
              ) : pictures.length ? (
                pictureGrid
              ) : (
                <p className="py-12 text-center text-muted-foreground">
                  暂无符合条件的图片。
                </p>
              )}
              <div className="mt-5 flex items-center justify-end gap-3 text-xs">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                >
                  上一页
                </Button>
                <span>第{page}页</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    browseSets
                      ? page * 24 >= sorted.length
                      : library === "competitor" ||
                        (singles.data?.length || 0) < 96
                  }
                  onClick={() => setPage(p => p + 1)}
                >
                  下一页
                </Button>
              </div>
            </>
          )}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t bg-background p-4">
          <p className="text-sm">
            <Check className="mr-1 inline h-4 w-4 text-primary" />
            已选择 <strong className="text-primary">{count}</strong>{" "}
            {mode === "sets" ? "套图" : "张图片"}
            <small className="ml-2 text-muted-foreground">
              最多{maxSelections}
              {mode === "sets" ? "套" : "张"}
            </small>
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button
              onClick={() =>
                onConfirm({ setIds: chosenSets, images: chosenImages })
              }
            >
              确认
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
