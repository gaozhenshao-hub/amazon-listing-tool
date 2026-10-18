import { describe, expect, it, vi } from "vitest";
import { INVENTORY_PLANNING_DEFAULTS } from "../../../shared/inventoryPlanningWrite";
import { loadInventoryPlanningManualReader } from "./inventoryPlanningManualRead";

const identity={workspaceId:11,userId:7}, scope={scopeType:"asin" as const,asin:"B000000001",storeName:"Shop-US",country:"US"};
const time=new Date("2026-10-18T00:00:00.000Z");
const parameter=(changes:Record<string,unknown>={})=>({ ...INVENTORY_PLANNING_DEFAULTS,id:1,...identity,scopeType:"workspace",asin:null,parentAsin:null,storeName:null,country:null,isActive:1,createdAt:time,updatedAt:time,...changes });
const local=(changes:Record<string,unknown>={})=>({ id:1,...identity,asin:scope.asin,storeName:scope.storeName,country:scope.country,effectiveDate:"2026-10-18",localQty:40,reason:null,status:"confirmed",confirmedBy:identity.userId,confirmedAt:time,supersededById:null,createdAt:time,updatedAt:time,...changes });
const read=(parameters:unknown=[],locals:unknown=[])=>loadInventoryPlanningManualReader({identity,loadParameters:async()=>parameters,loadLocals:async()=>locals});

describe("honest actor-private inventory planning manual reader",()=>{
  it("uses explicit defaults only after both empty histories were successfully read",async()=>{
    const parameters=vi.fn(async()=>[]),locals=vi.fn(async()=>[]);
    const resolve=await loadInventoryPlanningManualReader({identity,loadParameters:parameters,loadLocals:locals});
    const state=resolve(scope,"2026-10-18");
    expect(parameters).toHaveBeenCalledTimes(1);expect(locals).toHaveBeenCalledTimes(1);
    expect(state.parameters.effective).toEqual(INVENTORY_PLANNING_DEFAULTS);expect(state.parameters.resolvedFrom).toBe("system_defaults");expect(state.local.current).toBeNull();
    resolve({...scope,asin:"B000000002"},"2026-10-18");expect(parameters).toHaveBeenCalledTimes(1);expect(locals).toHaveBeenCalledTimes(1);
  });
  it.each(["loadParameters","loadLocals"] as const)("never fabricates zeros/defaults on %s failure or leaks the database exception",async failing=>{
    const loads={loadParameters:async()=>[parameter()],loadLocals:async()=>[local()]};
    loads[failing]=async()=>{throw new Error("private-database-host secret-value");};
    await expect(loadInventoryPlanningManualReader({identity,...loads})).rejects.toMatchObject({code:"PRECONDITION_FAILED",message:expect.stringContaining("未使用零库存或默认参数替代")});
    await expect(loadInventoryPlanningManualReader({identity,...loads})).rejects.not.toThrow(/private-database-host|secret-value/);
  });
  it.each([undefined,null,{},"[]"])("does not treat malformed query result %s as an empty history",async result=>{
    await expect(loadInventoryPlanningManualReader({identity,loadParameters:async()=>result,loadLocals:async()=>[]})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    await expect(loadInventoryPlanningManualReader({identity,loadParameters:async()=>[],loadLocals:async()=>result})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
  });
  it("keeps all cost/package fields and USD units from the same selected complete parameter row",async()=>{
    const row=parameter({productCost:"0.00",sellingPrice:"29.99",actualFbaFee:null,estimatedDimensions:"10×12×15",dimensionUnit:"cm",estimatedWeight:"1.230",weightUnit:"kg",targetCoverDays:47,moq:14,packSize:7});
    const state=(await read([row]))(scope,"2026-10-18");
    expect(state.parameters.effective).toMatchObject({productCost:0,sellingPrice:29.99,actualFbaFee:null,estimatedDimensions:"10×12×15",dimensionUnit:"cm",estimatedWeight:1.23,weightUnit:"kg",targetCoverDays:47,moq:14,packSize:7});
  });
  it("preserves child > store-country > workspace and never applies parent override",async()=>{
    const rows=[parameter({productionDays:25}),parameter({id:2,scopeType:"store_country",storeName:scope.storeName,country:scope.country,productionDays:35}),parameter({id:3,scopeType:"parent_asin",parentAsin:"P000000001",storeName:scope.storeName,country:scope.country,productionDays:99})];
    expect((await read(rows))(scope,"2026-10-18").parameters.effective.productionDays).toBe(35);
    rows.push(parameter({id:4,...scope,parentAsin:"P000000001",productionDays:45}));
    expect((await read(rows))(scope,"2026-10-18").parameters.effective.productionDays).toBe(45);
  });
  it("rejects the known parent-metadata alias duplicate instead of choosing an arbitrary cost/lead row",async()=>{
    await expect(read([parameter({...scope,parentAsin:null}),parameter({id:2,...scope,parentAsin:"P000000001",productCost:"12.34"})])).rejects.toThrow(/PARAMETER_CONFLICT/);
  });
  it("never crosses workspace or actor identity",async()=>{
    await expect(read([parameter({userId:8})])).rejects.toThrow(/IDENTITY_MISMATCH/);
    await expect(read([],[local({workspaceId:12})])).rejects.toThrow(/IDENTITY_MISMATCH/);
  });
  it("retains same-day highest-ID and latest-effective-date selection with complete old history",async()=>{
    const resolve=await read([],[local({id:1,effectiveDate:"2026-10-16",localQty:10}),local({id:2,localQty:20}),local({id:3,localQty:30}),local({id:4,effectiveDate:"2026-10-19",localQty:99})]);
    expect(resolve(scope,"2026-10-18").local.current?.localQty).toBe(30);
    expect(resolve(scope,"2026-10-17").local.current?.localQty).toBe(10);
    expect(resolve(scope,"2026-10-19").local.current?.localQty).toBe(99);
    expect(resolve(scope,"2026-10-18").local.history).toHaveLength(4);
  });
  it("distinguishes explicit zero inventory from absence",async()=>{
    expect((await read([],[local({localQty:0})]))(scope,"2026-10-18").local.current?.localQty).toBe(0);
    expect((await read([],[local({effectiveDate:"2026-10-19"})]))(scope,"2026-10-18").local.current).toBeNull();
  });
  it("rejects an invalid saved number rather than using numeric fallback",async()=>{
    await expect(read([parameter({productCost:"NaN"})])).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    await expect(read([],[local({localQty:-1})])).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
  });
  it("does not normalize a single original Chinese country identity into a different scope",async()=>{
    const resolve=await read([parameter({...scope,country:"美国",productCost:"7.50"})],[local({country:"美国"})]);
    expect(resolve({...scope,country:"美国"},"2026-10-18").parameters.effective.productCost).toBe(7.5);
    expect(()=>resolve(scope,"2026-10-18")).toThrow();
  });
  it("returns a controlled data error for malformed scope/date, not partial planning output",async()=>{
    const resolve=await read();
    expect(()=>resolve(scope,"2026-02-30")).toThrow(/暂不可核验/);
    expect(()=>resolve({...scope,asin:""},"2026-10-18")).toThrow(/暂不可核验/);
  });
});
