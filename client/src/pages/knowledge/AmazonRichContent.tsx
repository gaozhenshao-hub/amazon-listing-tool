import { useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  AmazonImageLayoutSchema,
  type AmazonImageModule,
  type AmazonTextBlock,
} from "@shared/amazonImageLayout";
import {
  type RichContentPresentation,
  type RichTextFinding,
} from "@shared/richContentPresentation";
import { PreparedImage } from "@/components/PreparedImage";
import { Button } from "@/components/ui/button";
import { amazonContentText, amazonModuleCopy, isAmazonPageNavigation } from "@shared/amazonContentText";
import { richModuleTarget, type RichModuleTarget } from "@shared/richModuleSellingPoints";
import type { KnowledgeVideo } from "@shared/knowledgeVideos";
import KnowledgeVideoPlayer from "./KnowledgeVideoPlayer";

type Image = {
  id: number;
  imageUrl: string;
  sourceUrlHash?: string | null;
  contentHash?: string | null;
  imagePosition: string;
  imageTranslation?: unknown;
};
export type RichSelection = {
  module: AmazonImageModule;
  card?: AmazonImageModule["cards"][number];
  blocks: AmazonTextBlock[];
  pointTarget?: RichModuleTarget;
};
type RenderTags = (images: Image[], selection?: RichSelection) => ReactNode;
type Props = {
  layout?: unknown;
  images: Image[];
  videos?: KnowledgeVideo[];
  section: "aplus" | "brand_story";
  onSelect: (image: Image) => void;
  renderTags?: RenderTags;
  renderVideo?: (video: KnowledgeVideo) => ReactNode;
  renderOverlay?: (image: Image) => ReactNode;
  renderTagsForAllImages?: boolean;
  presentation?: RichContentPresentation | null;
};

