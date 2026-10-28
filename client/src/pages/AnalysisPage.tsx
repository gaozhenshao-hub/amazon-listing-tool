import { useAuth } from "@/_core/hooks/useAuth";
import ListingResultCard from './listing/ListingResultCard';
import ListingProductQuestions from './listing/ListingProductQuestions';
import ListingInputPanels from './listing/ListingInputPanels';
import ListingReviewList from './listing/ListingReviewList';
import { useState } from 'react';
import { useLocation } from 'wouter';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import ProjectSelector from '@/components/ProjectSelector';
import { useProject } from '@/contexts/ProjectContext';
import { toast } from 'sonner';
import ListingStages from './listing/ListingStages';
import CollectedListingFacts, { collectedRecordFacts } from './listing/CollectedListingFacts';
import DeleteAcquisitionButton from './acquisition/DeleteAcquisitionButton';
import { acquisitionFailureMessage } from '../../../shared/competitorAcquisition';
import { readJson } from '../../../shared/competitorPresentation';

const statuses:Record<string,string>={queued:'排队中',running:'抓取中',review_required:'已抓取 · 待确认',confirmed:'已保存',failed:'抓取失败',canceled:'已取消'};
function CaptureResult({job,onRetry,projectId,record}:{record?:any;job:any;projectId:number;onRetry:(asin:string)=>void}) {
 const [,navigate]=useLocation();
 const {user}=useAuth(); const workspaceId=user?.defaultWorkspaceId;
 const progress=trpc.acquisition.reviewJob.useQuery({expectedWorkspaceId:workspaceId!,jobId:job.id},{enabled:!!workspaceId,staleTime:60000,refetchInterval:['queued','running'].includes(job.status)?3000:false});
 const snapshotId=progress.data?.snapshotId;
 const review=trpc.acquisition.review.useQuery({snapshotId:snapshotId!,expectedWorkspaceId:workspaceId!,expectedProjectId:projectId},{enabled:!!snapshotId&&!!workspaceId,staleTime:60000});
 const data=review.data?{...(review.data.effectiveDraft as any),manualSales:readJson(record?.rawData)?.manualSales,imageAssets:review.data.assets.map(a=>({role:a.role,url:a.previewUrl}))}:null;
 const images=review.data?.assets.filter(a=>['main','secondary','aplus','brand_story'].includes(a.role)&&a.previewUrl).map(a=>a.previewUrl!)||[];
 return <ListingResultCard projectId={projectId} asin={job.asin} status={statuses[job.status]||job.status} data={data} images={images}>
  {data?<CollectedListingFacts hideReviews={job.status==='confirmed'} data={data} images={review.data?.assets.filter(a=>['main','secondary','aplus','brand_story'].includes(a.role)&&a.previewUrl).map(a=>a.previewUrl!)}/>:<p className="text-sm text-muted-foreground">{review.error?.message||progress.error?.message||(job.status==='failed'?acquisitionFailureMessage(job.failureCategory):'抓取结果将在这里显示。')}</p>}
  <div className="flex gap-2">{snapshotId&&job.status!=='confirmed'&&<Button size="sm" onClick={()=>navigate(`/listing/acquisition/review/${snapshotId}`)}>检查并保存抓取结果</Button>}{['failed','canceled','confirmed'].includes(job.status)&&<Button size="sm" variant="outline" onClick={()=>onRetry(job.asin)}>重新抓取</Button>}<DeleteAcquisitionButton jobId={job.id} status={job.status}/></div>
 {job.status==='confirmed'&&<><ListingProductQuestions projectId={projectId} asin={job.asin}/><ListingReviewList projectId={projectId} asin={job.asin}/></>}</ListingResultCard>;
}

