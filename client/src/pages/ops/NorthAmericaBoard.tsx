import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { boardPeriod, northAmericaBoardView, northAmericaProductKey } from "@shared/northAmericaBoard";
import { reportMonthLabel } from "@/lib/reportMonthLabel";

type Api=ReturnType<typeof trpc.useUtils>["client"]["northAmericaBoard"];
type Result=Awaited<ReturnType<Api["get"]["query"]>>;
type View=ReturnType<typeof northAmericaBoardView>;
type Product=View["products"][number];
const button="rounded-lg border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50";
const cell="whitespace-nowrap border-b px-3 py-3 align-top text-sm";
const amount=(n:number|null)=>n===null?"—":`$${n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const count=(n:number|null)=>n===null?"—":n.toLocaleString("zh-CN");
const rate=(n:number|null)=>n===null?"—":`${(n*100).toFixed(2)}%`;
function Change({current,previous,percentage=false}:{current:number|null;previous:number|null;percentage?:boolean}) {
  if(current===null||previous===null)return null;
  const delta=current-previous;
  const text=percentage?`${delta>0?"+":""}${(delta*100).toFixed(1)}个百分点`:previous===0?delta===0?"0%":delta>0?"新增":"新增亏损":`${delta>0?"+":""}${(delta/Math.abs(previous)*100).toFixed(1)}%`;
  return <small className={`block ${delta>0?"text-green-700":delta<0?"text-red-600":"text-muted-foreground"}`}>{text}</small>;
}
function Table({heads,children}:{heads:string[];children:ReactNode}) {return <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left"><thead className="bg-muted/70"><tr>{heads.map(head=><th key={head} className={cell}>{head}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;}
function Name({product,open,toggle}:{product:{title:string;asin:string;children:unknown[]};open:boolean;toggle:()=>void}) {
  return <><div className="flex gap-2 items-start">{product.children.length>1&&<button type="button" className="px-1" aria-label={`${open?"收起":"展开"}${product.asin}子体`} aria-expanded={open} onClick={toggle}>{open?"⌄":"›"}</button>}<span className="whitespace-normal min-w-40 max-w-64">{product.title}</span></div><small className="text-muted-foreground">{product.children.length>1?`${product.children.length} 个子体`:""}</small></>;
}
function Note({api,result,product,onSaved}:{api:Api;result:Result;product:Product;onSaved:()=>void}) {
  const stored=result.notes.find(note=>note.parentAsin===product.asin&&note.storeName===product.storeName),[text,setText]=useState(stored?.note??""),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
  const editable=!!result.edition&&!result.edition.archived&&(result.canViewAll||product.ownerIds.includes(result.identity.userId));
  useEffect(()=>{setText(stored?.note??"");setNotice("");},[stored?.note,result.edition?.id]);
  if(!editable)return <span className="whitespace-pre-wrap">{stored?.note||"—"}</span>;
  return <div className="min-w-48 space-y-1"><textarea aria-label={`${product.asin}原因备注`} className="w-full rounded border p-2" value={text} maxLength={5000} onChange={event=>setText(event.target.value)} disabled={busy}/><button type="button" className={button} disabled={busy||text===(stored?.note??"")} onClick={()=>{
    setBusy(true);setNotice("");void api.saveNote.mutate({expectedWorkspaceId:result.identity.workspaceId,editionId:result.edition!.id,storeName:product.storeName,parentAsin:product.asin,note:text,expectedVersion:stored?.version??0}).then(()=>{onSaved();setNotice("已保存");}).catch(()=>setNotice("未能确认保存，请刷新后核对再重试。")).finally(()=>setBusy(false));
  }}>{busy?"保存中…":"保存备注"}</button><p role="status" className="whitespace-normal text-xs">{notice}</p></div>;
}
function ProfitRow({product,view,note}:{product:Product;view:View;note:ReactNode}) {
  const [open,setOpen]=useState(false), metrics=["financialProfit","salesQty","salesAmount","margin"] as const;
  const values=(current:Product["current"],previous:Product["previous"])=>metrics.flatMap(key=>{
    const format=key==="margin"?rate:key==="salesQty"?count:amount;
    return [<td className={`${cell} ${key==="financialProfit"&&current[key]!==null&&current[key]!<0?"text-red-600":""}`} key={`${key}:current`}>{format(current[key])}<Change current={current[key]} previous={previous[key]} percentage={key==="margin"}/></td>,<td className={cell} key={`${key}:previous`}>{format(previous[key])}</td>];
  });
  return <><tr><td className={cell}><Name product={product} open={open} toggle={()=>setOpen(!open)}/></td><td className={cell}>{product.asin}</td>{values(product.current,product.previous)}<td className={cell}>{note}</td></tr>
    {open&&product.children.length>1&&product.children.map(child=><tr className="bg-muted/30" key={child.asin}><td className={cell}>{child.title}</td><td className={cell}>{child.asin}</td>{values(boardPeriod(child,view.month,view.month),boardPeriod(child,view.previousMonth,view.previousMonth))}<td className={cell}/></tr>)}
  </>;
}
function ProfitSection({title,rows,view,note}:{title:string;rows:Product[];view:View;note:(product:Product)=>ReactNode}) {
  const month=reportMonthLabel(view.month),previous=reportMonthLabel(view.previousMonth,view.month.slice(0,4)!==view.previousMonth.slice(0,4));
  return <section className="space-y-3"><h3 className="font-semibold text-lg">{title}</h3>{!rows.length?<p className="text-muted-foreground">暂无符合条件的产品</p>:<Table heads={["产品名称","ASIN（父）",...['月度利润','销量','销售额','利润率'].flatMap(label=>[`${label}（${month}）`,`${label}（${previous}）`]),"备注"]}>{rows.map(product=><ProfitRow key={northAmericaProductKey(product)} product={product} view={view} note={note(product)}/>)}</Table>}</section>;
}
function Trend({view}:{view:View}) {
  const maximum=Math.max(1,...view.trend.map(point=>Math.abs(point.profit??0))),x=(i:number)=>70+i*150,y=(n:number)=>130-100*n/maximum;
  return <section className="rounded-xl border p-4 space-y-3"><h3 className="font-semibold">最近六个月财务利润合计</h3><svg role="img" aria-label="最近六个月利润趋势" viewBox="0 0 900 280" className="w-full max-w-5xl"><line x1="50" x2="850" y1="130" y2="130" stroke="#cbd5e1"/>{view.trend.map((point,index)=><g key={point.month}>{point.profit!==null&&<>{index>0&&view.trend[index-1].profit!==null&&<line x1={x(index-1)} y1={y(view.trend[index-1].profit!)} x2={x(index)} y2={y(point.profit)} stroke="#8056de" strokeWidth="3"/>}<circle cx={x(index)} cy={y(point.profit)} r="5" fill="#8056de"/><text x={x(index)} y={y(point.profit)-12} textAnchor="middle" fontSize="13">{amount(point.profit)}</text></>}<text x={x(index)} y="265" textAnchor="middle" fontSize="13">{point.month}</text></g>)}</svg></section>;
}
function ProductRow({product,view,kind}:{product:Product;view:View;kind:"returns"|"profit"|"loss"}) {
  const [open,setOpen]=useState(false);
  const values=(p:Pick<Product,"current"|"quarter"|"total">)=>kind==="returns"?[p.current,p.quarter,p.total].flatMap((period,index)=>[
    <td className={cell} key={`${index}:r`}>{rate(period.returnRate)}</td>,<td className={cell} key={`${index}:f`}>{rate(period.refundRate)}</td>,<td className={cell} key={`${index}:q`}>{count(period.salesQty)}</td>,<td className={cell} key={`${index}:s`}>{amount(period.salesAmount)}</td>,<td className={`${cell} ${(period.financialProfit??0)<0?"text-red-600":""}`} key={`${index}:p`}>{amount(period.financialProfit)}</td>,
  ]):[...(kind==="profit"?[<td className={cell} key="qty">{count(p.current.salesQty)}</td>]:[]),<td className={cell} key="sales">{amount(p.current.salesAmount)}</td>,<td className={`${cell} ${(p.current.financialProfit??0)<0?"text-red-600":""}`} key="profit">{amount(p.current.financialProfit)}</td>,<td className={cell} key="margin">{rate(p.current.margin)}</td>,...(kind==="loss"?[<td className={`${cell} ${(p.current.cash??0)<0?"text-red-600 font-semibold":""}`} key="cash">{amount(p.current.cash)}</td>]:[])];
  return <><tr className={kind==="loss"&&(product.current.cash??0)<0?"bg-red-50":""}><td className={cell}><Name product={product} open={open} toggle={()=>setOpen(!open)}/></td><td className={cell}>{product.asin}</td>{values(product)}</tr>{open&&product.children.length>1&&product.children.map(child=><tr className="bg-muted/30" key={child.asin}><td className={cell}>{child.title}</td><td className={cell}>{child.asin}</td>{values({current:boardPeriod(child,view.month,view.month),quarter:boardPeriod(child,view.quarter,view.month),total:boardPeriod(child,view.first,view.month)})}</tr>)}</>;
}
function ProductSection({title,rows,view,kind}:{title:string;rows:Product[];view:View;kind:"returns"|"profit"|"loss"}) {
  const quarter=view.quarter.slice(0,4)===view.month.slice(0,4)?`${Number(view.quarter.slice(5))}—${Number(view.month.slice(5))}月`:`${view.quarter}—${view.month}`;
  const heads=kind==="returns"?[reportMonthLabel(view.month),quarter,"总"].flatMap(period=>["退货率","退款率","销量","销售额","利润"].map(label=>period+label)):kind==="profit"?["销量","销售额","利润","利润率"]:["销售额","利润","利润率","回款"];
  return <section className="space-y-3"><h3 className="font-semibold text-lg">{title} <small className="text-muted-foreground">{rows.length} 个产品</small></h3>{!rows.length?<p className="text-muted-foreground">暂无符合条件的产品</p>:<Table heads={["产品名称","ASIN（父 / 子）",...heads]}>{rows.map(product=><ProductRow key={northAmericaProductKey(product)} product={product} view={view} kind={kind}/>)}</Table>}</section>;
}
type LegacyProduct=NonNullable<NonNullable<Result["legacy"]>["payload"]["productBoard"]>["products"][number];
function LegacyProductRow({product,kind}:{product:LegacyProduct;kind:"returns"|"profit"|"loss"}) {
  const [open,setOpen]=useState(false);
  const values=(p:Omit<LegacyProduct,"children">)=>kind==="returns"?(["month","quarter","total"] as const).flatMap(period=>{
    const v=p.rates[period];return [rate(v.returnRate),rate(v.refundRate),count(v.sales),amount(v.salesAmount),amount(v.profit)];
  }):[...(kind==="profit"?[count(p.financial?.qty??null)]:[]),amount(p.financial?.sales??null),amount(p.financial?.profit??null),rate(p.financial?.margin??null),...(kind==="loss"?[amount(p.financial?.cash??null)]:[])];
  return <><tr><td className={cell}><Name product={product} open={open} toggle={()=>setOpen(!open)}/></td><td className={cell}>{product.asin}</td>{values(product).map((value,index)=><td className={`${cell} ${value.startsWith('$-')?"text-red-600":""}`} key={index}>{value}</td>)}</tr>{open&&product.children.length>1&&product.children.map(child=><tr className="bg-muted/30" key={child.asin}><td className={cell}>{child.title}</td><td className={cell}>{child.asin}</td>{values(child).map((value,index)=><td className={cell} key={index}>{value}</td>)}</tr>)}</>;
}
function LegacySnapshot({legacy,kind}:{legacy:NonNullable<Result["legacy"]>;kind:"profit"|"products"}) {
  const {payload,notes}=legacy;
  if(kind==="products") {
    const board=payload.productBoard;
    if(!board)return <p>这份原有快照没有保存产品看板数据。</p>;
    const definitions=[{title:"高退货率产品",kind:"returns" as const,rows:board.products.filter(p=>p.rates.quarter.sales>=50&&(p.rates.quarter.returnRate??0)>.08).sort((a,b)=>(b.rates.quarter.returnRate??0)-(a.rates.quarter.returnRate??0))},
      {title:"高利润产品",kind:"profit" as const,rows:board.products.filter(p=>(p.financial?.profit??0)>1000).sort((a,b)=>b.financial!.profit-a.financial!.profit)},
      {title:"赔钱产品前十",kind:"loss" as const,rows:board.products.filter(p=>(p.financial?.profit??0)<0).sort((a,b)=>a.financial!.profit-b.financial!.profit).slice(0,10)}];
    return <section className="space-y-6"><h3 className="text-lg font-semibold">{payload.month} 原有产品快照（只读）</h3>{definitions.map(section=>{
      const heads=section.kind==="returns"?[reportMonthLabel(board.month),`${board.periods.quarter?.start}—${board.month}`,"总"].flatMap(period=>["退货率","退款率","销量","销售额","利润"].map(label=>period+label)):section.kind==="profit"?["销量","销售额","利润","利润率"]:["销售额","利润","利润率","回款"];
      return <section className="space-y-3" key={section.kind}><h4 className="font-semibold">{section.title}</h4><Table heads={["产品名称","ASIN",...heads]}>{section.rows.map(product=><LegacyProductRow product={product} key={product.asin} kind={section.kind}/>)}</Table></section>;
    })}</section>;
  }
  return <section className="space-y-3"><h3 className="text-lg font-semibold">{payload.month} 原有月度快照</h3><p className="text-sm text-muted-foreground">保留当时的数据和备注，只读查看。</p><Table heads={["产品名称","ASIN",`${reportMonthLabel(payload.month)}利润`,`${reportMonthLabel(payload.previousMonth)}利润`,"销量","销售额","利润率","原备注"]}>{payload.products.map(product=>{
    const current=product.months[payload.month],previous=product.months[payload.previousMonth];
    return <Fragment key={product.asin}><tr><td className={cell}>{product.title}</td><td className={cell}>{product.asin}</td><td className={cell}>{amount(current?.profit??null)}</td><td className={cell}>{amount(previous?.profit??null)}</td><td className={cell}>{count(current?.qty??null)}</td><td className={cell}>{amount(current?.sales??null)}</td><td className={cell}>{rate(current?.margin??null)}</td><td className={`${cell} whitespace-pre-wrap`}>{notes.find(note=>note.asin===product.asin)?.note||"—"}</td></tr></Fragment>;
  })}</Table></section>;
}
function Board({kind,userId,workspaceId}:{kind:"profit"|"products";userId:number;workspaceId:number}) {
  const api=trpc.useUtils().client.northAmericaBoard,[operator,setOperator]=useState(""),[archive,setArchive]=useState(""),[revision,setRevision]=useState(0),[result,setResult]=useState<Result|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState("");
  const sequence=useRef(0);
  useEffect(()=>{
    const own=++sequence.current,abort=new AbortController();setResult(null);setError("");setLoading(true);
    void api.get.query({expectedWorkspaceId:workspaceId,...(operator?{operatorId:Number(operator)}:{}),...(archive.startsWith("legacy:")?{legacyEditionId:Number(archive.slice(7))}:archive?{month:archive}:{})},{signal:abort.signal}).then(value=>{
      if(own!==sequence.current||abort.signal.aborted)return;
      if(value.identity.userId!==userId||value.identity.workspaceId!==workspaceId)throw new Error();setResult(value);
    }).catch(()=>{if(own===sequence.current&&!abort.signal.aborted)setError("财务来源或权限暂时无法核验，请刷新重试。");}).finally(()=>{if(own===sequence.current&&!abort.signal.aborted)setLoading(false);});
    return ()=>{abort.abort();};
  },[api,userId,workspaceId,operator,archive,revision]);
  const view=result?.payload?northAmericaBoardView(result.payload):null;
  const refresh=()=>setRevision(value=>value+1);
  return <section className="min-w-0 space-y-6 p-4"><header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-bold">{kind==="profit"?"利润看板":"产品看板"}</h1><p className="text-muted-foreground text-sm">财务月度利润 · 美国站 USD（合并加拿大、墨西哥）{view?` · ${view.month}`:""}</p></div><div className="flex gap-3"><label>运营 <select aria-label="运营负责人" className={button} value={operator} disabled={loading} onChange={event=>setOperator(event.target.value)}><option value="">{result?.canViewAll?"全部运营":"我和搭档"}</option>{result?.operators.map(member=><option key={member.id} value={member.id}>{member.name}</option>)}</select></label><button className={button} type="button" onClick={refresh} disabled={loading}>刷新</button></div></header>
    {loading&&<p role="status">正在读取财务数据…</p>}{error&&<p role="alert" className="text-red-600">{error}</p>}
    {result?.legacy&&<LegacySnapshot legacy={result.legacy} kind={kind}/>}
    {view&&result&&<>{kind==="profit"?<><Trend view={view}/>{([['利润增长前五名',view.rising],['利润下滑前五名',view.falling]] as const).map(([title,rows])=><ProfitSection key={title} title={title} rows={rows} view={view} note={product=><Note api={api} result={result} product={product} onSaved={refresh}/>}/>)}</>:<><p className="text-sm text-muted-foreground">高退货率：三个月累计销量至少 50，退货率超过 8%，按退货率从高到低排序。回款 = 利润 + 采购成本 + 头程成本。</p><ProductSection title="高退货率产品" rows={view.highReturns} kind="returns" view={view}/><ProductSection title="高利润产品（超过 $1,000）" rows={view.highProfit} kind="profit" view={view}/><ProductSection title="赔钱产品前十" rows={view.losing} kind="loss" view={view}/><section><h3 className="font-semibold text-lg">滞销产品</h3><p className="text-muted-foreground">待库存规则完善后补充。</p></section></>}
    {result.canViewAll&&Object.keys(result.payload!.unallocated).length>0&&<p className="text-xs text-muted-foreground">{view.month}未归属产品的店铺费用利润：{amount(result.payload!.unallocated[view.month]?.metrics.financialProfit??null)}，单独保留，不摊入产品榜单。</p>}</>}
    {result&&!view&&!result.legacy&&<p>暂无当前可见的财务记录。</p>}
    {result&&<section className="rounded-xl border p-4 space-y-3"><h3 className="font-semibold text-lg">月度快照</h3><p className="text-sm text-muted-foreground">新月份财务数据成功同步后更新，并保留之前的快照。</p><select aria-label="选择月度快照" className={button} value={archive} onChange={event=>setArchive(event.target.value)}><option value="">当前看板</option>{result.history.map(item=><option key={item.id} value={item.month}>{item.month}{item.archived?" · 已归档":" · 当前月份"}</option>)}{result.legacyHistory.map(item=><option key={`legacy:${item.id}`} value={`legacy:${item.id}`}>{item.month} · 原有快照</option>)}</select></section>}
  </section>;
}
export default function NorthAmericaBoard({kind}:{kind:"profit"|"products"}) {
  const auth=useAuth(),user=auth.user;
  if(auth.loading)return <p role="status">正在确认用户身份…</p>;
  if(auth.error||!user||!user.defaultWorkspaceId)return <p role="alert">请登录后查看运营看板。</p>;
  return <Board key={`${user.id}:${user.defaultWorkspaceId}:${user.role}:${kind}`} kind={kind} userId={user.id} workspaceId={user.defaultWorkspaceId}/>;
}
