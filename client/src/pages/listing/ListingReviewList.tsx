import ReviewExcerpt,{ReviewStars} from './ReviewExcerpt';
import { Link } from 'wouter';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
export default function ListingReviewList({projectId,asin,page=1,pageSize=5,onPage}:{projectId:number;asin:string;page?:number;pageSize?:number;onPage?:(page:number)=>void}) {
 const query=trpc.listingInputs.reviews.useQuery({projectId,asin,page,pageSize});
 const total=query.data?.total||0;
 return <section className="space-y-3 border-t pt-4"><h3 className="font-medium">评论 · {total} 条 <span className="text-xs text-muted-foreground">（文件补充 {query.data?.imported||0} 条）</span></h3>
 {query.isLoading&&<p>正在读取评论…</p>}{query.error&&<p role="alert">{query.error.message}</p>}
 {query.data?.items.map((r:any)=><article key={r.id} className="space-y-1 rounded-lg border p-3 text-sm"><p className="font-medium"><ReviewStars rating={r.rating}/> · {r.title||'无标题'}</p><p className="text-xs text-muted-foreground">{r.date} {r.variant} {r.source==='file_upload'?`· 文件补充 ${r.filename||''}`:''}</p><ReviewExcerpt text={r.body||''}/></article>)}
 {!query.isLoading&&!total&&<p className="text-sm text-muted-foreground">尚无评论，可在左侧上传评论表格补充。</p>}
 {onPage?<div className="flex items-center gap-3"><Button variant="outline" disabled={page===1} onClick={()=>onPage(page-1)}>上一页</Button><span>{page} / {Math.max(1,Math.ceil(total/pageSize))}</span><Button variant="outline" disabled={page*pageSize>=total} onClick={()=>onPage(page+1)}>下一页</Button></div>:total>pageSize&&<Link className="inline-block text-sm text-primary underline" href={`/listing/reviews/${projectId}/${asin}`}>查看更多评论（共 {total} 条）</Link>}
 </section>;
}
