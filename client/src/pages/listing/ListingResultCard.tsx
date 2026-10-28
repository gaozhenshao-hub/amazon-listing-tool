import ListingSalesEditor from './ListingSalesEditor';
import {useState,type ReactNode} from 'react';
import {ChevronDown,ChevronUp,ImageIcon} from 'lucide-react';
import {Card,CardContent} from '@/components/ui/card';
export default function ListingResultCard({projectId,asin,status,data,images=[],children}:{projectId:number;asin:string;status:string;data:any;images?:string[];children:ReactNode}){
 const [expanded,setExpanded]=useState(false);
 const price=typeof data?.price==='object'&&data?.price?`${data.price.value} ${data.price.currency}`:data?.price;
 return <Card className="overflow-hidden"><button type="button" aria-expanded={expanded} aria-label={`${asin} ${expanded?'收起':'展开'}抓取结果`} onClick={()=>setExpanded(!expanded)} className="block w-full p-5 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
 <div className="mb-3 flex items-center justify-between gap-3"><span className="font-semibold">{asin}</span><span className="text-xs text-muted-foreground">{status}</span></div>
 <div className="flex gap-4"><div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg border bg-white">{images[0]?<img src={images[0]} alt="商品主图" loading="lazy" className="h-full w-full rounded-lg object-contain"/>:<ImageIcon className="h-8 w-8 text-muted-foreground"/>}</div><div className="min-w-0 flex-1"><p className="line-clamp-2 break-words text-sm font-medium">{data?.title||'等待抓取商品标题'}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>品牌：{data?.brand||'未采到'}</span><span>价格：{price||'未采到'}</span><span>评分：{data?.rating??'未采到'} / {data?.reviewCount??'未采到'} 条</span></div>{images.length>1&&<div className="mt-2 flex items-center gap-2"><span className="text-xs text-muted-foreground">共 {images.length} 张</span></div>}</div></div>
 <div className="mt-3 flex items-center justify-end gap-1 text-xs text-primary">{expanded?'收起详情':'展开详情'}{expanded?<ChevronUp className="h-4 w-4"/>:<ChevronDown className="h-4 w-4"/>}</div></button>
 <ListingSalesEditor projectId={projectId} asin={asin} data={data}/>
 {(expanded||!data)&&<CardContent className="space-y-4 border-t pt-4">{children}</CardContent>}</Card>;
}
