import { applyVideoEdits } from "@shared/competitorVideoAnalysis";
import { useState, type ReactNode } from "react";
import { Lightbulb, Highlighter, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {competitorStudyFields} from "@shared/competitorStudyFields";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import CompetitorAdjustmentDialog from "./CompetitorAdjustmentDialog";
import {moduleSellingPoints,moduleAdjustmentKeys,
} from "@shared/richModuleSellingPoints";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { readJson, sumVariantPurchases } from "@shared/competitorPresentation";
import type { KnowledgeVideo } from "@shared/knowledgeVideos";
import type { z } from "zod";
import { competitorMarksSchema } from "@shared/listingAggregation";
import AmazonRichContent, {type RichSelection,
} from "../knowledge/AmazonRichContent";
import {PreparedImage} from "@/components/PreparedImage";
import {brandBackgroundHashes,applyRichContentEdits,
} from "@shared/richContentPresentation";
import KnowledgeVideoPlayer from "../knowledge/KnowledgeVideoPlayer";
import ListingReviewList from "./ListingReviewList";
import ReviewEvidenceDialog from "./ReviewEvidenceDialog";
import { ReviewStars } from "./ReviewExcerpt";
import { competitorRichSlots, type CompetitorAsset, type RichSlot,
} from "./competitorLayout";

type Marks = z.infer<typeof competitorMarksSchema>;
type Edit = {type:"edit";key:string;original:string;value:string};
type Mark =
  | {type:"image";hash:string}|{type:"highlight";bulletIndex:number;start:number;end:number;text:string;
    }|Edit|{type:"edits";items:Edit[]};
type Asset = CompetitorAsset;
function Highlighted({text, ranges,
}:{text:string;ranges:Marks["highlights"];
}) {
 const cells = Array.from({length:text.length},()=>false);
 for(const range of ranges) for(let i=range.start;i<Math.min(text.length,range.end);i++) cells[i]=true;
 const fragments:ReactNode[]=[];let start=0;
 while(start<text.length){const marked=cells[start];let end=start+1;while(end<text.length&&cells[end]===marked)end++;fragments.push(marked? (
        <mark key={start} className="rounded bg-yellow-200">{text.slice(start,end)}</mark>
      ) : (
        <span key={start}>{text.slice(start,end)}</span>
      )
    );start=end;}
 return <>{fragments}</>;
}
export default function CompetitorStudyColumn({record,projectId,marks,onMark,busy,rowCounts,columnIndex,onReanalyze,
}:{record:any;projectId:number;marks?:Marks;onMark:(change:Mark)=>Promise<void>;busy:boolean;rowCounts?:{gallery:number;bullets:number;aplus:number;brand:number;
  };columnIndex?:number;onReanalyze?:()=>Promise<void>;
}){
 const [marker,setMarker]=useState(false),[page,setPage]=useState(1);
 const [preview,setPreview]=useState<Asset|null>(null);
 const [videoSeeks, setVideoSeeks] = useState<
    Record<string, { seconds: number; nonce: number }>
  >({});
  const prepareVideos = trpc.analysis.prepareVideos.useMutation();
  const utils=trpc.useUtils(),addToKnowledge=trpc.kbImages.importProjectCompetitor.useMutation();
 const add=async(kind: "set" | "image" | "video",assetHash?:string)=>{try{const result=await addToKnowledge.mutateAsync({projectId,analysisId:record.id,kind,assetHash,
      });toast.success(kind=== "set"
          ? "整套图片已加入 ASIN 集"
          :kind=== "image"
            ? "已加入单图图库，不关联 ASIN"
            : "已加入视频库，不关联 ASIN"
      );if(result.taggingStatus=== "failed_to_queue")toast.warning("素材已保存，标签分析暂未启动");void utils.kbImages.invalidate();void utils.kbVideos.invalidate();}catch(error){toast.error(error instanceof Error?error.message: "入库未完成，请重试"
      );}};
 const [adjustment,setAdjustment]=useState<{target: "study" | "translation" | "video";keys:string[];label:string;
  }|null>(null);
 const openAdjustment=(target: "study" | "translation" | "video" = "study",keys:string[]=[],label= "竞品分析"
  )=>setAdjustment({target,keys,label});
 const [evidence,setEvidence]=useState<{index:number;name:string;
  }|null>(null);
 const raw=readJson(record.rawData)||{}, study=raw.comparisonAnalysis, bullets:string[]=readJson(record.bulletPoints)||[], assets:Asset[]=raw.imageAssets||[];
 const preparedPresentation=applyRichContentEdits(study?.richContent,marks?.edits);
 const studyFields=competitorStudyFields(study,raw.sourceLayout);
 const images=assets.filter(a=>["main","secondary","aplus","brand_story"].includes(a.role)&&a.url), gallery=images.filter(a=>a.role=== "main" ||a.role=== "secondary").sort((a,b)=>a.role===b.role?(a.positionIndex??0)-(b.positionIndex??0):a.role=== "main"
            ?-1:1);
 const layoutImages=images.map((a,i)=>({id:i+1,imageUrl:a.url,sourceUrlHash:a.sourceUrlHash,imagePosition:a.role,contentHash:a.contentHash,imageTranslation:preparedPresentation?.images?.find((t:any)=>t.sourceHash===a.sourceUrlHash),
  }));
 const videos:KnowledgeVideo[]=(raw.videos||[]).map((v:any)=>{const a=assets.find(x=>x.role=== "video" &&x.sourceUrlHash===v.hash&&x.moduleClass===v.moduleId);return {...v,
      analysis: applyVideoEdits(
        study?.videoAnalyses?.find((x: any) => x.hash === v.hash),
        marks?.edits
      ),
      videoUrl:a?.url||null,posterUrl:a?.thumbnailUrl||null,status:a?.url? "ready" : "failed",
    };});
 const aplusSlots=competitorRichSlots(raw.sourceLayout,assets, "aplus"), brandSlots=competitorRichSlots(raw.sourceLayout,assets, "brand_story");
 const counts=rowCounts||{gallery:gallery.length+(videos.some(v=>v.role=== "main")?1:0),bullets:bullets.length,aplus:aplusSlots.length,brand:brandSlots.length,
  };
 const sales=sumVariantPurchases(raw.research,record.asin,raw.manualSales?.value);
 const editable=(key:string,original:string)=>{const edit=marks?.edits?.[key];const value=edit?.original===original?edit.value:original;return (
      <span title="双击编辑" className="cursor-text" onDoubleClick={()=>{const next=window.prompt("编辑分析结果",value);if(next===null)return;if(key.endsWith(":percentage")&&(next.trim()=== "" ||!Number.isFinite(Number(next))||Number(next)<0||Number(next)>100)){window.alert("请输入 0 到 100 的数字");return;}void onMark({type: "edit",key,original,value:next}).catch(()=>{});}}>{value|| "暂无"}</span>
    );};
 const sellingPoints=(key:string,points:string[],categories?:string[],display?:{sellingPoints:string[];sellingPointCategories:string[]})=>{
  const original=points.join("、"),edit=marks?.edits?.[key],edited=edit?.original===original;
  const values=edited?edit.value.split(/[、，,\n]+/).map(v=>v.trim()).filter(Boolean): display?.sellingPoints||points;
  categories=display?.sellingPointCategories||categories;
  const colors:Record<string,string>={
      质量: "border-emerald-200 bg-emerald-50 text-emerald-800",
      设计: "border-amber-200 bg-amber-50 text-amber-800",
      售后: "border-yellow-200 bg-yellow-50 text-yellow-800",
      功能: "border-blue-200 bg-blue-50 text-blue-800",
      场景: "border-violet-200 bg-violet-50 text-violet-800",
    };
  return (
      <div className="flex flex-wrap items-center gap-1.5" title={key? "双击编辑卖点，用顿号分隔" :undefined} onDoubleClick={()=>{if(!key)return;const next=window.prompt(
            "编辑卖点，用顿号分隔",edited?edit.value:values.join("、"));if(next!==null)void onMark({type: "edit",key,original,value:next}).catch(()=>{});}}><span className="text-muted-foreground">主要卖点：</span>{values.length? (
          values.map((point,i)=> (
            <span key={`${i}-${point}`} className={`rounded-full border px-2 py-0.5 ${(!edited&&categories?.[i]&&colors[categories[i]])|| "border-slate-200 bg-white text-slate-700"}`}>
              {point}
            </span>))
        ) : (
          <span className="text-muted-foreground">暂无</span>
        )}
      </div>
    );
 };
 const backgrounds=brandBackgroundHashes(raw.sourceLayout);
 const translationActions=(keys:string[],label:string)=>{
  const fields=studyFields,available=keys.filter(k=>fields[k]!==undefined);
  if(!study||!available.length)return null;
  return (
      <Button size="sm" variant="outline" className="mt-3" onClick={()=>openAdjustment("translation",available,label)}>
        <MessageSquare className="h-4 w-4"/>
        调整结果（AI）
      </Button>
    );
 };

 const importButton=(kind: "image" | "video",hash?:string)=> (
    <Button size="sm" variant="outline" className="mt-3" disabled={addToKnowledge.isPending||!hash} onClick={()=>void add(kind,hash)}>
      {kind=== "image" ? "加入单图图库" : "加入视频库"}
    </Button>
  );
  const videoKey = (v: KnowledgeVideo) =>
    v.hash + ":" + v.role + ":" + v.moduleId;
 const videoPlayer=(video:KnowledgeVideo)=> (
    <div className="min-w-0">
      <KnowledgeVideoPlayer video={video} seek={videoSeeks[videoKey(video)]} />
      {importButton("video",video.hash)}
    </div>
  );
  const videoNotes = (video: KnowledgeVideo, includePoints = true) => {
    const analysis = video.analysis,
      working = ["queued", "running"].includes(record.videoJob?.status || "");
    const prepare = async () => {
      try {
        await prepareVideos.mutateAsync({
          projectId,
          analysisId: record.id,
          retry: true,
        });
        await utils.analysis.listByProject.invalidate({ projectId });
        toast.success("视频字幕与卖点正在后台准备");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "视频准备未完成");
      }
    };
    if (!analysis)
      return (
        <div className="space-y-2 text-xs">
          <p className="text-muted-foreground">
            {raw.videoAnalysisError || "视频字幕与卖点尚未准备"}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={
              working || prepareVideos.isPending || video.status !== "ready"
            }
            onClick={() => void prepare()}
          >
            {working
              ? "正在准备字幕与卖点…"
              : raw.videoAnalysisError
                ? "继续准备字幕与卖点"
                : "准备字幕与卖点"}
          </Button>
        </div>
      );
    const keys = [
      "video:" + video.hash + ":sellingPoints",
      ...analysis.cues.map(
        c => "subtitle:" + video.hash + ":" + c.id + ":translation"
      ),
    ];
    return (
      <div className="space-y-3 text-xs">
        {includePoints &&
          sellingPoints(
            "video:" + video.hash + ":sellingPoints",
            (
              study.videoAnalyses.find((v: any) => v.hash === video.hash)
                ?.sellingPoints || []
            ).map((p: any) => p.text)
          )}
        <details>
          <summary className="cursor-pointer text-primary">
            查看视频卖点证据
          </summary>
          <div className="mt-2 space-y-2">
            {analysis.sellingPoints.flatMap((p, i) =>
              p.moments.slice(0, 2).map((m, j) => (
                <button
                  key={i + ":" + j}
                  type="button"
                  className="block w-full rounded border bg-background p-2 text-left"
                  onClick={() =>
                    setVideoSeeks(old => ({
                      ...old,
                      [videoKey(video)]: {
                        seconds: m.start,
                        nonce: (old[videoKey(video)]?.nonce || 0) + 1,
                      },
                    }))
                  }
                >
                  {Math.floor(m.start)}s · {p.text}
                  <small className="mt-1 block text-muted-foreground">
                    {m.reason}
                  </small>
                </button>
              ))
            )}
          </div>
        </details>
        {includePoints && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              openAdjustment("video", keys, "当前视频的字幕与卖点")
            }
          >
            <MessageSquare className="h-4 w-4" />
            调整结果（AI）
          </Button>
        )}
      </div>
    );
  };
 const imageAnalysis=(hash?:string)=>(study?.images||[]).find((item:any)=>item.hash===hash);
 const imageNotes=(hash?:string)=>{const value=imageAnalysis(hash);return (
      <div className="space-y-2 text-xs leading-relaxed">
        {backgrounds.has(hash|| "")? (
          <p className="text-muted-foreground">品牌故事背景仅作展示</p>
        ) :value&&hash? (
          sellingPoints(`image:${hash}:sellingPoints`,value.sellingPoints,value.sellingPointCategories)
        ) : (
          <p className="text-muted-foreground">卖点分析尚未完成</p>
        )}
        {importButton("image",hash)}
        {!backgrounds.has(hash|| "")&&hash&&translationActions([`image:${hash}:sellingPoints`,...(study?.richContent?.images?.find((t:any)=>t.sourceHash===hash)?.regions||[]).map((_:unknown,i:number)=>`region:${hash}:${i}:translation`),
            ],
            "图片翻译与卖点"
          )}
      </div>
    );};
 const overlay=(hash?:string)=>hash? (
      <button type="button" disabled={busy} onClick={()=>void onMark({type: "image",hash}).catch(()=>{})} aria-label={marks?.likedAssets.includes(hash)? "取消看好图片" : "标记看好图片"
        } aria-pressed={marks?.likedAssets.includes(hash)||false} className={`absolute right-2 top-2 z-10 rounded-full border p-2 shadow-sm ${marks?.likedAssets.includes(hash)? "bg-yellow-300 text-yellow-950" : "bg-white/90 text-slate-500"}`}>
        <Lightbulb size={18}/>
      </button>
    ) :null;
 const renderRich=(slot:RichSlot,section: "aplus" | "brand_story")=>{
   const selected=slot.assets.map(a=>layoutImages.find(i=>i.imageUrl===a.url&&i.sourceUrlHash===a.sourceUrlHash)).filter((v):v is (typeof layoutImages)[number]=>!!v);
   return (
      <AmazonRichContent layout={slot.module?{version:2,modules:[slot.module]}:undefined} images={selected} videos={videos} section={section} presentation={preparedPresentation} onSelect={image=>setPreview(images.find(a=>a.sourceUrlHash===image.sourceUrlHash&&a.url===image.imageUrl)||null)} renderVideo={videoPlayer} renderOverlay={image=>overlay(image.sourceUrlHash||undefined)} renderTagsForAllImages renderTags={(items,selection?:RichSelection)=>{
    const target=selection?.pointTarget,fields=studyFields,key=target&&fields[`module:${target.id}:sellingPoints`]!==undefined?`module:${target.id}:sellingPoints`: "";
    const combined=target?moduleSellingPoints(target,study):{sellingPoints:[],sellingPointCategories:[]};
    const displayed=target?moduleSellingPoints(target,study,marks?.edits):combined;
    const keys=target&&key?moduleAdjustmentKeys(target,study): items.flatMap(image=>{const hash=image.sourceUrlHash;return hash?[`image:${hash}:sellingPoints`,...(study?.richContent?.images?.find((t:any)=>t.sourceHash===hash)?.regions||[]).map((_:unknown,i:number)=>`region:${hash}:${i}:translation`),
                      ]:[];});
    return (
            <div className="space-y-3">
              {sellingPoints(key,combined.sellingPoints,combined.sellingPointCategories,displayed)}
      {items.map((image,i)=> (
                <div key={image.sourceUrlHash||i}>
                  {items.length>1&& (
                    <p className="text-muted-foreground">图片 {i+1}</p>
                  )}
                  {importButton("image",image.sourceUrlHash||undefined)}
                </div>
              ))}
              {(target?.videoHashes || []).map(hash => {
                const v = videos.find(
                  v => v.hash === hash && v.moduleId === target?.moduleId
                );
                return v ? <div key={hash}>{videoNotes(v, false)}</div> : null;
              })}
      {translationActions(keys,section=== "brand_story" ? "当前品牌故事卡片" : "当前 A+ 模块"
              )}
    </div>
          );

   }}/>
    );
 };
 function markSelection(event:React.MouseEvent<HTMLParagraphElement>,bulletIndex:number){
  if(!marker)return;const selection=window.getSelection();if(!selection||selection.isCollapsed||!selection.rangeCount)return;
  const element = event.currentTarget.querySelector("[data-bullet-source]");
  const range = selection.getRangeAt(0).cloneRange();
  if (!element || !range.intersectsNode(element)) return;
  if (!element.contains(range.startContainer)) range.setStart(element, 0);
  if (!element.contains(range.endContainer)) range.setEnd(element, element.childNodes.length);
  const before = range.cloneRange();
  before.selectNodeContents(element);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length, text = range.toString();
  if (!text.trim()) return;
  void onMark({type: "highlight",bulletIndex,start,end:start+text.length,text,
    }).catch(()=>{});selection.removeAllRanges();
 }
 const galleryMedia: Array<{kind: "image";asset:Asset}|{kind: "video";video:KnowledgeVideo}>=gallery.map(asset=>({kind: "image",asset}));
 const mainVideo=videos.find(video=>video.role=== "main");
 if(mainVideo)galleryMedia.splice(Math.min(mainVideo.position,galleryMedia.length),0,{kind: "video",video:mainVideo,
    });
 return (
    <article className="min-w-0 grid rounded-xl border bg-background text-sm" style={{gridColumn:columnIndex===undefined?undefined:columnIndex+1,gridRow:rowCounts?`1 / span ${8+counts.gallery+counts.bullets+counts.aplus+counts.brand}`:undefined,gridTemplateRows:rowCounts? "subgrid" :undefined,
      }} data-testid="competitor-study-column">
  <header className="border-b p-4">
        <div className="flex items-start justify-between gap-3">
          <strong>{record.asin}</strong>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={addToKnowledge.isPending} onClick={()=>void add("set")}>
              整套加入 ASIN 集
            </Button>
            {onReanalyze&& (
              <Button size="sm" variant="outline" disabled={busy||["queued", "running"].includes(record.presentationJob?.status)} onClick={()=>void onReanalyze()}>
                重新分析
              </Button>
            )}
          </div>
        </div>
        <p className="mt-1 font-medium">{record.title|| "未采到标题"}</p>
        {study?.listing&& (
          <p className="mt-1 text-xs text-muted-foreground">
            {editable("title:translation",study.listing.titleTranslation)}
          </p>
        )}
        <p className="mt-2">
          {raw.brand|| "品牌未采到"} · {record.price|| "价格未采到"} ·{" "}
          <ReviewStars rating={record.rating==null?null:Number(record.rating)}/>{" "}
          {record.reviewCount|| "未知"} 条 · 月销量{" "}
          {sales.value===null? "未采到"
            :`${sales.value}${sales.lowerBound? "+" : ""}`}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">双击分析内容可编辑</p>
        {raw.analysisQueueError&& (
          <p role="alert" className="text-destructive">
            {raw.analysisQueueError}
          </p>
        )}
        {record.presentationJob?.status=== "failed" && (
          <p role="alert" className="text-destructive">
            分析未完成，请点击重新分析。
          </p>
        )}
        {["queued", "running"].includes(record.presentationJob?.status)&& (
          <p>正在分析 {record.presentationJob?.progress||0}%</p>
        )}
      </header>
  <h3 className="border-b px-4 py-3 font-semibold">商品图片</h3>
  {Array.from({length:counts.gallery},(_,i)=>{const item=galleryMedia[i];return (
          <section key={`gallery-${i}`} className="min-w-0 border-b p-4" data-testid={`gallery-row-${i}`}>
            {item? (
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_170px]">
                <div className={item.kind=== "video"
                      ? "relative min-w-0 self-start rounded-lg bg-slate-50"
                      : "relative flex h-80 items-center justify-center rounded-lg bg-slate-50"
                  }
                >
                  {item.kind === "image" ? (
                    <>
                      <PreparedImage src={item.asset.url} alt={`商品图片 ${i+1}`} sourceHash={item.asset.sourceUrlHash} contentHash={item.asset.contentHash} translation={preparedPresentation?.images?.find((t:any)=>t.sourceHash===item.asset.sourceUrlHash)} className="h-full w-full" imageClassName="h-full w-full" onOpen={()=>setPreview(item.asset)}/>
                      {overlay(item.asset.sourceUrlHash)}
                    </>
                  ) : (
                    <div className="w-full">{videoPlayer(item.video)}</div>
                  )}
                </div>
                <div>
                  {item.kind=== "image" ? (
                    imageNotes(item.asset.sourceUrlHash)
                  ) : (
                    <div className="max-h-[480px] space-y-3 overflow-y-auto rounded-lg bg-slate-50 p-3">
                      {videoNotes(item.video)}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                此位置没有商品图片
              </p>
            )}
          </section>
        );})}
  <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="font-semibold">五点描述</h3>
        <Button size="sm" variant={marker? "default" : "outline"} aria-pressed={marker} onClick={()=>setMarker(!marker)}>
          <Highlighter size={16}/> {marker? "标记中" : "标记重点"}
        </Button>
      </div>
  {Array.from({length:counts.bullets},(_,i)=>{const text=bullets[i],bullet=study?.listing?.bullets?.find((b:any)=>b.index===i);return (
          <section key={`bullet-${i}`} className="border-b p-4" data-testid={`bullet-row-${i}`}>
            {text? (
              <>
                <p className="select-text" onMouseUp={e=>markSelection(e,i)}>
                  <strong>{i+1}. </strong>
                  <span data-bullet-source><Highlighted text={text} ranges={(marks?.highlights||[]).filter(x=>x.bulletIndex===i)}/></span>
                </p>
                {bullet&& (
                  <div className="mt-1 space-y-2 rounded bg-slate-50 p-2 text-xs">
                    <p>
                      内容翻译：
                      {editable(`bullet:${i}:translation`,bullet.translation)}
                    </p>
                    {sellingPoints(`bullet:${i}:sellingPoints`,bullet.sellingPoints,bullet.sellingPointCategories)}
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                此位置没有五点内容
              </p>
            )}
          </section>
        );})}
  <h3 className="border-b px-4 py-3 font-semibold">A+ 内容</h3>
  {Array.from({length:counts.aplus},(_,i)=> (
        <section key={`aplus-${i}`} className="min-w-0 border-b p-4" data-testid={`aplus-row-${i}`}>
          {aplusSlots[i]? (
            renderRich(aplusSlots[i], "aplus")
          ): (
            <p className="text-xs text-muted-foreground">此位置没有 A+ 模块</p>
          )}
        </section>
      ))}
  <h3 className="border-b px-4 py-3 font-semibold">品牌故事</h3>
  {Array.from({length:counts.brand},(_,i)=> (
        <section key={`brand-${i}`} className="min-w-0 border-b p-4" data-testid={`brand-row-${i}`}>
          {brandSlots[i]? (
            renderRich(brandSlots[i], "brand_story")
          ): (
            <p className="text-xs text-muted-foreground">
              此位置没有品牌故事模块
            </p>
          )}
        </section>
      ))}
  <section className="border-b p-4">
        <h3 className="font-semibold">评论对比</h3>
        <p className="mt-2 text-sm">
          <ReviewStars rating={record.rating==null?null:Number(record.rating)}/>{" "}
          · 亚马逊评分数量 {record.reviewCount|| "未采到"}
        </p>
        <div className="mt-3 rounded-lg bg-muted/40 p-3">
          <h4 className="font-medium">Customers say</h4>
          {raw.research?.customersSay?.summary? (
            <>
              <p className="mt-1 whitespace-pre-wrap">
                {raw.research.customersSay.summary}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                亚马逊页面提供的评论摘要
              </p>
              {raw.research.customersSay.aspects?.length>0&& (
                <div className="mt-2 flex flex-wrap gap-2">
                  {raw.research.customersSay.aspects.map((aspect:any,i:number)=> (
                      <span key={i} className="rounded-full bg-background px-2 py-1 text-xs">
                        {aspect.label}
                        {aspect.mentions!=null?` (${aspect.mentions})`: ""}
                      </span>)
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              未采集到亚马逊评论摘要
            </p>
          )}
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-primary">
            展开已采集评论
          </summary>
          <ListingReviewList projectId={projectId} asin={record.asin} page={page} onPage={setPage}/>
        </details>
      </section>
  <section className="border-b p-4">
        <h3 className="font-semibold">评论分析</h3>
        {study?.reviewVersion===2? (
          <>
            <p className="text-xs text-muted-foreground">已分析 {study.reviewSampleCount}{" "}
              条有星级评论，比例以这些评论为基数
              {study.reviewUnratedCount?`；另有 ${study.reviewUnratedCount} 条缺少有效星级，未纳入统计`: ""}
              。
            </p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              {(["positive", "negative"] as const).map(kind=> (
                <div key={kind} className="rounded-lg border p-3">
                  <h4 className="font-medium">
                    {kind=== "positive" ? "主要好评" : "主要差评"}（
                    {study.reviewSentimentCounts[kind]} 条）
                  </h4>
                  {(study.reviews||[]).map((g:any,i:number)=>g.sentiment===kind && g.count !== 0 ? (
                      <div key={i} className="mt-3">
                        <div className="flex flex-wrap items-center gap-1">
                          {editable(`review:${i}:name`,g.name)} ·{" "}
                          {g.percentage}%
                          <Button size="sm" variant="outline" onClick={()=>setEvidence({index:i,name:g.name})}>
                            证据
                          </Button>
                        </div>
                        <small className="block text-muted-foreground">
                          {editable(`review:${i}:reason`,g.reason)}
                        </small>
                      </div>) : null
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            请重新分析此 ASIN，以按星级归纳评价点并查看评论证据。
          </p>
        )}
      </section>
  <div className="p-4">
        {study&& (
          <Button variant="outline" onClick={()=>openAdjustment()}>
            <MessageSquare className="h-4 w-4"/>
            调整结果（AI）
          </Button>
        )}
      </div>
  {evidence&&study?.reviewVersion===2&& (
        <ReviewEvidenceDialog key={`${study.generatedAt}:${evidence.index}`} projectId={projectId} analysisId={record.id} groupIndex={evidence.index} generatedAt={study.generatedAt} name={evidence.name} onClose={()=>setEvidence(null)}/>
      )}
  {adjustment&& (
        <CompetitorAdjustmentDialog projectId={projectId} analysisId={record.id} target={adjustment.target} fieldKeys={adjustment.keys} label={adjustment.label} study={study} layout={raw.sourceLayout} edits={marks?.edits} onClose={()=>setAdjustment(null)}/>
      )}
  <Dialog open={!!preview} onOpenChange={open=>{if(!open)setPreview(null);}}>
        <DialogContent className="max-h-[96vh] max-w-[96vw] overflow-auto" aria-describedby={undefined}>
          <DialogTitle>竞品图片 · {record.asin}</DialogTitle>
          {preview&& (
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_230px]">
              <PreparedImage src={preview.url} alt="竞品图片原图" sourceHash={preview.sourceUrlHash} contentHash={preview.contentHash} translation={preparedPresentation?.images?.find((t:any)=>t.sourceHash===preview.sourceUrlHash)} controls={!backgrounds.has(preview.sourceUrlHash|| "")} imageClassName="mx-auto block h-auto max-h-[82vh] max-w-full" loading="eager" expandable={false}/>
              <aside>{imageNotes(preview.sourceUrlHash)}</aside>
            </div>
          )}
        </DialogContent>
      </Dialog>
 </article>
  );
}