function NativeText({
  block,
  findings,
}: {
  block: AmazonTextBlock;
  findings: Map<string, RichTextFinding>;
}) {
  if (isAmazonPageNavigation(block.text)) return null;
  const finding = findings.get(block.id),
    translated = finding?.source === block.text ? finding.translation : null;
  const original = (
    <>
      <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">
        {block.text}
      </span>
      {translated && (
        <small
          className="mt-1 block whitespace-pre-wrap text-[12px] font-normal leading-relaxed text-slate-500"
          lang="zh-CN"
        >
          {translated}
        </small>
      )}
    </>
  );
  if (block.kind === "heading")
    return (
      <p
        className={`my-3 font-semibold ${block.level === 1 || block.level === 2 ? "text-xl" : "text-base"}`}
      >
        {original}
      </p>
    );
  return (
    <div
      className={`my-2 text-sm leading-relaxed ${block.kind === "list_item" ? "ml-4 list-item list-disc" : ""}`}
    >
      {original}
    </div>
  );
}
function Module({
  module,
  images,
  videos,
  onSelect,
  renderTags,
  renderVideo,
  renderOverlay,
  renderTagsForAllImages,
  presentation,
}: {
  module: AmazonImageModule;
  images: Map<string, Image>;
  videos: KnowledgeVideo[];
} & Omit<Props, "layout" | "images" | "section" | "videos">) {
  const [slide, setSlide] = useState(0),
    [question, setQuestion] = useState(0),
    [hotspot, setHotspot] = useState(0),
    strip = useRef<HTMLDivElement>(null);
  const findings = useMemo(
    () => new Map((presentation?.texts || []).map(t => [t.id, t])),
    [presentation]
  );
  const current = Math.min(slide, Math.max(0, module.cards.length - 1)),
    activeCard = module.cards[current];
  const text = (blocks: AmazonTextBlock[] | undefined) => (
    <>
      {blocks?.map(b => (
        <NativeText key={b.id} block={b} findings={findings} />
      ))}
    </>
  );
  const legacyText = (value: string, heading = false) =>
    amazonModuleCopy(value) ? (
      <p
        className={
          heading
            ? "my-3 font-semibold"
            : "my-2 whitespace-pre-wrap text-sm leading-relaxed"
        }
      >
        {amazonModuleCopy(value)}
      </p>
    ) : null;
  const renderImage = (
    reference: { hash: string; alt: string },
    small = false
  ) => {
    const image = images.get(reference.hash);
    if (!image)
      return (
        <div
          key={reference.hash}
          className="flex min-h-24 items-center justify-center bg-muted text-xs text-muted-foreground"
        >
          缺失图片
        </div>
      );
    const translation =
      image.imageTranslation ||
      presentation?.images.find(i => i.sourceHash === reference.hash);
    return (
      <div key={reference.hash} className="relative min-w-0">
        <PreparedImage
          src={image.imageUrl}
          sourceHash={reference.hash}
          contentHash={image.contentHash}
          alt={reference.alt || "商品图片"}
          openLabel={
            reference.alt && !["A+ 内容", "品牌故事"].includes(reference.alt)
              ? reference.alt
              : "查看图片与标签"
          }
          translation={translation}
          onOpen={() => onSelect(image)}
          imageClassName={
            small ? "mx-auto block h-40 w-full" : "block h-auto w-full"
          }
        />
        {renderOverlay?.(image)}
      </div>
    );
  };
  const showVideos = (hashes: readonly string[] | undefined) => (
    <>
      {videos
        .filter(v => v.moduleId === module.id && hashes?.includes(v.hash))
        .map(v => (
          <div key={v.hash}>
            {renderVideo ? renderVideo(v) : <KnowledgeVideoPlayer video={v} />}
          </div>
        ))}
    </>
  );
  const renderCard = (
    card: AmazonImageModule["cards"][number],
    i: number,
    compact = false
  ) => (
    <div
      key={card.id || i}
      className={`min-w-0 ${compact ? "bg-white text-slate-950" : ""}`}
    >
      <div
        className={
          card.images.length === 4 && compact
            ? "grid grid-cols-2 gap-0"
            : "flex flex-col gap-0"
        }
      >
        {card.images.map(ref => renderImage(ref, module.kind === "comparison"))}
      </div>
      {showVideos(card.videoHashes)}
      {card.blocks?.some(b => !isAmazonPageNavigation(b.text)) || amazonModuleCopy(card.title) || amazonModuleCopy(card.text) ? (
        <div className="px-4 py-3 leading-relaxed">
          {card.blocks?.length ? (
            text(card.blocks)
          ) : (
            <>
              {legacyText(card.title, true)}
              {legacyText(card.text)}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
  let selectedBlocks = [...(module.blocks || [])],
    references = module.cards.flatMap(c => c.images);
  if (module.kind === "comparison")
    selectedBlocks.push(
      ...module.rows.flatMap(r => [
        { id: r.labelId || "", text: r.label, kind: "paragraph" as const },
        ...r.cells.map((t, i) => ({
          id: r.cellIds?.[i] || "",
          text: t,
          kind: "paragraph" as const,
        })),
      ])
    );
  if (module.kind === "carousel" || module.kind === "brand_story") {
    references = activeCard?.images || [];
    selectedBlocks.push(...(activeCard?.blocks || []));
  } else selectedBlocks.push(...module.cards.flatMap(c => c.blocks || []));
  if (module.kind === "faq") {
    const q =
      module.questions?.[
        Math.min(question, (module.questions?.length || 1) - 1)
      ];
    if (q) selectedBlocks.push(q.question, q.answer);
  }
  if (module.kind === "hotspots")
    selectedBlocks.push(...(module.hotspots?.[hotspot]?.blocks || []));
  selectedBlocks = selectedBlocks.filter(b => !isAmazonPageNavigation(b.text));
  const pointTarget = richModuleTarget(module, [...images.values()].map(i => ({sourceUrlHash:i.sourceUrlHash,contentHash:presentation?.images.find(t=>t.sourceHash===i.sourceUrlHash)?.contentHash || i.contentHash})), ["carousel","brand_story"].includes(module.kind) ? current : undefined);
  const visible = references
      .map(r => images.get(r.hash))
      .filter((i): i is Image => !!i),
    selected = renderTagsForAllImages ? visible : visible.slice(0, 1);
  const hasTags =
    renderTags &&
    (module.kind !== "video" ||
      selected.length > 0 ||
      selectedBlocks.length > 0);
  const withTags = (content: ReactNode) => (
    <div
      className={
        hasTags
          ? "grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_230px]"
          : "min-w-0"
      }
    >
      <div className={`min-w-0 ${hasTags && !references.length && !module.videoHashes?.length ? "lg:min-h-36" : ""}`}>{content}</div>
      {hasTags && renderTags && (
        <div className="relative min-w-0 self-stretch">
        <aside
          className="min-w-0 space-y-3 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed lg:absolute lg:inset-0 lg:overflow-y-auto lg:overscroll-contain"
          aria-label="当前模块标签"
        >
          {renderTags(selected, {
            module,
            card:
              module.kind === "carousel" || module.kind === "brand_story"
                ? activeCard
                : undefined,
            blocks: selectedBlocks,
            pointTarget,
          })}
        </aside>
        </div>
      )}
    </div>
  );
  const readableModuleBlocks = module.blocks?.filter(b=>!isAmazonPageNavigation(b.text)) || [];
  const moduleText = readableModuleBlocks.length || amazonModuleCopy(module.title) ? (
    <div className="px-4 py-2">
      {readableModuleBlocks.length
        ? text(readableModuleBlocks)
        : module.title
          ? legacyText(module.title, true)
          : null}
    </div>
  ) : null;
  if (module.kind === "brand_story") {
    const background = module.background && images.get(module.background.hash);
    const choose = (next: number) => {
      const n = (next + module.cards.length) % module.cards.length;
      setSlide(n);
      strip.current?.scrollTo({ left: (n + 1) * 356, behavior: "smooth" });
    };
    return withTags(
      <section
        className="relative overflow-hidden bg-slate-900 py-8"
        aria-label="品牌故事组合卡片"
      >
        {background && (
          <img
            src={background.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          />
        )}
        {module.background && !background && (
          <p className="relative mx-6 mb-4 rounded bg-white p-4 text-sm">
            缺失图片（品牌故事背景）
          </p>
        )}
        {background && (
          <Button
            className="relative z-10 mb-4 ml-6"
            variant="secondary"
            size="sm"
            onClick={() => onSelect(background)}
          >
            查看品牌故事背景图
          </Button>
        )}
        {module.title && (
          <h3 className="relative mb-5 px-6 text-xl font-semibold text-white">
            {module.title}
          </h3>
        )}
        <div
          ref={strip}
          className="relative flex snap-x snap-mandatory items-start gap-4 overflow-x-auto px-6 pb-3"
          onScroll={e => {
            const x = e.currentTarget.scrollLeft;
            setSlide(
              Math.min(
                module.cards.length - 1,
                Math.max(0, Math.floor((x - 340) / 356))
              )
            );
          }}
        >
          <div
            aria-hidden="true"
            data-testid="brand-story-leading-space"
            className="w-[340px] max-w-[85vw] shrink-0 snap-start self-stretch"
          />
          {module.cards.map((card, i) => (
            <div
              key={card.id || i}
              tabIndex={0}
              onClick={() => setSlide(i)}
              onFocus={() => setSlide(i)}
              aria-current={current === i ? "true" : undefined}
              className={`w-[340px] max-w-[85vw] shrink-0 snap-start rounded-sm ${current === i ? "ring-2 ring-white/80" : ""}`}
              aria-label={
                card.images.length === 4 ? "品牌故事四图组合" : "品牌故事卡片"
              }
            >
              {renderCard(card, i, true)}
            </div>
          ))}
        </div>
        {module.cards.length > 1 && (
          <div className="relative flex justify-end gap-2 px-6 pt-2">
            <Button
              size="icon"
              variant="secondary"
              aria-label="上一组品牌故事"
              onClick={() => choose(current - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              size="icon"
              variant="secondary"
              aria-label="下一组品牌故事"
              onClick={() => choose(current + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        )}
      </section>
    );
  }
  if (module.kind === "carousel")
    return withTags(
      <section aria-label="A+ 图片轮播" className="min-w-0">
        {moduleText}
        <div className="relative">
          {activeCard && renderCard(activeCard, current)}
          {module.cards.length > 1 && (
            <div className="pointer-events-none absolute inset-x-3 top-1/2 flex justify-between">
              <Button
                className="pointer-events-auto"
                size="icon"
                variant="secondary"
                aria-label="上一张"
                onClick={() =>
                  setSlide(
                    (current - 1 + module.cards.length) % module.cards.length
                  )
                }
              >
                <ChevronLeft />
              </Button>
              <Button
                className="pointer-events-auto"
                size="icon"
                variant="secondary"
                aria-label="下一张"
                onClick={() => setSlide((current + 1) % module.cards.length)}
              >
                <ChevronRight />
              </Button>
            </div>
          )}
        </div>
        <div className="flex flex-wrap justify-center gap-2 px-3 py-3">
          {module.cards.map((card, i) => (
            <button
              key={card.id || i}
              type="button"
              aria-label={`轮播第 ${i + 1} 张`}
              aria-current={current === i}
              onClick={() => setSlide(i)}
              className={
                card.navText || module.sourceType === "PREMIUM_REGIMEN_CAROUSEL"
                  ? `rounded border px-3 py-2 text-xs ${current === i ? "border-primary bg-primary/10" : "bg-white"}`
                  : `h-2 w-2 rounded-full ${current === i ? "bg-primary" : "bg-gray-300"}`
              }
            >
              {card.navText ||
                (module.sourceType === "PREMIUM_REGIMEN_CAROUSEL"
                  ? `步骤 ${i + 1}`
                  : null)}
            </button>
          ))}
        </div>
      </section>
    );
  if (module.kind === "comparison" || module.kind === "specifications") {
    const value = (source: string, id?: string) =>
      id ? (
        <NativeText
          block={{ id, text: amazonContentText(source), kind: "paragraph" }}
          findings={findings}
        />
      ) : (
        amazonContentText(source)
      );
    return withTags(
      <section
        className="min-w-0 overflow-x-auto"
        aria-label={
          module.kind === "comparison" ? "A+ 产品对比" : "A+ 技术参数"
        }
      >
        {moduleText}
        <table className="w-full border-collapse text-sm">
          {module.cards.length > 0 && (
            <thead>
              <tr>
                {module.rows.length > 0 && <th className="min-w-28" />}
                {module.cards.map((card, i) => (
                  <th
                    key={card.id || i}
                    className="min-w-40 align-top font-normal"
                  >
                    {renderCard(card, i, true)}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {module.rows.map((row, i) => (
              <tr key={row.labelId || i} className="border-t even:bg-slate-50">
                <th className="min-w-28 px-3 py-2 text-left align-top font-medium">
                  {value(row.label, row.labelId)}
                </th>
                {row.cells.map((cell, j) => (
                  <td key={j} className="min-w-28 px-3 py-2 align-top">
                    {value(cell, row.cellIds?.[j]) || "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }
  if (module.kind === "faq")
    return withTags(
      <section aria-label="A+ 常见问答">
        {moduleText}
        {module.cards.map((c, i) => renderCard(c, i))}
        {(module.questions || []).map((q, i) => (
          <div key={q.question.id} className="border-b px-4 py-2">
            <button
              type="button"
              className="w-full text-left"
              aria-expanded={question === i}
              onClick={() => setQuestion(i)}
            >
              {text([q.question])}
            </button>
            {question === i && <div className="pl-4">{text([q.answer])}</div>}
          </div>
        ))}
      </section>
    );
  if (module.kind === "hotspots") {
    const points = module.hotspots || [],
      active = points[hotspot];
    return withTags(
      <section aria-label="A+ 图片热点">
        {moduleText}
        <div className="relative">
          {module.cards.map((c, i) => renderCard(c, i))}
          {points.map((p, i) =>
            p.x !== undefined && p.y !== undefined ? (
              <button
                key={p.id}
                type="button"
                aria-label={`热点 ${i + 1}`}
                aria-pressed={hotspot === i}
                onClick={() => setHotspot(i)}
                className={`absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-xs shadow ${hotspot === i ? "bg-orange-700 text-white" : "bg-white text-slate-900"}`}
                style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
              >
                {i + 1}
              </button>
            ) : null
          )}
        </div>
        <div className="flex flex-wrap gap-2 p-3">
          {points.map((p, i) => (
            <Button
              key={p.id}
              size="sm"
              variant={hotspot === i ? "default" : "outline"}
              onClick={() => setHotspot(i)}
            >
              热点 {i + 1}
            </Button>
          ))}
        </div>
        {active && (
          <div className="border-t px-4 py-2">{text(active.blocks)}</div>
        )}
      </section>
    );
  }
  if (module.kind === "video")
    return withTags(
      <section aria-label="A+ 视频模块" className="min-w-0">
        {moduleText}
        <div
          className={
            module.sourceType === "PREMIUM_VIDEO_TEXT"
              ? "grid items-start gap-4 md:grid-cols-2"
              : ""
          }
        >
          <div
            className={
              module.variant?.imagePosition === "right" ? "md:order-2" : ""
            }
          >
            {showVideos(module.videoHashes)}
          </div>
          <div>{module.cards.map((c, i) => renderCard(c, i))}</div>
        </div>
      </section>
    );
  if (
    ["STANDARD_IMAGE_TEXT_OVERLAY", "PREMIUM_FULL_BACKGROUND_TEXT"].includes(
      module.sourceType || ""
    ) &&
    module.cards.length
  ) {
    const dark = module.variant?.theme === "dark",
      blocks = [
        ...(module.blocks || []),
        ...module.cards.flatMap(c => c.blocks || []),
      ];
    return withTags(
      <section
        aria-label="A+ 图文叠加"
        className="relative isolate overflow-hidden"
      >
        {module.cards.flatMap(c => c.images).map(ref => renderImage(ref))}
        <div
          className={`relative max-h-full overflow-y-auto p-5 md:absolute md:inset-y-0 md:flex md:w-[46%] md:flex-col md:justify-center ${module.variant?.imagePosition === "right" ? "md:right-0" : "md:left-0"} ${dark ? "bg-slate-950/85 text-white [&_small]:text-slate-200" : "bg-white/90 text-slate-950"}`}
        >
          {text(blocks)}
        </div>
      </section>
    );
  }
  const columns = module.variant?.quadrant
    ? 2
    : module.variant?.columns || Math.min(4, module.cards.length);
  const sideBySide =
    module.kind === "image" &&
    module.cards.length === 1 &&
    [
      "STANDARD_SINGLE_SIDE_IMAGE",
      "PREMIUM_IMAGE_TEXT",
      "STANDARD_SINGLE_IMAGE_HIGHLIGHTS",
      "STANDARD_SINGLE_IMAGE_SPECS_DETAIL",
    ].includes(module.sourceType || "");
  if (sideBySide) {
    const card = module.cards[0];
    return withTags(
      <section aria-label={`A+ ${module.subtype || "图文模块"}`}>
        {moduleText}
        <div className="grid items-start gap-4 md:grid-cols-2">
          <div
            className={
              module.variant?.imagePosition === "right" ? "md:order-2" : ""
            }
          >
            {card.images.map(ref => renderImage(ref))}
          </div>
          <div className="px-4 py-2">
            {card.blocks?.length ? (
              text(card.blocks)
            ) : (
              <>
                {legacyText(card.title, true)}
                {legacyText(card.text)}
              </>
            )}
          </div>
        </div>
      </section>
    );
  }
  return withTags(
    <section
      aria-label={`A+ ${module.subtype || "图文模块"}`}
      className="min-w-0"
    >
      {module.warnings?.length ? (
        <p className="px-4 py-2 text-xs text-amber-800">
          {module.warnings.join("；")}
        </p>
      ) : null}
      {moduleText}
      {showVideos(
        module.videoHashes?.filter(
          hash => !module.cards.some(card => card.videoHashes?.includes(hash))
        )
      )}
      <div
        className={
          module.kind === "grid" ? "grid gap-0" : "flex flex-col gap-0"
        }
        style={
          module.kind === "grid"
            ? {
                gridTemplateColumns:
                  module.sourceType === "STANDARD_IMAGE_SIDEBAR" &&
                  columns === 2
                    ? "minmax(0,2fr) minmax(0,1fr)"
                    : `repeat(${Math.max(1, columns)}, minmax(0,1fr))`,
              }
            : undefined
        }
      >
        {module.cards.map((card, i) =>
          renderCard(card, i, module.kind === "grid")
        )}
      </div>
    </section>
  );
}
export default function AmazonRichContent({
  layout,
  images,
  videos = [],
  section,
  onSelect,
  renderTags,
  renderVideo,
  renderOverlay,
  renderTagsForAllImages,
  presentation,
}: Props) {
  const parsed = useMemo(
      () => AmazonImageLayoutSchema.safeParse(layout),
      [layout]
    ),
    modules = parsed.success
      ? parsed.data.modules.filter(m => m.section === section)
      : [];
  const byHash = new Map(
    images.filter(i => i.sourceUrlHash).map(i => [i.sourceUrlHash!, i])
  );
  const used = new Set(
    modules.flatMap(m => [
      ...(m.background ? [m.background.hash] : []),
      ...m.cards.flatMap(c => c.images.map(i => i.hash)),
    ])
  );
  const remaining = images.filter(
    i => !i.sourceUrlHash || !used.has(i.sourceUrlHash)
  );
  return (
    <div className="min-w-0 overflow-hidden bg-white leading-normal">
      {modules.map(module => (
        <Module
          key={module.id}
          module={module}
          images={byHash}
          videos={videos}
          onSelect={onSelect}
          renderTags={renderTags}
          renderVideo={renderVideo}
          renderOverlay={renderOverlay}
          renderTagsForAllImages={renderTagsForAllImages}
          presentation={presentation}
        />
      ))}
      {remaining.map(image => {
        const hash = image.sourceUrlHash || `fallback-${image.id}`,
          module: AmazonImageModule = {
            id: `legacy-${image.id}`,
            section,
            kind: "image",
            background: null,
            title: "",
            cards: [
              {
                images: [
                  { hash, alt: section === "aplus" ? "A+ 内容" : "品牌故事" },
                ],
                title: "",
                text: "",
              },
            ],
            rows: [],
          };
        return (
          <Module
            key={image.id}
            module={module}
            images={new Map([[hash, image]])}
            videos={[]}
            onSelect={onSelect}
            renderTags={renderTags}
            renderOverlay={renderOverlay}
            presentation={presentation}
          />
        );
      })}
    </div>
  );
}
