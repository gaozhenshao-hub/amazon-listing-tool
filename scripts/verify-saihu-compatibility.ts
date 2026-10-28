/** Explicit deployment probe. Reads saved audit reports; never publishes facts. */
import mysql from 'mysql2/promise';
import {gunzipSync} from 'node:zlib';
import {getTableColumns} from 'drizzle-orm';
import {saihuProductWeekly} from '../drizzle/schema';
import {mapSaihuMonthlyProfit} from '../server/domains/ops/productOverview/saihuMonthlyProfit';
import {mapSaihuDailyApi} from '../server/domains/ops/productOverview/saihuDailyApi';
import {mapInventory} from '../server/domains/ops/inventoryMapping';
import {collectSaihuReport,loadLegacySaihuFacts} from '../server/domains/ops/saihuSyncExecutor';
const parse=(value:any)=>typeof value==='string'?JSON.parse(value):value;
const db=await mysql.createConnection(process.env.DATABASE_URL!);
const sum=(rows:any[],key:string)=>rows.reduce((total,row)=>total+Number(row[key]??0),0);
const close=(a:number,b:number)=>{if(Math.abs(a-b)>0.011)throw new Error('REPLAY_TOTAL_MISMATCH');};
try {
 for(const kind of ['monthly','weekly','inventory']) {
  const [runs]:any=await db.query("SELECT * FROM ops_saihu_sync_runs WHERE workspace_id=1 AND kind=? AND status='success' AND raw_payload IS NOT NULL ORDER BY id DESC LIMIT 1",[kind]);
  const run=runs[0];if(!run)throw new Error('AUDIT_MISSING_'+kind);
  const raw=parse(run.raw_payload);if(raw.encoding!=='gzip-base64')throw new Error('AUDIT_FORMAT');
  const pages=JSON.parse(gunzipSync(Buffer.from(raw.data,'base64')).toString());
  if(kind==='monthly') {
   const mapped=pages.flatMap((p:any)=>p.response.data.reportList.map((r:any)=>mapSaihuMonthlyProfit(r,run.period_start.slice(0,7).replace('-',''))));
   const [imports]:any=await db.query('SELECT payload FROM ops_monthly_profit_imports WHERE workspaceId=1 AND id=?',[run.import_id]);
   const stored=parse(imports[0].payload);if(mapped.length!==stored.length)throw new Error('MONTH_COUNT');
   for(const key of ['salesQty','salesAmount','financialProfit','purchaseCost','freight','returnQty','refundQty'])close(sum(mapped,key),sum(stored,key));
   console.log(JSON.stringify({kind,runId:run.id,rows:mapped.length,profit:sum(mapped,'financialProfit'),verified:true}));
  } else if(kind==='weekly') {
   const stored=await loadLegacySaihuFacts(db,1,{importId:run.import_id});
   const key=(r:any)=>JSON.stringify([r.reportDate,r.asin,r.storeName,r.site]);const wanted=new Set(stored.map(key));
   const byKey=new Map<string,any>();
   for(const page of pages)for(const raw of page.response.data.rows){
    const identity=JSON.stringify([page.request.startDate,raw.asinList?.[0],raw.shopInfos?.[0]?.shopName,raw.shopInfos?.[0]?.marketplaceName]);
    if(wanted.has(identity))byKey.set(identity,mapSaihuDailyApi(raw,page.request.startDate,getTableColumns(saihuProductWeekly)));
   }
   if(stored.length!==run.row_count)throw new Error('DAILY_COUNT');
   for(const old of stored){const row:any=byKey.get(key(old));if(!row)throw new Error('DAILY_ROW_MISSING');for(const field of ['salesQty','salesAmount','grossProfit','adSpend'])close(Number(old[field]),Number(row[field]));}
   console.log(JSON.stringify({kind,runId:run.id,rows:stored.length,verified:true}));
  } else {
   const data:Record<string,any[]>={warehouses:[],warehouse:[],fba:[],commodities:[],aux:[],auxParents:[],listings:[],shipping:[],shippingItems:[],details:[]};
   for(const p of pages){const path=p.path,body=p.response.data;
    const key=path.includes('warehouseList')?'warehouses':path.includes('warehouseItemList')?'warehouse':path.includes('/inventoryManage/fba/')?'fba':path==='/api/commodity/pageList.json'?(p.request.relAuxFlag?'auxParents':'commodities'):path.includes('/commodity/aux/')?'aux':path.includes('/api/product/v2/')?'listings':path.includes('/shippingOrder/pageList/')?'shipping':path.includes('itemsBatch')?'shippingItems':path.includes('getCommodityDetail')?'details':null;
    if(!key)throw new Error('UNKNOWN_INVENTORY_SOURCE');data[key].push(...(key==='details'?[body]:key==='shippingItems'?body:body.rows));
   }
   const snapshot=mapInventory(data,Number(run.started_at));
   const [rows]:any=await db.query("SELECT payload FROM ops_inventory_snapshots WHERE workspace_id=1 AND run_id=? AND run_source='saihu_sync'",[run.id]);const stored=parse(rows[0].payload);
   for(const field of ['domestic','purchase','shipping','fba','total'])for(const metric of ['quantity','value'])close(snapshot.rows.reduce((n,r)=>n+Number((r as any)[field][metric]??0),0),stored.rows.reduce((n:number,r:any)=>n+Number(r[field][metric]??0),0));
   console.log(JSON.stringify({kind,runId:run.id,rows:snapshot.rows.length,verified:true}));
  }
 }
 if(process.argv.includes('--live-monthly')) {
  const [rows]:any=await db.query("SELECT * FROM ops_saihu_sync_runs WHERE workspace_id=1 AND kind='monthly' AND status='success' ORDER BY id DESC LIMIT 1");
  const result=await collectSaihuReport(db,rows[0],AbortSignal.timeout(300000));
  console.log(JSON.stringify({liveMonthly:'verified, not published',rows:result.mapped.length,profit:sum(result.mapped,'financialProfit')}));
 }
 console.log('SAIHU_COMPATIBILITY_VERIFIED');
}finally{await db.end();}
