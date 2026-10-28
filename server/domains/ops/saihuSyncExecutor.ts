import mysql from 'mysql2/promise';
import {syncInventory} from './inventorySync';
import {captureNorthAmericaBoard} from './northAmericaBoardArchive';
import {readNorthAmericaFinancialSources} from './northAmericaBoardSources';
import {normalizeMarketplaceCode} from '../../../shared/marketplaceIdentity';
import {randomInt,createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {drizzle} from 'drizzle-orm/mysql2';
import {desc,eq,getTableColumns} from 'drizzle-orm';
import {dataImports,saihuProductWeekly} from '../../../drizzle/schema';
import {decryptToolSecretValue,encryptToolSecretValue} from '../ai_os/services/toolGateway/governanceCore';
import {assertSaihuOrigin,fetchSaihuToken,signSaihu,SaihuApiError,requestSaihuHttp} from './saihuClient';
import {nextSaihuRun,saihuSyncPeriod,saihuPeriodDays} from '../../../shared/saihuSchedule';
import {scheduleFromRow} from './saihuScheduleService';
import {mapSaihuDailyApi,dailyApiIdentity,hasDailyActivity} from './productOverview/saihuDailyApi';
import {mapSaihuMonthlyProfit} from './productOverview/saihuMonthlyProfit';
import {selectSaihuFacts} from './productOverview/saihuDaily';
const parse=(v:any)=>typeof v==='string'?JSON.parse(v):v;
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
// These two production legacy columns are not part of the merged ORM model.
// Keep them explicit so a daily sync can never silently become a weekly row.
const dailyColumns:Record<string,any>={...getTableColumns(saihuProductWeekly),reportDate:{name:'report_date'},reportLevel:{name:'report_level'}};
export async function loadLegacySaihuFacts(conn:mysql.Connection,workspace:number,scope?:{start:string;end:string}|{importId:number}):Promise<any[]> {
 const projection=Object.entries(dailyColumns).map(([key,column])=>`\`${column.name}\` AS \`${key}\``).join(',');
 const filter=scope?('importId' in scope?' AND import_id=?':' AND report_date BETWEEN ? AND ?'):'';
 const values=scope?('importId' in scope?[scope.importId]:[scope.start,scope.end]):[];
 const [rows]:any=await conn.query(`SELECT ${projection} FROM saihu_product_weekly WHERE workspaceId=?${filter}`,[workspace,...values]);return rows;
}
export async function insertLegacySaihuFacts(conn:mysql.Connection,records:Record<string,any>[]) {
 for(let offset=0;offset<records.length;offset+=50){
  const batch=records.slice(offset,offset+50),keys=[...new Set(batch.flatMap(Object.keys))];
  if(keys.some(key=>!dailyColumns[key])||batch.some(row=>!row.reportDate||row.reportLevel!=='asin'))throw new Error('日报字段或粒度不完整');
  await conn.query(`INSERT INTO saihu_product_weekly (${keys.map(key=>`\`${dailyColumns[key].name}\``).join(',')}) VALUES ${batch.map(()=>`(${keys.map(()=>'?').join(',')})`).join(',')}`,batch.flatMap(row=>keys.map(key=>row[key]??null)));
 }
}
export async function collectSaihuReport(db:mysql.Connection,run:any,signal:AbortSignal){
 const [configs]:any=await db.query('SELECT * FROM ops_saihu_api_configs WHERE workspace_id=?',[run.workspace_id]);
 const c=configs[0];if(!c?.secret_cipher)throw new Error('请先配置赛狐 API');assertSaihuOrigin(c.api_base_url);
 const secret=decryptToolSecretValue(parse(c.secret_cipher));
 let token=c.token_cipher&&Number(c.token_expires_at)>Date.now()+60000?decryptToolSecretValue(parse(c.token_cipher)):'';
 async function refresh(){signal.throwIfAborted();const t=await fetchSaihuToken(c.app_id,secret);token=t.token;await db.query('UPDATE ops_saihu_api_configs SET token_cipher=?,token_expires_at=? WHERE workspace_id=? AND secret_cipher=?',[JSON.stringify(encryptToolSecretValue(token)),t.expiresAt,run.workspace_id,c.secret_cipher]);}
 if(!token)await refresh();
 const pages:any[]=[];const days:any[]=[];const month=run.period_start.slice(0,7).replace('-','');
 const ranges=run.kind==='weekly'?saihuPeriodDays(run.period_start,run.period_end):[month];
 for(const date of ranges){
  const rows:any[]=[];let total=-1;
  for(let pageNo=1;pageNo<=500;pageNo++){
   const path=run.kind==='weekly'?'/api/productAnalyze/V2/pageList.json':'/api/financial/v2/monthProfit/asin.json';
   const body=run.kind==='weekly'?{startDate:date,endDate:date,currency:'USD',dimType:'1',subType:'0',pageNo:String(pageNo),pageSize:'100',isNewOrMovingOrInStock:'0',fieldModules:['PRODUCT_INFO','PROFIT_INFO','SALE_INFO','PERFORMANCE_INFO','AD_INFO','INVENTORY_INFO']}:{dateType:1,startDate:month,endDate:month,currency:'USD',mergeAsin:false,showOnMonth:true,profitCaliberType:'settlement',pageNo,pageSize:100,orderBy:'sales_num',desc:true};
   let data:any;
   for(let attempt=0;attempt<4;attempt++){
    await pause(1200+attempt*2000);signal.throwIfAborted();
    const params={access_token:token,client_id:String(c.app_id),method:'post',nonce:String(randomInt(1,2147483647)),timestamp:String(Date.now()),url:path};
    const url=new URL(path,'https://openapi.sellfox.com');url.search=new URLSearchParams({access_token:token,client_id:params.client_id,nonce:params.nonce,timestamp:params.timestamp,sign:signSaihu(secret,params)}).toString();
    let response:Awaited<ReturnType<typeof requestSaihuHttp>>;
    try{response=await requestSaihuHttp(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])});}catch{signal.throwIfAborted();if(attempt<3)continue;throw new Error('连接赛狐超时，请重试');}
    let result:any;try{result=await response.json();}catch{throw new Error('赛狐响应格式异常');}
    if(result.code===40001&&attempt<3){await refresh();continue;}
    if((result.code===40019||response.status>=500)&&attempt<3)continue;
    if(result.code!==0)throw new SaihuApiError(Number(result.code));
    if(!response.ok)throw new Error(`赛狐HTTP错误 ${response.status}`);
    data=result.data;pages.push({path,request:body,response:result});break;
   }
   const list=run.kind==='weekly'?data?.rows:data?.reportList;
   if(!Array.isArray(list)||!Number.isInteger(data.totalSize)||data.totalSize<0||data.pageNo!==pageNo||!Number.isInteger(data.totalPage))throw new Error('赛狐分页格式异常，未写入数据');
   if(total<0)total=data.totalSize;else if(total!==data.totalSize)throw new Error('读取期间总条数发生变化，请重试');
   rows.push(...list);if(pageNo>=data.totalPage)break;if(!list.length)throw new Error('赛狐分页数据缺失');
  }
  if(rows.length!==total||!rows.length)throw new Error('赛狐尚未返回完整报表，请稍后重试');
  days.push({date,rows});
 }
 const columns=dailyColumns;
 const active=new Set(days.flatMap(d=>d.rows).filter(hasDailyActivity).map(dailyApiIdentity));
 // A previously imported product may have been corrected to zero. Keep that
 // returned zero snapshot so a later sync actually replaces the old amount.
 const [known]:any=run.kind==='weekly'?await db.query('SELECT DISTINCT asin,store_name,site FROM saihu_product_weekly WHERE workspaceId=? AND report_date BETWEEN ? AND ?',[run.workspace_id,run.period_start,run.period_end]):[[]];
 const knownKeys=new Set(known.map((r:any)=>JSON.stringify([r.asin,r.store_name,r.site])));
 const mapped=run.kind==='weekly'?days.flatMap(d=>d.rows.filter((r:any)=>active.has(dailyApiIdentity(r))||knownKeys.has(JSON.stringify([r.asinList?.[0],r.shopInfos?.[0]?.shopName,r.shopInfos?.[0]?.marketplaceName]))).map((r:any)=>mapSaihuDailyApi(r,d.date,columns))):days[0].rows.map((r:any)=>mapSaihuMonthlyProfit(r,month));
 if(!mapped.length)throw new Error('报表暂无有效数据，本次未覆盖现有记录');
 const keys=new Set();for(const r of mapped){const k=JSON.stringify([r.reportDate||r.yearMonth,r.asin,r.storeName,r.site]);if(keys.has(k))throw new Error('返回数据存在重复商品，未写入');keys.add(k);}
 return {mapped,pages};
}
export async function applyReport(conn:mysql.Connection,run:any,result:{mapped:any[];pages:any[]},signal?:AbortSignal){
 const {mapped,pages}=result;const db=drizzle(conn);const hash=createHash('sha256').update(JSON.stringify(mapped)).digest('hex');
 // Facts and the successful execution record commit atomically.
 await conn.beginTransaction();
 try{
  let importId:number;
  if(run.kind==='monthly'){
   signal?.throwIfAborted();
   const session={tx:db,identity:{workspaceId:run.workspace_id,userId:run.requested_by},manager:true};
   const previous=await readNorthAmericaFinancialSources(session);
   const keys=new Set(mapped.map(r=>JSON.stringify([r.yearMonth,r.storeName,normalizeMarketplaceCode(r.site),r.asin])));
   if(previous.rows.some(r=>r.yearMonth===run.period_start.slice(0,7)&&!keys.has(JSON.stringify([r.yearMonth,r.storeName,r.country,r.asin]))&&Object.values(r.metrics).some(v=>v!==null&&v!==0)))throw new Error('月报缺少已有非零商品或店铺，未覆盖原数据');
   await captureNorthAmericaBoard({tx:db,identity:{workspaceId:run.workspace_id,userId:run.requested_by},manager:true});
   const [existing]:any=await conn.query("SELECT id,fileHash FROM ops_monthly_profit_imports WHERE workspaceId=? AND status='completed' ORDER BY id DESC LIMIT 1",[run.workspace_id]);
   if(existing[0]?.fileHash===hash)importId=existing[0].id;
   else{
    const [r]:any=await conn.query("INSERT INTO ops_monthly_profit_imports (workspaceId,userId,fileName,fileHash,fileUrl,status,totalRows,skippedRows,unallocatedRows,months,payload,confirmedAt) VALUES (?,?,?,?,?,'completed',?,0,?,?,?,CURRENT_TIMESTAMP(3))",[run.workspace_id,run.requested_by,`赛狐定时-月度利润-${run.period_start.slice(0,7)}-USD.json`,hash,`saihu-sync-run:${run.id}`,mapped.length,mapped.filter(r=>!r.parentAsin).length,JSON.stringify([mapped[0].yearMonth]),JSON.stringify(mapped)]);importId=r.insertId;
   }
  }else{
   const name=`赛狐定时-产品日报-${run.period_start}-${run.period_end}-${hash.slice(0,16)}.json`;
   const prior=await db.select().from(dataImports).where(eq(dataImports.workspaceId,run.workspace_id)).orderBy(desc(dataImports.id)).limit(1);
   if(prior[0]?.fileName===name&&prior[0].status==='completed'&&prior[0].importedRows===mapped.length){importId=prior[0].id;}
   else{
    const before=await loadLegacySaihuFacts(conn,run.workspace_id,{start:run.period_start,end:run.period_end});
    if(before.some(r=>r.reportLevel==='parent'&&r.reportDate&&r.reportDate>=run.period_start&&r.reportDate<=run.period_end))throw new Error('该区间已有父ASIN日报，请先核对来源以免重复统计');
    const newKeys=new Set(mapped.map(r=>JSON.stringify([r.reportDate,r.asin,r.storeName,r.site])));
    for(const r of selectSaihuFacts(before))if(r.reportDate&&r.reportDate>=run.period_start&&r.reportDate<=run.period_end&&!newKeys.has(JSON.stringify([r.reportDate,r.asin,r.storeName,r.site]))&&[r.salesQty,r.salesAmount,r.grossProfit,r.adSpend].some(v=>Number(v)!==0))throw new Error('赛狐本次缺少已有商品日报，未覆盖历史记录，请核对后重试');
    const inserted=await db.insert(dataImports).values({workspaceId:run.workspace_id,userId:run.requested_by,sourceType:'saihu',fileName:name,fileUrl:`saihu-sync-run:${run.id}`,weekStartDate:run.period_start,weekEndDate:run.period_end,dataGranularity:'daily',totalRows:mapped.length,importedRows:mapped.length,skippedRows:0,status:'completed'});importId=inserted[0].insertId;
    const records=mapped.map(r=>({...r,workspaceId:run.workspace_id,userId:run.requested_by,importId}));
    const selected=selectSaihuFacts([...before,...records]);const seen=new Map<string,number>();
    for(const r of selected){const k=JSON.stringify([r.reportDate,r.asin,r.storeName,r.site]);seen.set(k,(seen.get(k)||0)+1);}
    for(const r of records)if(seen.get(JSON.stringify([r.reportDate,r.asin,r.storeName,r.site]))!==1)throw new Error('商品父子关系发生变化，请核对后再同步');
    await insertLegacySaihuFacts(conn,records);
   }
  }
  if(run.kind==='monthly')await captureNorthAmericaBoard({tx:db,identity:{workspaceId:run.workspace_id,userId:run.requested_by},manager:true});
  const audit=JSON.stringify({encoding:'gzip-base64',data:gzipSync(JSON.stringify(pages)).toString('base64')});
  await conn.query("UPDATE ops_saihu_sync_runs SET status='success',finished_at=?,row_count=?,import_id=?,message=?,raw_payload=? WHERE id=? AND workspace_id=?",[Date.now(),mapped.length,importId,`已更新 ${mapped.length} 条记录，USD；相同日期不重复累计`,audit,run.id,run.workspace_id]);
  signal?.throwIfAborted();await conn.commit();
 }catch(e){await conn.rollback();throw e;}
}
export async function tickSaihuSync(signal:AbortSignal){
 const conn=await mysql.createConnection(process.env.DATABASE_URL!);let locked=false;
 try{
  const [lock]:any=await conn.query("SELECT GET_LOCK('saihu_sync_executor_v1',0) acquired");locked=Number(lock[0].acquired)===1;if(!locked)return;
  // Owning the database lock proves no previous executor is still alive.
  await conn.query("UPDATE ops_saihu_sync_runs SET status='failed',finished_at=?,message='上次同步因服务中断未完成，可重试；未提交的数据不会生效' WHERE status='running'",[Date.now()]);
  await conn.beginTransaction();
  try{
   const [due]:any=await conn.query('SELECT * FROM ops_saihu_schedules WHERE enabled=1 AND next_run_at<=? ORDER BY next_run_at LIMIT 10 FOR UPDATE',[Date.now()]);
   for(const s of due){
    const at=Number(s.next_run_at),period=saihuSyncPeriod(s.kind,at);
    await conn.query("INSERT IGNORE INTO ops_saihu_sync_runs (workspace_id,schedule_id,kind,trigger_type,scheduled_for,period_start,period_end,requested_by) VALUES (?,?,?,'scheduled',?,?,?,?)",[s.workspace_id,s.id,s.kind,at,period.start,period.end,s.updated_by]);
    await conn.query('UPDATE ops_saihu_schedules SET next_run_at=? WHERE id=?',[nextSaihuRun(scheduleFromRow(s),at),s.id]);
   }
   await conn.commit();
  }catch(e){await conn.rollback();throw e;}
  const [runs]:any=await conn.query("SELECT * FROM ops_saihu_sync_runs WHERE status='queued' ORDER BY id LIMIT 1");const run=runs[0];if(!run||signal.aborted)return;
  await conn.query("UPDATE ops_saihu_sync_runs SET status='running',started_at=? WHERE id=?",[Date.now(),run.id]);
  try{if(run.kind==='inventory')await syncInventory(conn,run,signal);else{const result=await collectSaihuReport(conn,run,signal);signal.throwIfAborted();await applyReport(conn,run,result,signal);}}
  catch(e){const message=e instanceof Error?e.message:'';const safe=message.length<=250&&!/sql|select |insert |password|sk-|https:/i.test(message)?message:'同步处理失败，请重试或联系管理员';await conn.query("UPDATE ops_saihu_sync_runs SET status='failed',finished_at=?,message=? WHERE id=? AND status='running'",[Date.now(),signal.aborted?'服务重启或执行超时，本次同步未完成，可重试':safe,run.id]);}
 }finally{if(locked)await conn.query("SELECT RELEASE_LOCK('saihu_sync_executor_v1')").catch(()=>{});await conn.end();}
}
export function startSaihuSyncScheduler(){
 if(process.env.ENABLE_LEGACY_SAIHU_SYNC!=='true')return async()=>{};
 if(['ENABLE_SAIHU_REPORT_SCHEDULER','ENABLE_SAIHU_REPORT_WRITES','ENABLE_MERGED_OPS_INVENTORY_COLLECTION'].some(key=>process.env[key]==='true'))throw new Error('SAIHU_SYNC_WRITER_CONFLICT');
 let stopped=false,pending:Promise<void>|null=null;const shutdown=new AbortController();
 const tick=()=>{if(stopped||pending)return;pending=tickSaihuSync(AbortSignal.any([shutdown.signal,AbortSignal.timeout(30*60000)])).catch(()=>{console.error('[SaihuSync] scheduler tick failed; check database availability');}).finally(()=>{pending=null;});};
 const timer=setInterval(tick,15000);timer.unref();tick();
 return async()=>{stopped=true;clearInterval(timer);shutdown.abort();await pending;};
}
