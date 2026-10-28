import {useState} from 'react';
import {useAuth} from '@/_core/hooks/useAuth';
import {trpc} from '@/lib/trpc';
import {saihuScheduleInput,type SaihuSchedule} from '@shared/saihuSchedule';
const names={weekly:'周度产品数据',monthly:'月度财务利润',inventory:'库存情况'};
const button='rounded-lg border px-4 py-2 disabled:opacity-50';
const date=(value:number|null)=>value?new Date(Number(value)).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';
function Schedule({value,workspace,refresh}:{value:SaihuSchedule&{nextRunAt:number;period:{start:string;end:string}};workspace:number;refresh:()=>void}) {
 const [draft,setDraft]=useState(value);
 const save=trpc.saihuLegacySync.save.useMutation({onSuccess:refresh});
 const run=trpc.saihuLegacySync.run.useMutation({onSuccess:refresh});
 return <article className="space-y-3 rounded-xl border bg-card p-5">
  <h2 className="text-lg font-semibold">{names[value.kind]}</h2>
  <p className="text-sm text-muted-foreground">{value.kind==='weekly'?'同步最近一个完整周六至周五，按天保存。':value.kind==='monthly'?'同步上个月完整财务月报，使用 USD 结算口径，同时更新月度看板与快照。':'刷新国内仓、采购在途、FBA 在途、FBA 仓和辅料；计划数量不计入总库存。'}</p>
  <div className="flex flex-wrap items-center gap-3">
   <label><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/> 启用</label>
   {value.kind==='monthly'?<label>每月 <input aria-label="每月执行日" type="number" min={1} max={28} value={draft.monthDay} onChange={e=>setDraft({...draft,monthDay:Number(e.target.value)})} className="w-16 rounded border p-2"/> 日</label>:<label>每周 <select aria-label={`${names[value.kind]}执行星期`} value={draft.weekday} onChange={e=>setDraft({...draft,weekday:Number(e.target.value)})} className="rounded border p-2">{['一','二','三','四','五','六','日'].map((name,i)=><option key={i} value={i+1}>星期{name}</option>)}</select></label>}
   <label>北京时间 <input type="time" value={`${String(draft.hour).padStart(2,'0')}:${String(draft.minute).padStart(2,'0')}`} onChange={e=>{const [hour,minute]=e.target.value.split(':').map(Number);setDraft({...draft,hour,minute});}} className="rounded border p-2"/></label>
   <button className={button} disabled={save.isPending||!saihuScheduleInput.safeParse(draft).success} onClick={()=>{const {kind,enabled,hour,minute,weekday,monthDay}=draft;save.mutate({expectedWorkspaceId:workspace,schedule:{kind,enabled,hour,minute,weekday,monthDay}});}}>保存定时任务</button>
   <button className={button} disabled={run.isPending} onClick={()=>run.mutate({expectedWorkspaceId:workspace,kind:value.kind})}>立即同步</button>
  </div>
  <p className="text-sm">下次执行：{draft.enabled?date(value.nextRunAt):'已暂停'}；数据范围：{value.period.start} 至 {value.period.end}</p>
  {(save.error||run.error)&&<p role="alert" className="text-red-600">{save.error?.message||run.error?.message}</p>}
  {save.isSuccess&&<p role="status">已保存</p>}{run.isSuccess&&<p role="status">已加入同步队列，可在下方查看进度。</p>}
 </article>;
}
export default function SaihuSyncSchedules(){
 const {user}=useAuth(),workspace=user?.defaultWorkspaceId;
 const allowed=!!workspace&&['admin','super_admin'].includes(user?.role??'');
 const query=trpc.saihuLegacySync.status.useQuery({expectedWorkspaceId:workspace??0},{enabled:allowed,refetchInterval:15000});
 const retry=trpc.saihuLegacySync.run.useMutation({onSuccess:()=>query.refetch()});
 if(!allowed)return <p>管理员可以管理赛狐同步任务。</p>;
 const refresh=()=>{void query.refetch();};
 return <main className="space-y-6 p-6"><header className="flex items-center justify-between"><h1 className="text-2xl font-bold">赛狐数据同步</h1><button className={button} onClick={refresh}>刷新状态</button></header>
  {query.isLoading&&<p>正在读取同步任务…</p>}{query.error&&<p role="alert">读取失败，请刷新重试。</p>}
  {query.data&&<><p>{query.data.configured?'赛狐 API 已配置':'赛狐 API 尚未配置'} · {query.data.enabled?'定时同步已启用':'定时同步未启用'}</p>
  {query.data.schedules.map(value=><Schedule key={`${value.kind}:${value.nextRunAt}`} value={value} workspace={workspace!} refresh={refresh}/>)}
  <section className="overflow-x-auto rounded-xl border bg-card p-5"><h2 className="mb-4 text-lg font-semibold">最近更新记录</h2>
   <table className="w-full text-sm"><thead><tr>{['数据类型','数据范围','开始 / 完成时间','状态','更新结果','操作'].map(name=><th key={name} className="p-3 text-left">{name}</th>)}</tr></thead><tbody>
    {query.data.history.map((row:any)=><tr key={row.id} className="border-t"><td className="p-3">{names[row.kind as keyof typeof names]}</td><td>{row.period_start} 至 {row.period_end}</td><td>{date(row.started_at)}<br/>{date(row.finished_at)}</td><td className={row.status==='failed'?'text-red-600':row.status==='success'?'text-green-600':''}>{({queued:'排队中',running:'同步中',success:'成功',failed:'失败'} as Record<string,string>)[row.status]??row.status}</td><td>{row.message||'—'}</td><td>{row.status==='failed'&&<button className={button} disabled={retry.isPending||!query.data.enabled} onClick={()=>retry.mutate({expectedWorkspaceId:workspace!,kind:row.kind,retryId:row.id})}>重试</button>}</td></tr>)}
   </tbody></table>{retry.error&&<p role="alert">{retry.error.message}</p>}
  </section></>}
 </main>;
}
