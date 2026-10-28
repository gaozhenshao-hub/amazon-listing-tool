import { useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AmazonImageLayoutSchema, type AmazonImageModule } from "@shared/amazonImageLayout";
import { KnowledgeImagePreview } from "@/components/KnowledgeImagePreview";
import { Button } from "@/components/ui/button";
import { amazonContentText } from "@shared/amazonContentText";
import type { KnowledgeVideo } from "@shared/knowledgeVideos";
import KnowledgeVideoPlayer from "./KnowledgeVideoPlayer";

type Image = { id: number; imageUrl: string; sourceUrlHash?: string | null; imagePosition: string };
type RenderTags = (images: Image[]) => ReactNode;
type RenderVideo = (video: KnowledgeVideo) => ReactNode;
function Module({ module, images, videos, onSelect, renderTags, renderVideo }: { module: AmazonImageModule; images: Map<string, Image>; videos: KnowledgeVideo[]; onSelect: (image: Image) => void; renderTags?: RenderTags; renderVideo?: RenderVideo }) {
  const [slide, setSlide] = useState(0), strip = useRef<HTMLDivElement>(null);
  if (module.kind === "video") return <section aria-label="A+ 视频模块">{videos.filter(v=>v.moduleId===module.id && module.videoHashes?.includes(v.hash)).map(video=><div key={video.hash}>{renderVideo ? renderVideo(video) : <KnowledgeVideoPlayer video={video} />}</div>)}</section>;
  const withTags = (content: ReactNode) => {
    const current = module.kind === "carousel" ? Math.min(slide, Math.max(0,module.cards.length-1)) : 0;
    const primary = images.get(module.cards[current]?.images[0]?.hash);
    return renderTags && module.section === "aplus" ? <div className="grid items-start gap-x-4 md:grid-cols-[minmax(0,1fr)_280px]">{content}<div className="min-h-0 md:relative md:self-stretch"><div className="py-2 md:absolute md:inset-0 md:overflow-y-auto">{primary ? renderTags([primary]) : <p className="text-xs leading-normal text-muted-foreground">缺失图片，暂无标签</p>}</div></div></div> : content;
  };
  const renderImage = (reference: { hash: string; alt: string }, small = false) => {
    const image = images.get(reference.hash);
    if (!image) return <div key={reference.hash} className="flex min-h-24 items-center justify-center bg-muted text-xs text-muted-foreground">缺失图片</div>;
    return <button key={reference.hash} type="button" onClick={() => onSelect(image)} aria-label={reference.alt || "查看图片与标签"} className="block w-full overflow-hidden p-0 leading-none">
      <KnowledgeImagePreview src={image.imageUrl} alt={reference.alt || "商品图片"} className={small ? "block h-40 w-full object-contain" : "block h-auto w-full"} fallbackClassName="h-32" />
    </button>;
  };
  const renderCard = (card: AmazonImageModule["cards"][number], index: number, compact = false) => <div key={index} className={compact ? "min-w-0 bg-white text-black" : "min-w-0"}>
    <div className={card.images.length > 1 && compact ? "grid grid-cols-2 gap-0" : "flex flex-col gap-0"}>{card.images.map(i => renderImage(i, module.kind === "comparison"))}</div>
    {(card.title || card.text) && <div className="px-4 py-3 leading-relaxed">{card.title && <p className="font-semibold">{card.title}</p>}{card.text && <p className="mt-1 whitespace-pre-wrap text-sm">{card.text}</p>}</div>}
  </div>;
  if (module.kind === "carousel") {
    const current = Math.min(slide, Math.max(0, module.cards.length - 1));
    return withTags(<section className="relative" aria-label="A+ 图片轮播">
      {module.cards[current] && renderCard(module.cards[current], current)}
      {module.cards.length > 1 && <div className="pointer-events-none absolute inset-x-3 top-1/2 flex justify-between">
        <Button className="pointer-events-auto" size="icon" variant="secondary" aria-label="上一张" onClick={() => setSlide((current - 1 + module.cards.length) % module.cards.length)}><ChevronLeft /></Button>
        <Button className="pointer-events-auto" size="icon" variant="secondary" aria-label="下一张" onClick={() => setSlide((current + 1) % module.cards.length)}><ChevronRight /></Button>
      </div>}
      <div className="pointer-events-none absolute bottom-2 inset-x-0 flex justify-center gap-1">{module.cards.map((_, i) => <button key={i} aria-label={`轮播第 ${i+1} 张`} aria-current={i === current} onClick={() => setSlide(i)} className={`pointer-events-auto h-2 w-2 rounded-full ${i === current ? "bg-primary" : "bg-gray-300"}`} />)}</div>
    </section>);
  }
  if (module.kind === "brand_story") {
    const background = module.background && images.get(module.background.hash);
    return <section className="relative overflow-hidden bg-slate-900 py-8" aria-label="品牌故事组合卡片">
      {background && <img src={background.imageUrl} alt="" loading="lazy" decoding="async" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />}
      {module.background && !background && <div className="relative mx-6 mb-4 rounded bg-white p-6 text-center text-sm text-muted-foreground">缺失图片（品牌故事背景）</div>}
      {background && <Button className="relative z-10 mb-4 ml-6" variant="secondary" size="sm" onClick={() => onSelect(background)}>查看品牌故事背景图</Button>}
      {module.title && <h3 className="relative mb-5 px-6 text-xl font-semibold text-white">{module.title}</h3>}
      <div ref={strip} className="relative flex items-start snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-3"><div aria-hidden="true" data-testid="brand-story-leading-space" className="w-[340px] max-w-[85vw] shrink-0 snap-start self-stretch" />
          {module.cards.map((card, i) => <div key={i} className="w-[340px] max-w-[85vw] shrink-0 snap-start" aria-label={card.images.length === 4 ? "品牌故事四图组合" : "品牌故事卡片"}>{renderCard(card,i,true)}</div>)}</div>
      {module.cards.length > 1 && <div className="relative flex justify-end gap-2 px-6 pt-2"><Button size="icon" variant="secondary" aria-label="上一组品牌故事" onClick={() => strip.current?.scrollBy({left:-360,behavior:"smooth"})}><ChevronLeft /></Button><Button size="icon" variant="secondary" aria-label="下一组品牌故事" onClick={() => strip.current?.scrollBy({left:360,behavior:"smooth"})}><ChevronRight /></Button></div>}
    </section>;
  }
  if (module.kind === "comparison") return withTags(<section className="min-w-0 overflow-x-auto" aria-label="A+ 产品对比">
    {module.title && <h3 className="py-4 text-center text-xl font-semibold">{module.title}</h3>}
    <table className="w-full border-collapse text-sm"><thead><tr>{module.rows.length > 0 && <th className="min-w-36" />}{module.cards.map((card,i)=><th key={i} className="min-w-44 align-top font-normal">{renderCard(card,i,true)}</th>)}</tr></thead>
      {module.rows.length > 0 && <tbody>{module.rows.map((row,i)=><tr key={i} className="border-t"><th className="px-3 py-2 text-left">{amazonContentText(row.label)}</th>{module.cards.map((_,j)=><td key={j} className="px-3 py-2">{amazonContentText(row.cells[j] || "") || "—"}</td>)}</tr>)}</tbody>}
    </table></section>);
  return withTags(<section aria-label={`A+ ${module.subtype || "图文模块"}`} className="min-w-0">{module.kind === "grid" && module.title && <h3 className="py-4 text-center text-xl font-semibold leading-normal">{module.title}</h3>}<div className={module.kind === "grid" ? "grid gap-0" : "flex flex-col gap-0"} style={module.kind === "grid" ? {gridTemplateColumns:`repeat(${Math.min(4,module.cards.length)}, minmax(0,1fr))`} : undefined}>{module.cards.map((card,i)=>renderCard(card,i,module.kind === "grid"))}</div></section>);
}

