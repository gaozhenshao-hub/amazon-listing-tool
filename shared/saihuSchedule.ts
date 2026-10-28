import {z} from 'zod';
export const saihuScheduleInput=z.object({
 kind:z.enum(['weekly','monthly','inventory']),enabled:z.boolean(),
 hour:z.number().int().min(0).max(23),minute:z.number().int().min(0).max(59),
 weekday:z.number().int().min(1).max(7).default(1),monthDay:z.number().int().min(1).max(28).default(15),
});
export type SaihuSchedule=z.infer<typeof saihuScheduleInput>;
const DAY=86400000,OFFSET=8*3600000;
export function shanghaiDate(time:number){return new Date(time+OFFSET).toISOString().slice(0,10);}
export function nextSaihuRun(s:SaihuSchedule,after:number){
 const start=Date.parse(shanghaiDate(after)+'T00:00:00Z');
 for(let i=0;i<63;i++){
  const d=new Date(start+i*DAY),weekday=d.getUTCDay()||7;
  const candidate=d.getTime()-OFFSET+s.hour*3600000+s.minute*60000;
  if(candidate>after&&(s.kind!=='monthly'?weekday===s.weekday:d.getUTCDate()===s.monthDay))return candidate;
 }
 throw new Error('无法计算下次执行时间');
}
export function saihuSyncPeriod(kind:'weekly'|'monthly'|'inventory',scheduledAt:number){
 if(kind==='inventory'){const date=shanghaiDate(scheduledAt);return {start:date,end:date};}
 const local=new Date(shanghaiDate(scheduledAt)+'T00:00:00Z');
 if(kind==='monthly'){
  const end=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),0));
  return {start:new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth(),1)).toISOString().slice(0,10),end:end.toISOString().slice(0,10)};
 }
 // Most recent fully elapsed Friday, even when a task is moved to Friday.
 const daysBack=((local.getUTCDay()-5+7)%7)||7;
 const end=local.getTime()-daysBack*DAY;
 return {start:new Date(end-6*DAY).toISOString().slice(0,10),end:new Date(end).toISOString().slice(0,10)};
}
export function saihuPeriodDays(start:string,end:string){
 const a=Date.parse(start+'T00:00:00Z'),b=Date.parse(end+'T00:00:00Z');
 if(!Number.isFinite(a)||!Number.isFinite(b)||b<a||b-a>31*DAY)throw new Error('同步日期范围异常');
 return Array.from({length:(b-a)/DAY+1},(_,i)=>new Date(a+i*DAY).toISOString().slice(0,10));
}
