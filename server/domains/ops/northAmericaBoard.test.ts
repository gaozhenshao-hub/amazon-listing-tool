import { beforeEach, describe, expect, it, vi } from "vitest";
import { financialSourceCache } from "./financialSourceCache";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { MONTHLY_FINANCIAL_METRICS, parseMonthlyFinancialBatch, type MonthlyFinancialBatchRecord } from "../../../shared/monthlyFinancialRead";
import { buildNorthAmericaBoard, northAmericaBoardView, type NorthAmericaBoardOwner } from "../../../shared/northAmericaBoard";
import type { CurrentUsFinancialBinding } from "../../../shared/northAmericaFinancialConsolidation";
import { filterNorthAmericaBoardAccess, readNorthAmericaFinancialSources } from "./northAmericaBoardSources";
import { createNorthAmericaBoardRepository } from "./northAmericaBoardRepository";
import { filterNorthAmericaEdition, readNorthAmericaEdition, readLegacyNorthAmericaEdition } from "./northAmericaBoardArchive";
import { createHash } from "node:crypto";
import type { Session } from "./monthlyBoardReadCore";
import type { TrpcContext } from "../../_core/context";
const asin="B000000001", parent="B000000009";
const binding:CurrentUsFinancialBinding={asin,parentAsin:parent,storeName:"Store US",country:"US",source:{table:"saihu_product_weekly",rowId:90}};
const owner:NorthAmericaBoardOwner={storeName:binding.storeName,parentAsin:parent,title:"Product",ownerIds:[3,4]};
function raw(patch:Record<string,unknown>={}) { return {...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key=>[key,0])),yearMonth:"2026-09",parentAsin:parent,asin,sku:"sku",title:"Product",storeName:"Store US",site:"US",operator:"Alice",salesQty:20,salesAmount:300,financialProfit:30,returnQty:2,raw:{currency:"USD"},...patch}; }
function record(id=1,rows=[raw()]) {const payload=JSON.stringify(rows), months=JSON.stringify([...new Set(rows.map(row=>row.yearMonth))]); return {id,workspaceId:7,userId:3,fileName:"original.json",fileHash:"a".repeat(64),status:"completed",totalRows:rows.length,skippedRows:0,unallocatedRows:rows.filter(row=>!row.parentAsin).length,months,payload,payloadBytes:Buffer.byteLength(payload),monthsBytes:Buffer.byteLength(months),createdAt:"2026-10-15 00:00:00.000000",confirmedAt:"2026-10-15 00:00:00.000000",fileReferenceKind:"saihu_sync_run",sourceRunId:id}; }
const parsed=(rows:ReturnType<typeof raw>[])=>parseMonthlyFinancialBatch(record(1,rows) as MonthlyFinancialBatchRecord).rows;
const base={identity:{workspaceId:7,userId:3},manager:false};
const source={bindings:[binding],owners:[owner],members:[{id:3,name:"Alice"},{id:4,name:"Bob"},{id:5,name:"Other"}]};
describe("North America board projection and access",()=>{
  it("merges three markets using current parents with exact source references and no second exchange",()=>{
    const payload=buildNorthAmericaBoard(parsed([raw(),raw({site:"CA",storeName:"Store CA",parentAsin:asin}),raw({site:"MX",storeName:"Store MX",parentAsin:asin})]),[binding],[owner])!;
    expect(payload.products).toHaveLength(1);expect(payload.products[0].children).toHaveLength(1);
    expect(payload.products[0].months["2026-09"].metrics).toMatchObject({financialProfit:90,salesAmount:900,salesQty:60});
    expect(payload.products[0].months["2026-09"].sources.map(row=>row.country)).toEqual(["US","CA","MX"]);
    expect(northAmericaBoardView(payload).highReturns).toHaveLength(1);
  });
  it("uses financial three-month quantity and return rates, not average rates or refund rates",()=>{
    const rows=parsed([raw({yearMonth:"2026-07",salesQty:49,returnQty:5}),raw({yearMonth:"2026-08",salesQty:0,returnQty:0}),raw({salesQty:1,returnQty:0})]);
    const view=northAmericaBoardView(buildNorthAmericaBoard(rows,[binding],[owner])!);
    expect(view.quarter).toBe("2026-07"); expect(view.highReturns[0].quarter.returnRate).toBe(.1);
    rows[2].metrics.salesQty=0;expect(northAmericaBoardView(buildNorthAmericaBoard(rows,[binding],[owner])!).highReturns).toEqual([]);
  });
  it("keeps missing metrics unknown, excludes exactly eight percent and computes cash at full cost",()=>{
    const rows=parsed([raw({salesQty:50,returnQty:4,financialProfit:-100,purchaseCost:50,freight:60})]);
    let view=northAmericaBoardView(buildNorthAmericaBoard(rows,[binding],[owner])!);
    expect(view.highReturns).toEqual([]);expect(view.losing[0].current.cash).toBe(10);
    rows[0].metrics.purchaseCost=null;view=northAmericaBoardView(buildNorthAmericaBoard(rows,[binding],[owner])!);
    expect(view.losing[0].current.cash).toBeNull();expect(view.rising).toEqual([]);expect(view.falling).toEqual([]);
  });
  it("shows unallocated fees only to an unfiltered manager and never adds them to products",()=>{
    const rows=parsed([raw(),raw({asin:"",parentAsin:"",financialProfit:-8})]);
    const own=filterNorthAmericaBoardAccess(base,source,rows);expect(own.payload!.unallocated).toEqual({});
    const all=filterNorthAmericaBoardAccess({...base,manager:true},source,rows);expect(all.payload!.unallocated["2026-09"].metrics.financialProfit).toBe(-8);
    expect(all.payload!.products[0].months["2026-09"].metrics.financialProfit).toBe(30);
  });
  it("allows verified direct partners but rejects an unrelated operator and unmapped rows",()=>{
    const rows=parsed([raw()]);expect(filterNorthAmericaBoardAccess(base,source,rows,4).payload!.products).toHaveLength(1);
    expect(()=>filterNorthAmericaBoardAccess(base,source,rows,5)).toThrow("OPERATOR_DENIED");
    expect(filterNorthAmericaBoardAccess({...base,identity:{workspaceId:7,userId:5}},source,rows).payload).toBeNull();
    expect(filterNorthAmericaBoardAccess(base,{...source,owners:[{...owner,ownerIds:[]}]},rows).payload).toBeNull();
  });
  it("rejects a foreign currency rather than displaying an invented USD total",()=>{
    expect(()=>buildNorthAmericaBoard(parsed([raw({raw:{currency:"CAD"}})]),[binding],[owner])).toThrow("UNRESOLVED_SOURCE");
  });
});