export default function AmazonRichContent({ layout, images, videos = [], section, onSelect, renderTags, renderVideo }: { layout?: unknown; images: Image[]; videos?: KnowledgeVideo[]; section: "aplus" | "brand_story"; onSelect: (image: Image) => void; renderTags?: RenderTags; renderVideo?: RenderVideo }) {
  const parsed = useMemo(() => AmazonImageLayoutSchema.safeParse(layout), [layout]);
  const modules = parsed.success ? parsed.data.modules.filter(m=>m.section === section) : [];
  const byHash = new Map(images.filter(i=>i.sourceUrlHash).map(i=>[i.sourceUrlHash!,i]));
  const used = new Set(modules.flatMap(m=>[...(m.background ? [m.background.hash] : []), ...m.cards.flatMap(c=>c.images.map(i=>i.hash))]));
  const remaining = images.filter(i=>!i.sourceUrlHash || !used.has(i.sourceUrlHash));
  return <div className="overflow-hidden bg-white leading-none">
    {modules.map(m=><Module key={m.id} module={m} images={byHash} videos={videos} onSelect={onSelect} renderTags={renderTags} renderVideo={renderVideo} />)}
    {remaining.length > 0 && <div className="flex flex-col gap-0">{remaining.map(image=><div key={image.id} className={section === "aplus" && renderTags ? "grid items-start gap-x-4 md:grid-cols-[minmax(0,1fr)_280px]" : ""}><button type="button" className="block w-full p-0 leading-none" onClick={()=>onSelect(image)} aria-label="查看图片与标签"><KnowledgeImagePreview src={image.imageUrl} alt={section === "aplus" ? "A+ 内容" : "品牌故事"} className="block h-auto w-full" fallbackClassName="h-32" /></button>{section === "aplus" && renderTags && <div className="min-h-0 md:relative md:self-stretch"><div className="py-2 md:absolute md:inset-0 md:overflow-y-auto">{renderTags([image])}</div></div>}</div>)}</div>}
  </div>;
}