export default function AnalysisPage(){
 const {selectedProjectId}=useProject();
 const [asins,setAsins]=useState('');const [busy,setBusy]=useState(false);const [errors,setErrors]=useState<string[]>([]);
 const utils=trpc.useUtils();const collect=trpc.analysis.collectAsin.useMutation();
 const jobs=trpc.acquisition.listJobs.useQuery({scope:'competitor',projectId:selectedProjectId!,limit:100},{enabled:!!selectedProjectId,refetchInterval:query=>query.state.data?.some(j=>["queued","running"].includes(j.status))?4000:false,staleTime:30000});
 const records=trpc.analysis.listByProject.useQuery({projectId:selectedProjectId!},{enabled:!!selectedProjectId,staleTime:30000});
 const latest=[...new Map((jobs.data||[]).filter(j=>j.consumerType==='project_competitor').sort((a,b)=>a.id-b.id).map(j=>[j.asin,j])).values()].reverse();
 const submit=async(values?:string[])=>{
  if(!selectedProjectId)return;
  const items=[...new Set(values||asins.toUpperCase().trim().split(/[\s,，;；]+/).filter(Boolean))];
  if(!items.length||items.length>20||items.some(a=>!/^[A-Z0-9]{10}$/.test(a))){toast.error('请输入 1–20 个有效的十位 ASIN，用换行或逗号分隔');return;}
  setBusy(true);setErrors([]);const failures:string[]=[];
  try{for(const asin of items){try{await collect.mutateAsync({projectId:selectedProjectId,asin,refresh:!!values});}catch(e){failures.push(`${asin}：${e instanceof Error?e.message:'创建失败'}`);}}
   setErrors(failures);await Promise.all([utils.acquisition.listJobs.invalidate(),utils.analysis.listByProject.invalidate({projectId:selectedProjectId})]);if(items.length>failures.length)toast.success(`已提交 ${items.length-failures.length} 个抓取任务`);
  }finally{setBusy(false);}
 };
 return <div className="space-y-5"><ListingStages/><header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Listing 抓取</h1><p className="mt-1 text-sm text-muted-foreground">批量抓取亚马逊商品页面。这里只采集原始资料，分析在下一步进行。</p></div><ProjectSelector/></header>
 {!selectedProjectId?<p className="rounded-xl border p-8">请先创建或选择一个项目。</p>:<div className="grid items-start gap-5 lg:grid-cols-[340px_minmax(0,1fr)]"><div className="space-y-4"><Card><CardHeader><CardTitle>输入 ASIN</CardTitle></CardHeader><CardContent className="space-y-4"><Textarea aria-label="批量 ASIN" rows={8} value={asins} onChange={e=>setAsins(e.target.value)} placeholder={'每行一个 ASIN，最多 20 个\nB08C7LHM7S'}/><p className="text-xs text-muted-foreground">抓取品牌、销量提示、变体、标题、五点描述、长描述、主副图、A+、品牌故事和页面评论。没有返回的字段标记为未采到。</p><Button disabled={busy} onClick={()=>submit()} className="w-full">{busy?'正在提交…':'开始抓取'}</Button>{errors.map(e=><p key={e} role="alert" className="text-xs text-destructive">{e}</p>)}<p className="text-xs text-muted-foreground">任务在后台运行，可离开页面。检查并保存后，资料会出现在「Listing 对比及分析」。</p></CardContent></Card><ListingInputPanels key={selectedProjectId} projectId={selectedProjectId}/></div><section className="min-w-0 space-y-4"><h2 className="text-lg font-semibold">抓取结果</h2>{jobs.error&&<p role="alert">{jobs.error.message}</p>}{records.error&&<p role="alert">{records.error.message}</p>}{latest.filter(job=>job.status!=="confirmed"||!records.data?.some(r=>r.asin===job.asin)).map(job=><CaptureResult key={job.id} job={job} record={records.data?.find(r=>r.asin===job.asin)} projectId={selectedProjectId} onRetry={asin=>{if(!busy)void submit([asin]);}}/>)}{(records.data||[]).filter(r=>!latest.some(j=>j.asin===r.asin&&j.status!=="confirmed")).map(r=><ListingResultCard projectId={selectedProjectId} key={r.id} asin={r.asin} status="已保存资料" data={collectedRecordFacts(r)} images={readJson(r.rawData)?.imageAssets?.filter((a:any)=>a.url).map((a:any)=>a.url)||readJson(r.imageUrls)||[]}><CollectedListingFacts hideReviews data={collectedRecordFacts(r)} images={readJson(r.rawData)?.imageAssets?.filter((a:any)=>a.url).map((a:any)=>a.url)||readJson(r.imageUrls)||[]}/><ListingProductQuestions projectId={selectedProjectId} asin={r.asin}/><ListingReviewList projectId={selectedProjectId} asin={r.asin}/></ListingResultCard>)}{!latest.length&&!records.data?.length&&<p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">输入 ASIN 后，每个商品的抓取结果会显示在这里。</p>}</section></div>}
 </div>;
}
