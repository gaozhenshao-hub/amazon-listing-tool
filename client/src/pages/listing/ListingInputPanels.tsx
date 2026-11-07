import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
const fileBase64=(file:File)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});
export default function ListingInputPanels({projectId}:{projectId:number}){
 const utils=trpc.useUtils();const [busy,setBusy]=useState(false),[messages,setMessages]=useState<string[]>([]);
 const reviewRef=useRef<HTMLInputElement>(null),questionRef=useRef<HTMLInputElement>(null);
 const [targetAsin,setTargetAsin]=useState('');
 const products=trpc.analysis.listByProject.useQuery({projectId});
 const review=trpc.listingInputs.uploadReviews.useMutation(),questions=trpc.listingInputs.uploadQuestions.useMutation();
 useEffect(()=>{setTargetAsin('');setMessages([]);},[projectId]);
 const upload=async(files:FileList|null,kind:'reviews'|'questions')=>{if(!files?.length)return;setBusy(true);try{for(const file of Array.from(files)){try{if(file.size>10*1024*1024)throw new Error('文件超过 10MB');const input={projectId,filename:file.name,base64:await fileBase64(file)};const result=kind==='reviews'?await review.mutateAsync(input):await questions.mutateAsync({...input,targetAsin:targetAsin||undefined});if(result.duplicateFile)toast.warning(`${file.name}：重复文件，未重复导入`);setMessages(m=>[`${file.name}：新增 ${result.inserted} 条，重复 ${result.duplicates} 条${'matches' in result?'；'+result.matches.join('；'):''}`,...m].slice(0,20));}catch(e){setMessages(m=>[`${file.name}：${e instanceof Error?e.message:'上传失败'}`,...m].slice(0,20));}}await Promise.all([utils.listingInputs.reviews.invalidate(),utils.analysis.listByProject.invalidate({projectId}),utils.listingInputs.questions.invalidate(),utils.listingInputs.files.invalidate({projectId})]);}finally{setBusy(false);}};

 return <div className="space-y-4">
 <Card><CardHeader><CardTitle className="text-base">评论补充</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-xs text-muted-foreground">支持卖家导出的 XLSX / XLS / CSV，可连续或多选上传。按表内 ASIN 或文件名匹配，重复评论自动跳过。每个文件最大 10MB。</p><input ref={reviewRef} className="hidden" type="file" accept=".xlsx,.xls,.csv" multiple disabled={busy} onChange={e=>{void upload(e.target.files,'reviews');e.target.value='';}}/><Button className="w-full" aria-label="选择评论文件" disabled={busy} onClick={()=>reviewRef.current?.click()}><Upload className="h-4 w-4"/>{busy?'正在处理…':'选择文件'}</Button><p className="text-xs text-muted-foreground">补充后请重新分析，以更新评论结论。</p></CardContent></Card>
 <Card><CardHeader><CardTitle className="text-base">Alexa 问题上传</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-xs text-muted-foreground">优先按 ASIN 匹配；没有 ASIN 时，按回答中的品牌自动匹配。相似商品不参与匹配，无法唯一确定时可选择所属商品。问题、翻译和追问会补充到右侧。</p><select aria-label="Alexa 问题所属商品" className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={targetAsin} onChange={e=>setTargetAsin(e.target.value)} disabled={busy}><option value="">自动匹配 ASIN / 品牌</option>{(products.data||[]).map(p=><option key={p.id} value={p.asin}>{p.asin}</option>)}</select><input ref={questionRef} className="hidden" type="file" accept=".xlsx,.xls,.csv" multiple disabled={busy} onChange={e=>{void upload(e.target.files,'questions');e.target.value='';}}/><Button className="w-full" aria-label="选择 Alexa 问题文件" disabled={busy} onClick={()=>questionRef.current?.click()}><Upload className="h-4 w-4"/>{busy?'正在处理…':'选择文件'}</Button></CardContent></Card>
 {busy&&<p className="text-sm">正在处理文件…</p>}{messages.length>0&&<div className="space-y-2 rounded-lg border p-3 text-xs" aria-live="polite">{messages.map((m,i)=><p className="break-words" key={i}>{m}</p>)}</div>}
 </div>;
}
