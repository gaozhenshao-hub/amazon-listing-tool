import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
export default function KnowledgeContributions({open,onClose}:{open:boolean;onClose:()=>void}) {
  const query=trpc.kbImages.contributions.useQuery(undefined,{enabled:open,staleTime:60_000});
  return <Dialog open={open} onOpenChange={value=>{if(!value)onClose();}}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>采集贡献榜</DialogTitle><DialogDescription>统计已入库并共享的 ASIN 和图片，归属首次采集人；重复采集同一 ASIN 不重复累计。</DialogDescription></DialogHeader>
    {query.isLoading ? <p className="py-8 text-center">正在统计…</p> : query.error ? <div>暂时无法读取<Button variant="outline" onClick={()=>query.refetch()}>重试</Button></div> : <div className="max-h-[60vh] overflow-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-3">排名</th><th>运营</th><th className="text-right">ASIN 数</th><th className="text-right">图片数</th></tr></thead><tbody>{query.data?.map((row,i)=><tr key={row.userId} className="border-b"><td className={`py-4 ${i<3?"font-semibold text-amber-600":"text-muted-foreground"}`}>{i+1}</td><td>{row.name}</td><td className="text-right font-medium tabular-nums">{row.asinCount}</td><td className="text-right tabular-nums">{row.imageCount}</td></tr>)}</tbody></table>{!query.data?.length&&<p className="py-8 text-center text-muted-foreground">暂无已共享的采集记录</p>}</div>}
  </DialogContent></Dialog>;
}
