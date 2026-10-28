import SetTagsActions from "./SetTagsActions";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import AssetDeleteButton from "./AssetDeleteButton";
import { Link } from "wouter";
import { useState } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { AmazonStyleGallery } from "./AmazonStyleGallery";
import { ArrowLeft } from "lucide-react";
import { closeCurrentWorkspaceTabAndNavigate } from "@/components/workspace/workspaceTabState";
import KnowledgeVideoInline from "./KnowledgeVideoInline";
import KnowledgeVideoPlayer from "./KnowledgeVideoPlayer";
import { CollectionTags } from "./KnowledgeTag";

export default function KBImageSetPage() {
  const id = Number(useParams<{id:string}>().id), [selected,setSelected] = useState<number|null>(null);
  const query = trpc.kbImages.getSet.useQuery({id}, {enabled:Number.isSafeInteger(id)&&id>0,staleTime:60_000});
  const videos = trpc.kbVideos.list.useQuery({imageSetId:id,scope:"all",page:1}, {enabled:Number.isSafeInteger(id)&&id>0,staleTime:30_000});
  const {user}=useAuth();
  const [jobId,setJobId]=useState<number|null>(null);
  const refresh=trpc.knowledgeAssets.refreshCollection.useMutation({onSuccess:r=>{setJobId(r.jobId);toast.success(r.existing?"已有采集任务，请查看进度":"已开始重新采集，完成后更新本套图并自动打标");},onError:e=>toast.error(e.message)});
  if(query.isLoading) return <p className="p-8 text-muted-foreground">正在读取图片集…</p>;
  if(query.error || !query.data) return <div className="p-8">图片集不存在或暂时无法读取。<Button variant="outline" className="ml-3" onClick={()=>query.refetch()}>重试</Button></div>;
  const set=query.data, group=(role:string)=>[...set.images.filter(i=>i.imagePosition===role),...(set.missingGallery||[]).filter(i=>i.imagePosition===role).map(i=>({...i,imageUrl:"",imageAccessError:"缺失图片",missing:true}))];
  return <main className="mx-auto w-full max-w-[1400px] space-y-6 p-6">
    <header className="space-y-4"><Button variant="ghost" className="-ml-3" onClick={()=>closeCurrentWorkspaceTabAndNavigate("/knowledge/images")}><ArrowLeft className="mr-2 h-4 w-4"/>返回知识库</Button><div><p className="text-sm text-muted-foreground">{set.asin} · {set.brand || "商品图片"}</p><h1 className="mt-1 text-xl font-semibold">{set.productTitle || set.asin}</h1></div><div className="flex flex-wrap items-center gap-3"><CollectionTags category={set.setCategory} style={set.setStyle} primaryColor={set.setPrimaryColor} accentColor={set.setAccentColor} />{set.canEditTags&&<SetTagsActions id={id}/>}</div></header>
    <AmazonStyleGallery mainImages={group("main") as any} secondaryImages={group("secondary") as any} brandStoryImages={group("brand_story") as any} aplusImages={group("aplus") as any} sourceLayout={set.sourceLayout} videos={set.videos} renderVideo={video=>{const item=videos.data?.items.find(item=>item.video.hash===video.hash && item.video.moduleId===video.moduleId && item.video.role===video.role);return item ? <KnowledgeVideoInline key={item.id} id={item.id} /> : <KnowledgeVideoPlayer video={video}/>;}} onSelectImage={setSelected} selectedImageId={selected} allowEdit={set.canEditTags} />
    <footer className="flex flex-wrap items-center justify-between gap-4 border-t pt-6">
      <div className="flex flex-wrap gap-3">{set.canEditTags&&<Button variant="outline" disabled={refresh.isPending} onClick={()=>refresh.mutate({id})}>重新采集打标</Button>}{["admin","super_admin"].includes(user?.role||"")&&<AssetDeleteButton kind="set" id={id} label="删除本 ASIN 集" onDeleted={()=>closeCurrentWorkspaceTabAndNavigate("/knowledge/images")}/>}</div>
      {jobId&&<Link className="text-sm text-primary underline" href={`/knowledge/acquisition/job/${jobId}`}>查看重新采集进度</Link>}
    </footer>
  </main>;
}
