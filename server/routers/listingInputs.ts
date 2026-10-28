import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { and, eq, sql, desc } from 'drizzle-orm';
import { router } from '../_core/trpc';
import { protectedProcedure } from '../domains/listing/listingProcedure';
import * as repository from '../repositories';
import { requireDb } from '../repositories/dbClient';
import { competitorAnalyses, listingSupplementalReviews, listingUploadedFiles } from '../../drizzle/schema/project';
import { parseProductQuestions, mergeProductQuestions, matchQuestionBrand, type ProductQuestion } from '../domains/listing/productQuestions';
import { parseReviewWorkbook, readSpreadsheetWorkbook } from '../reviewParser';
import { readJson } from '../../shared/competitorPresentation';
import { matchReviewAsin, normalizeImportedReview, reviewKey } from '../domains/listing/supplementalReviews';
import { getAiJobRun } from '../services/aiJobRunner';
import { hydrateCompetitorEvidence } from '../domains/listing/competitorPresentation';

import { trackedUpload } from '../domains/listing/uploadHistory';

const projectInput = z.object({projectId:z.number().int().positive()});
const uploadInput = projectInput.extend({filename:z.string().min(1).max(500),base64:z.string().max(15_000_000)});
async function project(ctx:any,id:number) {
  const p=await repository.getProjectById(id,ctx.user.id,ctx.workspaceId);
  if(!p || p.workspaceId!==ctx.workspaceId) throw new TRPCError({code: 'BAD_REQUEST', message: '项目不可访问'});
  return p;
}
function workbook(input:{base64:string;filename:string}) {
  if(!/\.(xlsx|xls|csv)$/i.test(input.filename))throw new TRPCError({code: 'BAD_REQUEST', message: '请上传 XLSX、XLS 或 CSV 表格'});
  const buffer=Buffer.from(input.base64,'base64');
  if(buffer.length>10*1024*1024)throw new TRPCError({code: 'BAD_REQUEST', message: '单个文件不能超过 10MB'});
  return readSpreadsheetWorkbook(buffer,input.filename);
}
export const listingInputsRouter=router({
  calibrateSales:protectedProcedure.input(projectInput.extend({asin:z.string().regex(/^[A-Z0-9]{10}$/),value:z.number().int().min(0).max(1_000_000_000).nullable()})).mutation(async({ctx,input})=>{
    await project(ctx,input.projectId);const db=await requireDb('calibrate Listing sales');
    return db.transaction(async tx=>{
      const [record]=await tx.select().from(competitorAnalyses).where(and(eq(competitorAnalyses.projectId,input.projectId),eq(competitorAnalyses.asin,input.asin))).for('update');
      if(!record)throw new TRPCError({code:'BAD_REQUEST',message:'请先检查并保存抓取结果'});
      const raw=readJson(record.rawData)||{};
      if(raw.presentationJobRunId){const job=await getAiJobRun(raw.presentationJobRunId);if(job&&['queued','running'].includes(job.status))throw new TRPCError({code:'BAD_REQUEST',message:'正在分析，请完成后再校准销量'});}
      if(input.value===null)delete raw.manualSales;else raw.manualSales={value:input.value,updatedAt:new Date().toISOString(),updatedBy:ctx.user.id};
      await tx.update(competitorAnalyses).set({rawData:JSON.stringify({...raw,analysisStale:true})}).where(eq(competitorAnalyses.id,record.id));
      return {saved:true};
    });
  }),
  files:protectedProcedure.input(projectInput).query(async({ctx,input})=>{
    await project(ctx,input.projectId);const db=await requireDb('list uploaded files');
    return db.select({id:listingUploadedFiles.id,filename:listingUploadedFiles.filename,kind:listingUploadedFiles.kind,status:listingUploadedFiles.status,size:listingUploadedFiles.size,error:listingUploadedFiles.error,result:listingUploadedFiles.resultJson,createdAt:listingUploadedFiles.createdAt}).from(listingUploadedFiles).where(eq(listingUploadedFiles.projectId,input.projectId)).orderBy(desc(listingUploadedFiles.id));
  }),
  downloadFile:protectedProcedure.input(projectInput.extend({id:z.number().int().positive()})).query(async({ctx,input})=>{
    await project(ctx,input.projectId);const db=await requireDb('download uploaded file');
    const [file]=await db.select({filename:listingUploadedFiles.filename,base64:listingUploadedFiles.originalBase64}).from(listingUploadedFiles).where(and(eq(listingUploadedFiles.id,input.id),eq(listingUploadedFiles.projectId,input.projectId)));
    if(!file)throw new TRPCError({code:'NOT_FOUND',message:'文件已删除或不可访问'});return file;
  }),
  deleteFile:protectedProcedure.input(projectInput.extend({id:z.number().int().positive()})).mutation(async({ctx,input})=>{
    await project(ctx,input.projectId);const db=await requireDb('delete uploaded file');
    return db.transaction(async tx=>{
      const where=and(eq(listingUploadedFiles.id,input.id),eq(listingUploadedFiles.projectId,input.projectId));
      const [file]=await tx.select({status:listingUploadedFiles.status,updatedAt:listingUploadedFiles.updatedAt}).from(listingUploadedFiles).where(where).for('update');
      if(file?.status==='processing'&&Date.now()-file.updatedAt.getTime()<15*60*1000)throw new TRPCError({code:'BAD_REQUEST',message:'文件正在处理，请完成后再删除'});
      await tx.delete(listingUploadedFiles).where(where);return {deleted:true};
    });
  }),
  uploadAttributes:protectedProcedure.input(uploadInput).mutation(async({ctx,input})=>{
    await project(ctx,input.projectId);
    return trackedUpload(input,'attributes',async()=>{
      const book=workbook(input),data=XLSX.utils.sheet_to_json<Record<string,unknown>>(book.Sheets[book.SheetNames[0]]);
      const rows=data.map(r=>({name:String(r['属性']??r['属性名称']??r.Attribute??'').trim(),value:String(r['内容']??r['属性值']??r.Value??'')})).filter(r=>r.name);
      if(!rows.length||rows.length>100||rows.some(r=>r.name.length>120||r.value.length>2000))throw new TRPCError({code:'BAD_REQUEST',message:'请使用属性模板填写，最多 100 项属性'});
      if(new Set(rows.map(r=>r.name)).size!==rows.length)throw new TRPCError({code:'BAD_REQUEST',message:'属性名称不能重复'});
      const specs=JSON.stringify(Object.fromEntries(rows.map(r=>[r.name,r.value])));
      if(Buffer.byteLength(specs)>50000)throw new TRPCError({code:'BAD_REQUEST',message:'属性内容过长'});
      await repository.updateProject(input.projectId,ctx.user.id,{productSpecs:specs});
      return {inserted:rows.length,duplicates:0,matches:['本品属性已更新']};
    });
  }),

  uploadReviews:protectedProcedure.input(uploadInput).mutation(async({ctx,input})=>{
    await project(ctx,input.projectId);
    return trackedUpload(input,'reviews',async()=>{
    const book=workbook(input);
    const reviews=parseReviewWorkbook(book);
    if(!reviews.length)throw new TRPCError({code: 'BAD_REQUEST', message: '未识别到评论正文，请检查“评论内容 / Review Content”列'});
    if(reviews.length>20000)throw new TRPCError({code: 'BAD_REQUEST', message: '单个文件最多 20000 条评论，请拆分后上传'});
    const records=await Promise.all((await repository.getCompetitorAnalysesByProject(input.projectId)).map(r=>hydrateCompetitorEvidence(r,ctx.workspaceId!)));
    const groups=new Map<number,{record:any;items:ReturnType<typeof normalizeImportedReview>[]}>();
    for(const r of reviews){const record=matchReviewAsin(r.asin,input.filename,records);if(!groups.has(record.id))groups.set(record.id,{record,items:[]});groups.get(record.id)!.items.push(normalizeImportedReview(r));}
    const db=await requireDb('import Listing reviews');
    const result=await db.transaction(async tx=>{
      let inserted=0;const matches:string[]=[];
      for(const [id,group] of [...groups].sort((a,b)=>a[0]-b[0])){
        const [record]=await tx.select().from(competitorAnalyses).where(and(eq(competitorAnalyses.id,id),eq(competitorAnalyses.projectId,input.projectId))).for('update');
        if(!record)throw new TRPCError({code: 'BAD_REQUEST', message: '竞品已删除，请刷新后重试'});
        const raw=readJson((await hydrateCompetitorEvidence(record,ctx.workspaceId!)).rawData)||{};
        if(raw.presentationJobRunId){const job=await getAiJobRun(raw.presentationJobRunId);if(job&&['queued','running'].includes(job.status))throw new TRPCError({code: 'BAD_REQUEST', message: `${record.asin} 正在分析，请完成后再补充评论`});}
        const existing=await tx.select({hash:listingSupplementalReviews.reviewHash}).from(listingSupplementalReviews).where(and(eq(listingSupplementalReviews.projectId,input.projectId),eq(listingSupplementalReviews.asin,record.asin)));
        const keys=new Set([...existing.map(r=>r.hash),...(raw.research?.reviews||[]).map(reviewKey)]);
        const added=group.items.filter(r=>{const key=reviewKey(r);if(keys.has(key))return false;keys.add(key);return true;});
        for(let i=0;i<added.length;i+=100)await tx.insert(listingSupplementalReviews).values(added.slice(i,i+100).map(r=>({projectId:input.projectId,asin:record.asin,reviewHash:reviewKey(r),reviewJson:JSON.stringify(r),filename:input.filename})));
        if(added.length)await tx.update(competitorAnalyses).set({rawData:JSON.stringify({...raw,supplementalReviewRevision:Date.now(),supplementalReviewCount:existing.length+added.length,analysisStale:!!record.aiSummary})}).where(eq(competitorAnalyses.id,id));
        inserted+=added.length;matches.push(`${record.asin}：新增 ${added.length} 条`);
      }
      return {inserted,duplicates:reviews.length-inserted,matches};
    });return result;
    });
  }),
  reviews:protectedProcedure.input(projectInput.extend({asin:z.string().regex(/^[A-Z0-9]{10}$/),page:z.number().int().min(1).default(1),pageSize:z.number().int().min(1).max(50).default(10)})).query(async({ctx,input})=>{
    await project(ctx,input.projectId);
    const record=(await repository.getCompetitorAnalysesByProject(input.projectId)).find(r=>r.asin===input.asin);
    if(!record)return {items:[],total:0,imported:0};
    const raw=readJson((await hydrateCompetitorEvidence(record,ctx.workspaceId!)).rawData)||{};
    const base:any[]=raw.research?.reviews||[];
    const db=await requireDb('list supplemental reviews');
    const where=and(eq(listingSupplementalReviews.projectId,input.projectId),eq(listingSupplementalReviews.asin,input.asin));
    const [count]=await db.select({n:sql<number>`count(*)`}).from(listingSupplementalReviews).where(where);
    const start=(input.page-1)*input.pageSize;
    const items=base.slice(start,start+input.pageSize);
    if(items.length<input.pageSize){const more=await db.select().from(listingSupplementalReviews).where(where).orderBy(listingSupplementalReviews.id).limit(input.pageSize-items.length).offset(Math.max(0,start-base.length));items.push(...more.map(r=>({...JSON.parse(r.reviewJson),filename:r.filename})));}
    return {items,total:base.length+Number(count.n),imported:Number(count.n)};
  }),
  attributes:protectedProcedure.input(projectInput).query(async({ctx,input})=>{const p=await project(ctx,input.projectId);const specs=readJson(p.productSpecs);return Object.entries(specs&&typeof specs==='object'&&!Array.isArray(specs)?specs:{}).map(([name,value])=>({name,value:String(value??'')}));}),
  saveAttributes:protectedProcedure.input(projectInput.extend({rows:z.array(z.object({name:z.string().trim().min(1).max(120),value:z.string().max(2000)})).max(100)})).mutation(async({ctx,input})=>{
    await project(ctx,input.projectId);
    const names=input.rows.map(r=>r.name);if(new Set(names).size!==names.length)throw new TRPCError({code: 'BAD_REQUEST', message: '属性名称不能重复'});
    const specs=Object.fromEntries(input.rows.map(r=>[r.name,r.value]));
    if(Buffer.byteLength(JSON.stringify(specs))>50000)throw new TRPCError({code: 'BAD_REQUEST', message: '属性内容过长'});
    await repository.updateProject(input.projectId,ctx.user.id,{productSpecs:JSON.stringify(specs)});return {saved:input.rows.length};
  }),
  questions:protectedProcedure.input(projectInput.extend({asin:z.string().regex(/^[A-Z0-9]{10}$/)})).query(async({ctx,input})=>{
    await project(ctx,input.projectId);
    const record=(await repository.getCompetitorAnalysesByProject(input.projectId)).find(r=>r.asin===input.asin);
    return (readJson(record?.rawData)?.productQuestions||[]) as ProductQuestion[];
  }),
  uploadQuestions:protectedProcedure.input(uploadInput.extend({targetAsin:z.string().regex(/^[A-Z0-9]{10}$/).optional()})).mutation(async({ctx,input})=>{
    await project(ctx,input.projectId);
    return trackedUpload(input,'questions',async()=>{
    const questions=parseProductQuestions(workbook(input));
    if(!questions.length)throw new TRPCError({code:'BAD_REQUEST',message:'未识别到 Alexa 问题或 Follow up question 列'});
    if(questions.length>5000||questions.some(q=>q.question.length>8000))throw new TRPCError({code:'BAD_REQUEST',message:'问题数量或长度超出限制'});
    const records=await Promise.all((await repository.getCompetitorAnalysesByProject(input.projectId)).map(r=>hydrateCompetitorEvidence(r,ctx.workspaceId!)));
    const brandAsin=/(?<![A-Z0-9])[A-Z0-9]{10}(?![A-Z0-9])/i.test(input.filename)?undefined:matchQuestionBrand(questions,records.map(r=>({asin:r.asin,brand:readJson(r.rawData)?.brand||readJson(r.rawData)?.scrapedData?.brand})));
    const groups=new Map<number,ProductQuestion[]>();
    for(const {asin,...q} of questions){const record=matchReviewAsin(asin||input.targetAsin||brandAsin,input.filename,records);if(!groups.has(record.id))groups.set(record.id,[]);groups.get(record.id)!.push(q);}
    const db=await requireDb('import ASIN Alexa questions');
    return db.transaction(async tx=>{
      let inserted=0;const matches:string[]=[];
      for(const [id,items] of [...groups].sort((a,b)=>a[0]-b[0])){
        const [record]=await tx.select().from(competitorAnalyses).where(and(eq(competitorAnalyses.id,id),eq(competitorAnalyses.projectId,input.projectId))).for('update');
        if(!record)throw new TRPCError({code:'BAD_REQUEST',message:'竞品已删除，请刷新后重试'});
        const raw=readJson(record.rawData)||{};
        if(raw.presentationJobRunId){const job=await getAiJobRun(raw.presentationJobRunId);if(job&&['queued','running'].includes(job.status))throw new TRPCError({code:'BAD_REQUEST',message:`${record.asin} 正在分析，请完成后再上传问题`});}
        const old=raw.productQuestions||[],merged=mergeProductQuestions(old,items);
        const added=merged.length-old.length;
        if(Buffer.byteLength(JSON.stringify(merged))>3_000_000)throw new TRPCError({code:'BAD_REQUEST',message:'该产品的问题内容过多，请拆分精简后上传'});
        if(added)await tx.update(competitorAnalyses).set({rawData:JSON.stringify({...raw,productQuestions:merged,analysisStale:!!record.aiSummary})}).where(eq(competitorAnalyses.id,id));
        inserted+=added;matches.push(`${record.asin}：新增 ${added} 条问题`);
      }
      return {inserted,duplicates:questions.length-inserted,matches};
    });
    });
  }),
});