describe("immutable archive access and integrity",()=>{
  const payload=()=>buildNorthAmericaBoard(parsed([raw()]),[binding],[owner])!;
  it("uses current owners rather than frozen owners to grant archive access",()=>{
    const frozen=payload();
    const reassigned={...source,owners:[{...owner,ownerIds:[5]}]};
    expect(filterNorthAmericaEdition(frozen,base,reassigned).products).toEqual([]);
    expect(filterNorthAmericaEdition(frozen,{...base,identity:{workspaceId:7,userId:5}},reassigned).products[0].ownerIds).toEqual([5]);
    expect(()=>filterNorthAmericaEdition(frozen,base,reassigned,5)).toThrow("OPERATOR_DENIED");
    expect(filterNorthAmericaEdition(frozen,{...base,manager:true},reassigned).products).toHaveLength(1);
  });
  it("refuses altered or wrong-month archive payloads",async()=>{
    const text=JSON.stringify(payload()), digest=createHash("sha256").update(text).digest("hex");
    let row={id:1,payload:text,payloadHash:digest,archived:1};
    const execute=vi.fn(async()=>[[row],[]]),session={...base,tx:{execute}} as Session;
    expect((await readNorthAmericaEdition(session,"2026-09"))?.payload).toEqual(payload());
    row={...row,payloadHash:"f".repeat(64)};
    await expect(readNorthAmericaEdition(session,"2026-09")).rejects.toThrow("ARCHIVE_INVALID");
    row={...row,payloadHash:digest};
    await expect(readNorthAmericaEdition(session,"2026-08")).rejects.toThrow("ARCHIVE_MONTH");
  });
  it("reads original legacy months and filters legacy notes with current ownership",async()=>{
    const legacy={version:1,month:"2026-08",previousMonth:"2026-07",months:["2026-08"],availableMonths:["2026-08"],products:[{asin:parent,title:"Product",months:{"2026-08":{profit:10,qty:2,sales:100,margin:.1}},children:[]}]};
    const execute=vi.fn(async(statement:SQL)=>new MySqlDialect().sqlToQuery(statement).sql.includes("ops_profit_board_notes")?[[{asin:parent,note:"原备注"}],[]]:[[{id:2,month:"2026-08",payload:JSON.stringify(legacy)}],[]]);
    const session={...base,tx:{execute}} as Session;
    const allowed=await readLegacyNorthAmericaEdition(session,2,source);
    expect(allowed.payload.products[0].months["2026-08"].profit).toBe(10);expect(allowed.notes[0].note).toBe("原备注");
    const denied=await readLegacyNorthAmericaEdition(session,2,{...source,owners:[{...owner,ownerIds:[5]}]});
    expect(denied.payload.products).toEqual([]);expect(denied.notes).toEqual([]);
  });
});
describe("complete bounded source selection",()=>{
  beforeEach(()=>financialSourceCache.clear());
  function fixture(records:ReturnType<typeof record>[], candidateOverride?:unknown[]) {
    const calls:string[]=[];const execute=vi.fn(async (statement:SQL)=>{
      const q=new MySqlDialect().sqlToQuery(statement);calls.push(q.sql);
      if(q.sql.includes("LIMIT 201"))return [candidateOverride??records.map(({id,workspaceId,status,payloadBytes,monthsBytes,fileHash,confirmedAt,totalRows,skippedRows,unallocatedRows})=>({id,workspaceId,status,payloadBytes,monthsBytes,fileHash,confirmedAt,totalRows,skippedRows,unallocatedRows})),[]];
      return [records.filter(row=>row.id===q.params[1]),[]];
    });
    return {session:{...base,manager:true,tx:{execute}} as Session,calls};
  }
  it("a new whole-store month replaces all old rows rather than filling missing products",async()=>{
    const f=fixture([record(2,[raw({salesQty:5})]),record(1,[raw(),raw({asin:"B000000002"}),raw({site:"CA",storeName:"Store CA"})])]);
    const result=await readNorthAmericaFinancialSources(f.session);
    expect(result.rows.map(row=>[row.batchId,row.country,row.asin])).toEqual([[2,"US",asin],[1,"CA",asin]]);
    expect(result.rows[0].currencyEvidence.status).toBe("explicit");
    expect(result.rows[0].metrics.salesQty).toBe(5);
    expect(result.rows[0].raw).toEqual({});
    expect(result.rows[0].details.fields.salesAmount.components).toEqual([]);
  });
  it("refuses a truncated candidate scan and over-budget reports before reading payloads",async()=>{
    let f=fixture([],Array.from({length:201},(_,i)=>({id:201-i})));await expect(readNorthAmericaFinancialSources(f.session)).rejects.toThrow();expect(f.calls).toHaveLength(1);
    f=fixture([record()], [{id:1,workspaceId:7,status:"completed",payloadBytes:65*1024*1024,monthsBytes:10}]);await expect(readNorthAmericaFinancialSources(f.session)).rejects.toThrow();expect(f.calls).toHaveLength(1);
  });
  it("reuses compact sources, while newly imported and withdrawn batches change winners immediately",async()=>{
    const records=[record()];
    const f=fixture(records);
    const first=await readNorthAmericaFinancialSources(f.session);
    first.rows[0].metrics.salesQty=999;
    const second=await readNorthAmericaFinancialSources(f.session);
    expect(second.rows[0].metrics.salesQty).toBe(20);
    expect(f.calls.filter(sql=>!sql.includes("LIMIT 201"))).toHaveLength(1);
    records.unshift(record(2,[raw({salesQty:5})]));
    expect((await readNorthAmericaFinancialSources(f.session)).rows[0].metrics.salesQty).toBe(5);
    expect(f.calls.filter(sql=>!sql.includes("LIMIT 201"))).toHaveLength(2);
    records.shift();
    expect((await readNorthAmericaFinancialSources(f.session)).rows[0].metrics.salesQty).toBe(20);
    records[0]= {...record(1,[raw({salesQty:42})]),fileHash:"b".repeat(64)};
    expect((await readNorthAmericaFinancialSources(f.session)).rows[0].metrics.salesQty).toBe(42);
    expect(f.calls.filter(sql=>!sql.includes("LIMIT 201"))).toHaveLength(3);
  });
  it("rechecks actor and workspace before exposing any financial sources",async()=>{
    const execute=vi.fn(async()=>[[{id:3,role:"operator",status:"active",defaultWorkspaceId:8}],[]]);
    const repository=createNorthAmericaBoardRepository({database:async()=>({transaction:body=>body({execute} as Session["tx"])}),permission:vi.fn()});
    const ctx={user:{id:3,role:"operator",defaultWorkspaceId:7},workspaceId:7} as TrpcContext;
    await expect(repository.read(ctx,{expectedWorkspaceId:7})).rejects.toMatchObject({code:"FORBIDDEN"});expect(execute).toHaveBeenCalledOnce();
  });
});
