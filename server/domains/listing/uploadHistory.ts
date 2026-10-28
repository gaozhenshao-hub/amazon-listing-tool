import {createHash} from 'node:crypto';
import {and,eq} from 'drizzle-orm';
import {TRPCError} from '@trpc/server';
import {listingUploadedFiles as files,projects} from '../../../drizzle/schema/project';
import {requireDb} from '../../repositories/dbClient';
type Result={inserted:number;duplicates:number;matches:string[];duplicateFile?:boolean};
export async function trackedUpload(input:{projectId:number;filename:string;base64:string},kind:string,run:()=>Promise<Result>):Promise<Result>{
 const buffer=Buffer.from(input.base64,'base64');
 if(!buffer.length||buffer.length>10*1024*1024||!/\.(xlsx|xls|csv)$/i.test(input.filename))throw new TRPCError({code:'BAD_REQUEST',message:'请上传不超过 10MB 的 XLSX、XLS 或 CSV 文件'});
 const db=await requireDb('Listing upload history');
 const contentHash=createHash('sha256').update(buffer).digest('hex');
 const reservation=await db.transaction(async tx=>{
  await tx.select({id:projects.id}).from(projects).where(eq(projects.id,input.projectId)).for('update');
  const [old]=await tx.select({id:files.id,status:files.status,result:files.resultJson,updatedAt:files.updatedAt}).from(files).where(and(eq(files.projectId,input.projectId),eq(files.kind,kind),eq(files.contentHash,contentHash))).for('update');
  if(old&&(old.status==='success'||old.status==='processing'&&Date.now()-old.updatedAt.getTime()<15*60*1000))return {duplicate:old,id:old.id};
  if(old){await tx.update(files).set({status:'processing',error:null,updatedAt:new Date()}).where(eq(files.id,old.id));return {id:old.id};}
  const [row]=await tx.insert(files).values({projectId:input.projectId,kind,filename:input.filename,contentHash,size:buffer.length,originalBase64:buffer.toString('base64'),status:'processing'});
  return {id:row.insertId};
 });
 if(reservation.duplicate){const result=JSON.parse(reservation.duplicate.result||'{}');return {inserted:0,duplicates:(result.inserted||0)+(result.duplicates||0),matches:['重复文件：已上传过相同内容，未重复导入'],duplicateFile:true};}
 try{const result=await run();await db.update(files).set({status:'success',resultJson:JSON.stringify(result),error:null}).where(eq(files.id,reservation.id));return result;}
 catch(e){await db.update(files).set({status:'failed',error:(e instanceof Error?e.message:'上传失败').slice(0,2000)}).where(eq(files.id,reservation.id));throw e;}
}
