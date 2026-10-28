import { z } from 'zod';
import { runEmperorSkill,safeParseSkillJSON } from '../ai_os/services/skillRunner';
import { resolveStoredObjectUrl } from '../../storage';
import { mergeImportedReviews } from './supplementalReviews';
import { OverallStudy,DEEP_SKILLS,validateTitle,validateSelling,validateBuyerBatch,mergeBuyerGroups } from '../../../shared/competitorDeepAnalysis';

export async function analyzeCompetitorDeep(input:{userId:number;workspaceId:number;data:any;raw:any;assets:any[];imported:any[];signal?:AbortSignal;onProgress?:(n:number)=>Promise<unknown>}){
 const {data,raw}=input;
 const run=async<T>(stage:number,context:any,validate:(v:unknown)=>T,attachments?:any[])=>{
  input.signal?.throwIfAborted();const text=JSON.stringify(context);
  let correction='';
  for(let attempt=0;attempt<2;attempt++){
   try{const prompt=text+correction;const result=await runEmperorSkill<T>({skillSlug:DEEP_SKILLS[stage].slug,userId:input.userId,workspaceId:input.workspaceId,context:prompt,variables:{context:prompt},attachments,signal:input.signal,validate:content=>validate(safeParseSkillJSON(content))});return result.parsed;}
   catch(e:any){const reason=e?.cause?.cause?.message||e?.cause?.message||e?.message||'分析失败';if(e?.cause?.code==='INVALID_OUTPUT'&&attempt===0){correction=`\n上次输出未通过检查：${reason}。请严格遵守JSON结构并仅引用输入中的原文和ID。`;continue;}throw new Error(`${DEEP_SKILLS[stage].name}失败：${reason}`);}
  }
  throw new Error('分析未完成');
 };
 const common={asin:data.asin,brand:data.brand,price:data.price,sales:raw.manualSales||data.research?.purchaseBadge,title:data.title,subtitle:data.subtitle||raw.subtitle||'',bulletPoints:data.bulletPoints};
 const title=await run(0,common,v=>validateTitle(v,common.title||'',common.subtitle));
 await input.onProgress?.(20);
 const sources:Array<{id:string;text:string;role?:string}>=[{id:'标题',text:data.title||''},{id:'副标题',text:common.subtitle},...data.bulletPoints.map((text:string,i:number)=>({id:`五行第${i+1}条`,text}))].filter(s=>s.text);
 const counts:Record<string,number>={};
 const images=input.assets.filter(a=>['main','secondary','aplus','brand_story'].includes(a.role)).map(a=>{const group=['main','secondary'].includes(a.role)?'gallery':a.role;counts[group]=(counts[group]||0)+1;return {...a,id:`${group==='gallery'?'主副图':group==='aplus'?'A+':'品牌故事'}第${counts[group]}张`};});
 for(let i=0;i<images.length;i+=4){const batch=images.slice(i,i+4);const attachments=await Promise.all(batch.map(async a=>({type:'image_url',image_url:{url:await resolveStoredObjectUrl(a.storageKey)}})));
  const read=await run(1,{mode:'image',asin:data.asin,images:batch.map(a=>({sourceId:a.id,role:a.role})),instruction:'附件顺序与images相同。每个图片必须返回一项；无法读出的图片text写明无法读取，不猜测。'},v=>{const r=z.object({images:z.array(z.object({sourceId:z.string(),text:z.string()}))}).parse(v);if(r.images.length!==batch.length||new Set(r.images.map(x=>x.sourceId)).size!==batch.length||r.images.some(x=>!batch.some(a=>a.id===x.sourceId)))throw new Error('图片分析存在遗漏');return r;},attachments);
  sources.push(...read.images.map(x=>({id:x.sourceId,text:x.text,role:batch.find(a=>a.id===x.sourceId)!.role})));await input.onProgress?.(20+Math.round((i+batch.length)/Math.max(1,images.length)*25));
 }
 const selling=await run(1,{mode:'selling',...common,titleAnalysis:title,sources},v=>validateSelling(v,sources));
 const reviews=mergeImportedReviews(data.research?.reviews||[],input.imported).filter(r=>String(r.body||r.content||r.title||'').trim()).map((r,i)=>({...r,id:`R${i+1}`,body:r.body||r.content||''}));
 const themes:any[]=[];
 for(let offset=0;offset<reviews.length;){const batch:any[]=[];let chars=0;while(offset<reviews.length&&batch.length<60&&(chars+JSON.stringify(reviews[offset]).length<24000||!batch.length)){const r=reviews[offset++];batch.push(r);chars+=JSON.stringify(r).length;}
  const report=await run(2,{mode:'reviews',asin:data.asin,reviews:batch},v=>validateBuyerBatch(v,batch.map(r=>r.id)));themes.push(...report.themes.map(t=>({...t,id:`T${themes.length+report.themes.indexOf(t)+1}`})));await input.onProgress?.(45+Math.round(offset/reviews.length*30));
 }
 const questions=(raw.productQuestions||[]).map((q:any,i:number)=>({...q,id:`Q${i+1}`}));
 const buyers=await run(2,{mode:'synthesis',...common,questions,themes:themes.map(({id,name,sentiment,reviewIds})=>({id,name,sentiment,count:reviewIds.length})),instruction:'所有主题都必须恰好分配一次。可合并同义主题。'},v=>mergeBuyerGroups(v,themes,reviews,questions));
 await input.onProgress?.(82);
 const summary=await run(3,{...common,title,selling,buyers},v=>OverallStudy.parse(v));
 return {version:1,generatedAt:new Date().toISOString(),title,selling:{...selling,points:selling.points.map(p=>({...p,frequency:p.occurrences.filter(o=>!o.sourceId.startsWith('品牌故事')).length})),imageCount:images.length},buyers,summary};
}
