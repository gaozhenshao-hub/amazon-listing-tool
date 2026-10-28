import {useState} from 'react';
import {trpc} from '@/lib/trpc';
import {Button} from '@/components/ui/button';
import {Card,CardHeader,CardTitle,CardContent} from '@/components/ui/card';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Download,Trash2,FileSpreadsheet} from 'lucide-react';
import {toast} from 'sonner';
const labels:Record<string,string>={reviews:'补充评论',questions:'Alexa 问题',attributes:'本品属性'};
const statuses:Record<string,string>={processing:'处理中',success:'上传成功',failed:'上传失败'};
export default function ListingUploadedFiles({projectId}:{projectId:number}){
 const utils=trpc.useUtils();const query=trpc.listingInputs.files.useQuery({projectId},{refetchInterval:3000});
 const remove=trpc.listingInputs.deleteFile.useMutation();const [deleting,setDeleting]=useState<{id:number;filename:string}|null>(null);
 const [downloading,setDownloading]=useState<number|null>(null);
 const download=async(id:number)=>{setDownloading(id);try{const f=await utils.listingInputs.downloadFile.fetch({projectId,id});const bytes=Uint8Array.from(atob(f.base64),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));const a=document.createElement('a');a.href=url;a.download=f.filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){toast.error(e instanceof Error?e.message:'下载失败');}finally{setDownloading(null);}};
 return <Card><CardHeader><CardTitle className="text-base">上传文件</CardTitle></CardHeader><CardContent className="space-y-3">
 <p className="text-xs text-muted-foreground">从本次更新起保留上传的原文件；相同内容不会重复导入。</p>
 {query.error&&<p role="alert" className="text-xs text-destructive">{query.error.message}</p>}
 {!query.data?.length&&<p className="text-sm text-muted-foreground">{query.isLoading?'正在读取…':'暂无文件记录'}</p>}
 <div className="max-h-[520px] space-y-3 overflow-y-auto">{query.data?.map(f=><div key={f.id} className="rounded-lg border p-3"><div className="flex gap-2"><FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0"/><p className="break-all text-sm font-medium">{f.filename}</p></div><p className="mt-2 text-xs text-muted-foreground">{labels[f.kind]||f.kind} · {(f.size/1024).toFixed(1)} KB</p><p className="mt-1 text-xs text-muted-foreground">{new Date(f.createdAt).toLocaleString('zh-CN')}</p><p role="status" className={`mt-2 text-xs ${f.status==='failed'?'text-destructive':f.status==='success'?'text-emerald-600':'text-muted-foreground'}`}>{statuses[f.status]||f.status}</p>{f.error&&<p className="mt-1 break-words text-xs text-destructive">{f.error}</p>}<div className="mt-2 flex gap-2"><Button size="sm" variant="outline" disabled={downloading===f.id} onClick={()=>void download(f.id)}><Download className="h-3 w-3"/>下载</Button><Button size="sm" variant="ghost" disabled={f.status==='processing'} onClick={()=>setDeleting({id:f.id,filename:f.filename})}><Trash2 className="h-3 w-3"/>删除</Button></div></div>)}</div>
 <Dialog open={!!deleting} onOpenChange={open=>{if(!open)setDeleting(null);}}><DialogContent><DialogHeader><DialogTitle>删除上传文件</DialogTitle></DialogHeader><p className="break-all text-sm">{deleting?.filename}</p><p className="text-sm text-muted-foreground">删除原文件和上传记录，已导入的评论、问题及属性会保留。</p><div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setDeleting(null)}>取消</Button><Button variant="destructive" disabled={remove.isPending} onClick={async()=>{if(!deleting)return;try{await remove.mutateAsync({projectId,id:deleting.id});setDeleting(null);await utils.listingInputs.files.invalidate({projectId});toast.success('文件已删除');}catch(e){toast.error(e instanceof Error?e.message:'删除失败');}}}>确认删除</Button></div></DialogContent></Dialog>
 </CardContent></Card>;
}
