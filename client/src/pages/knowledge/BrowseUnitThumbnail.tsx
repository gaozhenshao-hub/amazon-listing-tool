import { KnowledgeImagePreview } from "@/components/KnowledgeImagePreview";
import type { AmazonImageModule } from "@shared/amazonImageLayout";

type Image={id:number;imageUrl?:string|null;thumbnailUrl?:string|null;sourceUrlHash?:string|null;imageAccessError?:string|null};
/** Compact rendering of the same module used by tagging and the full preview. */
export default function BrowseUnitThumbnail({image}:{image:Image & {module?:AmazonImageModule|null;moduleImages?:Image[]}}) {
  if (!image.module || !image.moduleImages?.length) return <KnowledgeImagePreview src={image.thumbnailUrl || image.imageUrl} alt="知识库图片" className="block w-full aspect-square object-contain" fallbackClassName="aspect-square w-full" accessError={image.imageAccessError}/>;
  const module=image.module, members=new Map(image.moduleImages.map(i=>[i.sourceUrlHash,i]));
  const columns=module.kind === "grid" || module.kind === "comparison" ? module.cards.length : 1;
  return <div className="bg-white text-black" aria-label={`完整A+模块：${module.subtype || module.kind}`}>
    <div className="grid gap-0" style={{gridTemplateColumns:`repeat(${Math.max(1,columns)},minmax(0,1fr))`}}>
      {module.cards.map((card,index)=><div key={index} className="min-w-0">{card.images.map(ref=>{const member=members.get(ref.hash);return <KnowledgeImagePreview key={ref.hash} src={member?.thumbnailUrl || member?.imageUrl} alt={ref.alt || "模块图片"} className="block h-auto w-full" fallbackClassName="h-16"/>;})}
        {card.title && <p className="px-1 py-1 text-[9px] leading-tight line-clamp-2">{card.title}</p>}
      </div>)}
    </div>
    <p className="px-2 py-1 text-[10px] text-muted-foreground">{module.subtype || "A+ 模块"}</p>
  </div>;
}
