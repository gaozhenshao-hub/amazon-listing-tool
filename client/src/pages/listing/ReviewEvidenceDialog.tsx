import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ReviewStars } from './ReviewExcerpt';

type Data={total:number;available:number;pageSize:number;stale?:boolean;items:Array<{id:string;title:string;body:string;rating:number|null;date:string|null;translation:string|null;asin?:string}>};
function EvidenceBody({name,onClose,page,setPage,query}:{name:string;onClose:()=>void;page:number;setPage:(page:number)=>void;query:{data?:Data;isLoading:boolean;error:{message:string}|null}}){
 const total=query.data?.total||0,available=query.data?.available||0,pageSize=query.data?.pageSize||10;
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto"><DialogTitle>{name} · 评论证据</DialogTitle>
  <DialogDescription>对应 {total} 条评论。中文为 AI 翻译，请以原文为准。</DialogDescription>
  {query.isLoading&&<p>正在读取评论原文…</p>}{query.error&&<p role="alert">{query.error.message}</p>}
  {query.data?.stale&&<p className="text-sm text-amber-700">部分竞品分析已更新，请更新汇总后核对证据。</p>}
  {query.data&&available<total&&<p className="text-sm text-amber-700">其中 {total-available} 条原始评论暂不可用，请重新分析后核对。</p>}
  {query.data&&!total&&!query.data.stale&&<p className="text-sm text-muted-foreground">没有已关联的原始评论；手动添加或旧版评价点请先更新汇总。</p>}
  {query.data?.items.map(item=><article key={item.id} className="space-y-2 rounded-lg border p-3 text-sm"><div className="font-medium"><ReviewStars rating={item.rating}/> {item.title}{item.asin&&<span className="ml-2 text-xs text-muted-foreground">{item.asin}</span>}</div><p className="whitespace-pre-wrap">{item.body||item.title}</p><p className="whitespace-pre-wrap text-xs text-muted-foreground">{item.translation||'中文翻译暂不可用'}</p>{item.date&&<p className="text-xs text-muted-foreground">{item.date}</p>}</article>)}
  <div className="flex items-center gap-3"><Button variant="outline" disabled={page<=1} onClick={()=>setPage(page-1)}>上一页</Button><span className="text-sm">{page} / {Math.max(1,Math.ceil(available/pageSize))}</span><Button variant="outline" disabled={page*pageSize>=available} onClick={()=>setPage(page+1)}>下一页</Button></div>
 </DialogContent></Dialog>;
}
export default function ReviewEvidenceDialog({projectId,analysisId,groupIndex,generatedAt,name,onClose}:{projectId:number;analysisId:number;groupIndex:number;generatedAt:string;name:string;onClose:()=>void}){
 const [page,setPage]=useState(1);const query=trpc.analysis.reviewEvidence.useQuery({projectId,analysisId,groupIndex,generatedAt,page});
 return <EvidenceBody name={name} onClose={onClose} page={page} setPage={setPage} query={query}/>;
}
export function AggregationReviewEvidenceDialog({projectId,itemId,name,onClose}:{projectId:number;itemId:string;name:string;onClose:()=>void}){
 const [page,setPage]=useState(1);const query=trpc.analysis.aggregationReviewEvidence.useQuery({projectId,itemId,page});
 return <EvidenceBody name={name} onClose={onClose} page={page} setPage={setPage} query={query}/>;
}
