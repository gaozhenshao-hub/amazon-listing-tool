import mysql from 'mysql2/promise';
import {drizzle} from 'drizzle-orm/mysql2';
import {z} from 'zod';
import {TRPCError} from '@trpc/server';
import {protectedProcedure,router} from '../_core/trpc';
import type {TrpcContext} from '../_core/context';
import {assertResourceAction} from '../services/securityGovernance';
import {saihuScheduleInput,saihuSyncPeriod} from '../../shared/saihuSchedule';
import {queueSaihuRun,saveSaihuSchedule,scheduleFromRow} from '../domains/ops/saihuScheduleService';

const scope=z.object({expectedWorkspaceId:z.number().int().positive()}).strict();
export function legacySaihuAuthorize(ctx:TrpcContext,expected:number,write=false) {
 return async(db:mysql.Connection)=>{
  const workspace=ctx.workspaceId??ctx.user?.defaultWorkspaceId;
  if(!ctx.user||workspace!==expected)throw new TRPCError({code:'FORBIDDEN'});
  const [actors]:any=await db.query('SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE',[ctx.user.id]);
  const actor=actors[0];
  if(actors.length!==1||actor.status!=='active'||actor.defaultWorkspaceId!==expected||actor.role!==ctx.user.role||!['admin','super_admin'].includes(actor.role))throw new TRPCError({code:'FORBIDDEN'});
  await assertResourceAction({actor,resource:'ops_data',action:write?'update':'read',workspaceId:expected,authorizationRead:{executor:drizzle(db),strict:true,lock:true}});
  if(write&&process.env.ENABLE_LEGACY_SAIHU_SYNC!=='true')throw new TRPCError({code:'PRECONDITION_FAILED',message:'赛狐同步服务未启用'});
 };
}
export const saihuLegacySyncRouter=router({
 status:protectedProcedure.input(scope).query(async({ctx,input})=>{
  const db=await mysql.createConnection(process.env.DATABASE_URL!);
  try {
   await db.beginTransaction();await legacySaihuAuthorize(ctx,input.expectedWorkspaceId)(db);
   const [schedules]:any=await db.query('SELECT id,kind,enabled,hour,minute,weekday,month_day,next_run_at FROM ops_saihu_schedules WHERE workspace_id=? ORDER BY id',[input.expectedWorkspaceId]);
   const [history]:any=await db.query('SELECT id,kind,trigger_type,period_start,period_end,status,started_at,finished_at,row_count,message FROM ops_saihu_sync_runs WHERE workspace_id=? ORDER BY id DESC LIMIT 20',[input.expectedWorkspaceId]);
   const [config]:any=await db.query('SELECT workspace_id FROM ops_saihu_api_configs WHERE workspace_id=? AND secret_cipher IS NOT NULL',[input.expectedWorkspaceId]);
   await db.commit();
   return {enabled:process.env.ENABLE_LEGACY_SAIHU_SYNC==='true',configured:config.length===1,schedules:(schedules as Array<Record<string,any>>).map(s=>({...scheduleFromRow(s),id:Number(s.id),nextRunAt:Number(s.next_run_at),period:saihuSyncPeriod(s.kind,Number(s.next_run_at))})),history};
  }catch(e){await db.rollback();throw e;}finally{await db.end();}
 }),
 save:protectedProcedure.input(scope.extend({schedule:saihuScheduleInput.strict()})).mutation(async({ctx,input})=>{
  await saveSaihuSchedule(input.expectedWorkspaceId,ctx.user.id,input.schedule,legacySaihuAuthorize(ctx,input.expectedWorkspaceId,true));return {saved:true};
 }),
 run:protectedProcedure.input(scope.extend({kind:z.enum(['weekly','monthly','inventory']),retryId:z.number().int().positive().optional()})).mutation(({ctx,input})=>queueSaihuRun(input.expectedWorkspaceId,ctx.user.id,input.kind,input.retryId,legacySaihuAuthorize(ctx,input.expectedWorkspaceId,true))),
});
