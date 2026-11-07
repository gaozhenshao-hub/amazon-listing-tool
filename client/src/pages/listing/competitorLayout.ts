import { AmazonImageLayoutSchema, type AmazonImageModule } from "@shared/amazonImageLayout";

export type CompetitorAsset = {role:string;url:string;sourceUrlHash?:string;contentHash?:string|null;thumbnailUrl?:string|null;moduleClass?:string|null;positionIndex?:number};
export type RichSlot = {module:AmazonImageModule; assets:CompetitorAsset[]} | {module:null; assets:CompetitorAsset[]};

/** Preserve the captured module order and keep any older, unstructured images visible. */
export function competitorRichSlots(layout:unknown, assets:CompetitorAsset[], section:"aplus"|"brand_story"):RichSlot[] {
  const relevant=assets.filter(a=>a.role===section && a.url);
  const parsed=AmazonImageLayoutSchema.safeParse(layout);
  const modules=parsed.success?parsed.data.modules.filter(m=>m.section===section):[];
  const used=new Set(modules.flatMap(m=>[...(m.background?[m.background.hash]:[]),...m.cards.flatMap(c=>c.images.map(i=>i.hash))]));
  const slots:RichSlot[]=modules.map(module=>({module,assets:relevant.filter(a=>a.sourceUrlHash && (module.background?.hash===a.sourceUrlHash || module.cards.some(c=>c.images.some(i=>i.hash===a.sourceUrlHash))))}));
  const remaining=relevant.filter(a=>!a.sourceUrlHash||!used.has(a.sourceUrlHash));
  return section==='brand_story' && remaining.length
    ? [...slots,{module:null,assets:remaining}]
    : [...slots,...remaining.map(asset=>({module:null,assets:[asset]}))];
}
