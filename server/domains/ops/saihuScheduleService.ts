import mysql from 'mysql2/promise';
import {nextSaihuRun,saihuSyncPeriod,type SaihuSchedule} from '../../../shared/saihuSchedule';
export const scheduleFromRow=(r:any):SaihuSchedule=>({kind:r.kind,enabled:Boolean(r.enabled),hour:r.hour,minute:r.minute,weekday:r.weekday,monthDay:r.month_day});
export async function seedSaihuSchedules(db:mysql.Connection){
 const [configs]:any=await db.query('SELECT workspace_id,updated_by FROM ops_saihu_api_configs');
 for(const c of configs)for(const kind of ['weekly','monthly','inventory'] as const){
  const s={kind,enabled:true,hour:9,minute:0,weekday:1,monthDay:15};
  await db.query('INSERT IGNORE INTO ops_saihu_schedules (workspace_id,kind,next_run_at,updated_by) VALUES (?,?,?,?)',[c.workspace_id,kind,nextSaihuRun(s,Date.now()),c.updated_by]);
 }
}
export async function saveSaihuSchedule(workspace:number,user:number,input:SaihuSchedule,authorize?:(db:mysql.Connection)=>Promise<void>){
 const db=await mysql.createConnection(process.env.DATABASE_URL!);
 try{
  await db.beginTransaction();await authorize?.(db);
  const [config]:any=await db.query('SELECT workspace_id FROM ops_saihu_api_configs WHERE workspace_id=?',[workspace]);
  if(!config.length)throw new Error('请先保存赛狐API配置');
  await db.query(`INSERT INTO ops_saihu_schedules (workspace_id,kind,enabled,hour,minute,weekday,month_day,next_run_at,updated_by)
  VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),hour=VALUES(hour),minute=VALUES(minute),weekday=VALUES(weekday),month_day=VALUES(month_day),next_run_at=VALUES(next_run_at),updated_by=VALUES(updated_by)`,[workspace,input.kind,input.enabled,input.hour,input.minute,input.weekday,input.monthDay,nextSaihuRun(input,Date.now()),user]);
  await db.commit();
 }catch(e){await db.rollback();throw e;}finally{await db.end();}
}
export async function queueSaihuRun(workspace:number,user:number,kind:'weekly'|'monthly'|'inventory',retryId?:number,authorize?:(db:mysql.Connection)=>Promise<void>){
 const db=await mysql.createConnection(process.env.DATABASE_URL!);
 try{
  await db.beginTransaction();
  await authorize?.(db);
  const [rows]:any=await db.query('SELECT * FROM ops_saihu_schedules WHERE workspace_id=? AND kind=? FOR UPDATE',[workspace,kind]);
  if(rows.length!==1)throw new Error('请先保存定时任务');const s=rows[0];
  const [pending]:any=await db.query("SELECT id FROM ops_saihu_sync_runs WHERE workspace_id=? AND kind=? AND status IN ('queued','running')",[workspace,kind]);
  if(pending.length)throw new Error('该类型已有任务等待执行或正在同步');
  const at=Date.now();let period=saihuSyncPeriod(kind,at);
  if(retryId){const [old]:any=await db.query("SELECT * FROM ops_saihu_sync_runs WHERE id=? AND workspace_id=? AND kind=? AND status='failed'",[retryId,workspace,kind]);if(old.length!==1)throw new Error('只能重试本工作区的失败任务');if(kind!=='inventory')period={start:old[0].period_start,end:old[0].period_end};}
  const [result]:any=await db.query('INSERT INTO ops_saihu_sync_runs (workspace_id,schedule_id,kind,trigger_type,scheduled_for,period_start,period_end,requested_by) VALUES (?,?,?,?,?,?,?,?)',[workspace,s.id,kind,retryId?'retry':'manual',at,period.start,period.end,user]);
  await db.commit();return {id:result.insertId};
 }catch(e){await db.rollback();throw e;}finally{await db.end();}
}
