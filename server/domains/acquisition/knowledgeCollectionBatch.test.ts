import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
const state = vi.hoisted(() => ({ sets: [] as any[], jobs: [] as any[], parents: [] as any[], handler: null as any, execute: vi.fn(), progress: vi.fn(), locks: 0 }));
vi.mock("../../repositories/dbClient", () => {
  const select = () => ({ from: (table: any) => {
    const rows = () => {
      const name = getTableName(table);
      return name === "workspaces" ? [{id:1}] : name === "ai_jobs" ? state.parents : name === "kb_image_sets" ? state.sets : state.jobs;
    };
    return { where: () => ({ then: (resolve: any) => Promise.resolve(rows()).then(resolve), limit: async () => rows(), for: async () => { state.locks++; return rows(); } }) };
  } });
  const db = { select, insert: () => ({ values: async (row: any) => { state.parents.push(row); } }) };
  return { requireDb: async () => db, withDbTransaction: async (_: string, fn: any) => fn(db) };
});
vi.mock("../../services/aiJobRunner", () => ({ registerAiJobHandler: (handler: any) => { state.handler = handler.handler; }, updateAiJobProgress: state.progress }));
vi.mock("./basicProviderProfile", () => ({ getBasicImagesProfile: async () => ({id:1, capabilities:["catalog_basic","image_gallery","aplus","brand_story"]}) }));
vi.mock("./repository", () => ({
  createAcquisitionJob: async (_: any, row: any) => { const id = state.jobs.length + 1; state.jobs.push({...row,id}); return id; },
  getAcquisitionJob: async (_: any, __: any, id: number) => state.jobs.find(job => job.id === id),
  updateAcquisitionJob: async (_: any, __: any, id: number, patch: any) => Object.assign(state.jobs.find(job => job.id === id), patch),
}));
vi.mock("./acquisitionJobs", () => ({ executeAmazonAcquisitionJob: state.execute }));
import { startKnowledgeCollectionBatch } from "./knowledgeCollectionBatch";
const asins = Array.from({length:10}, (_, i) => `B${String(i).padStart(9,'0')}`);
const request = () => ({workspaceId:1, requestedBy:7, requestId:crypto.randomUUID(), asins, mode:"normal" as const});
beforeEach(() => { state.sets=[]; state.jobs=[]; state.parents=[]; state.locks=0; state.execute.mockReset(); state.progress.mockClear(); });
describe("durable knowledge collection", () => {
  it("recognizes legacy version names without sourceAsin and creates no normal task", async () => {
    state.sets = [{ asin: `新${asins[0]}`, sourceAsin: null, version: 1 },
      { asin: `新2${asins[1]}`, sourceAsin: "", version: 1 }];
    const result = await startKnowledgeCollectionBatch({ ...request(), asins: asins.slice(0, 2) });
    expect(result.skippedItems).toEqual(asins.slice(0, 2).map(asin => ({ asin, reason: "exists" })));
    expect(state.jobs).toHaveLength(0); expect(state.parents).toHaveLength(0);
  });
  it("reserves a fresh version for legacy aliases when explicitly recollecting", async () => {
    const asin = asins[0];
    state.sets = [{ asin: `新2${asin}`, sourceAsin: null, version: 1 }];
    state.jobs = [{ id: 1, asin, status: "confirmed", requestedBy: 7, consumerType: "kb_images" }];
    const input = { ...request(), asins: [asin] };
    const result = await startKnowledgeCollectionBatch(input, { recollectJobId: 1 });
    expect(result.items[0]).toMatchObject({ asin, displayAsin: `新3${asin}`, version: 4 });
    expect(state.jobs[1].asin).toBe(asin);
    expect(await startKnowledgeCollectionBatch(input, { recollectJobId: 1 })).toEqual(result);
    expect(state.jobs).toHaveLength(2);
  });
  it("retries a missing-image task once and preserves its old record and assets", async () => {
    state.jobs = [{ id: 1, asin: asins[0], status: "review_required", requestedBy: 7, consumerType: "kb_images" }];
    const result = await startKnowledgeCollectionBatch({ ...request(), asins: [asins[0]] }, { recollectJobId: 1 });
    expect(result.items).toHaveLength(1);
    expect(state.jobs[0]).toMatchObject({ status: "canceled" });
    expect(state.jobs[0].deletedAt).toBeUndefined();
  });
  it("does not recollect while another task already owns this ASIN", async () => {
    state.jobs = [{ id: 1, asin: asins[0], status: "failed", requestedBy: 7, consumerType: "kb_images" },
      { id: 2, asin: asins[0], status: "running", requestedBy: 7, consumerType: "kb_images" }];
    const result = await startKnowledgeCollectionBatch({ ...request(), asins: [asins[0]] }, { recollectJobId: 1 });
    expect(result.items).toHaveLength(0);
    expect(state.jobs).toHaveLength(2);
  });
  it("creates seven ordered tasks for ten inputs with three duplicates, and replay creates none", async () => {
    state.sets = asins.slice(0,3).map(asin => ({asin,sourceAsin:asin,version:1}));
    const input = request(), result = await startKnowledgeCollectionBatch(input);
    expect(result.skippedItems.map(i=>i.asin)).toEqual(asins.slice(0,3));
    expect(result.items.map(i=>i.asin)).toEqual(asins.slice(3));
    expect(state.parents).toHaveLength(1);expect(state.jobs).toHaveLength(7);expect(state.locks).toBe(1);
    expect(await startKnowledgeCollectionBatch(input)).toEqual(result);expect(state.jobs).toHaveLength(7);
    await expect(startKnowledgeCollectionBatch({...input,requestedBy:8})).rejects.toThrow("提交内容已变化");
  });
  it("blocks queued and pending-supplement ASINs without creating any job", async () => {
    state.jobs=[{asin:asins[0],status:"queued"},{asin:asins[1],status:"review_required"}];
    const result=await startKnowledgeCollectionBatch({...request(),asins:asins.slice(0,2)});
    expect(result.items).toHaveLength(0);expect(result.skippedItems.every(i=>i.reason==="active")).toBe(true);expect(state.parents).toHaveLength(0);
  });
  it("allocates another version while the provider request retains the real ASIN", async () => {
    const asin=asins[0];state.sets=[{asin,sourceAsin:asin,version:1},{asin:`新${asin}`,sourceAsin:asin,version:2}];
    const result=await startKnowledgeCollectionBatch({...request(),asins:[asin],mode:"new_version"});
    expect(result.items[0]).toMatchObject({asin,displayAsin:`新2${asin}`,version:3});
    expect(state.jobs[0]).toMatchObject({asin,consumerRef:`kb-images:US:${asin}:version:3`,cachePolicy:"refresh"});
    expect(state.sets).toHaveLength(2);
  });
  it("runs sequentially, continues after an item throws, and skips completed items on recovery", async () => {
    await startKnowledgeCollectionBatch({...request(),asins:asins.slice(0,3)});
    state.jobs[0].status="confirmed";
    let running=0,max=0;const order:number[]=[];
    state.execute.mockImplementation(async (job:any) => {
      const id=job.input.acquisitionJobId;order.push(id);running++;max=Math.max(max,running);
      await new Promise(resolve=>setTimeout(resolve,5));running--;if(id===2)throw Error("single failure");state.jobs[2].status="confirmed";
    });
    await state.handler({...state.parents[0],workspaceId:1,userId:7},{signal:new AbortController().signal});
    expect(order).toEqual([2,3]);expect(max).toBe(1);expect(state.jobs.map(j=>j.status)).toEqual(["confirmed","failed","confirmed"]);
  });
});
