import { beforeEach, describe, expect, it, vi } from "vitest";
import { listingAggregationSchema } from "../../../shared/listingAggregation";
import {questionMergeSignature} from "../../../shared/questionMerging";

const f = vi.hoisted(() => ({ revision: 0, data: null as unknown, projectPresent: true }));
vi.mock("../../repositories/dbClient", () => ({ requireDb: async () => ({ transaction: async (fn: (tx: unknown) => unknown) => fn({ execute: async (q: any) => {
  const text = JSON.stringify(q.queryChunks);
  if (text.includes("SELECT id FROM projects")) return [f.projectPresent ? [{ id: 11 }] : []];
  if (text.includes("SELECT rawData,bulletPoints FROM competitorAnalyses")) return [[{rawData:JSON.stringify({imageAssets:[{sourceUrlHash:'a'.repeat(64)}]}),bulletPoints:JSON.stringify(['very durable'])}]];
  if (text.includes("SELECT data,revision FROM listing_aggregations")) return [f.revision ? [{revision:f.revision,data:f.data}] : []];
  if (text.includes("SELECT revision FROM listing_aggregations")) return [f.revision ? [{ revision: f.revision }] : []];
  if (text.includes("INSERT INTO listing_aggregations") || text.includes("UPDATE listing_aggregations")) { f.revision++; return [{ affectedRows: 1 }]; }
  throw new Error("unexpected query");
} }) }) }));
import { saveListingAggregation, updateCompetitorMark } from "./aggregationStore";

const scope = { projectId: 11, workspaceId: 3, userId: 7 };
const empty = { selling: [], reviews: [], questions: [], marks: [] };
beforeEach(() => { f.revision = 0; f.projectPresent = true; });
describe("aggregation persistence", () => {
  it("rejects a question merge preview when an operator edited a member after generation",async()=>{
    f.revision=2;f.data={...empty,questions:[{id:"11111111-1111-4111-8111-111111111111",text:"运营刚修改的问题",note:"",source:"manual",manual:true}]};
    await expect(saveListingAggregation(scope,2,{...empty,questionMergeBase:questionMergeSignature([])},undefined,{generated:true,section:"questions"})).rejects.toThrow("买家问题已被编辑");
    expect(f.revision).toBe(2);
  });
  it("saves with a revision and rejects stale edits", async () => {
    expect(await saveListingAggregation(scope, 0, empty)).toEqual({ data: empty, revision: 1 });
    await expect(saveListingAggregation(scope, 0, empty)).rejects.toThrow("已被其他操作更新");
    expect(f.revision).toBe(1);
  });
  it("requires the project to belong to the current user and workspace", async () => {
    f.projectPresent = false;
    await expect(saveListingAggregation(scope, 0, empty)).rejects.toThrow("项目不可访问");
  });
  it("accepts only status choices valid for the review sentiment", () => {
    const base = { id: "1985bc06-6528-46b3-af33-fd1eaf5d8c25", text: "结实", note: "", percentage: 40 };
    expect(listingAggregationSchema.safeParse({ ...empty, reviews: [{ ...base, sentiment: "positive", status: "covered" }] }).success).toBe(true);
    expect(listingAggregationSchema.safeParse({ ...empty, reviews: [{ ...base, sentiment: "negative", status: "solved" }] }).success).toBe(true);
    expect(listingAggregationSchema.safeParse({ ...empty, reviews: [{ ...base, sentiment: "positive", status: "solved" }] }).success).toBe(false);
  });
  it("saves a marked image and verifies selected text against the original bullet", async () => {
    const image=await updateCompetitorMark(scope,20,{type:'image',hash:'a'.repeat(64)});
    expect(image.data.marks[0].likedAssets).toEqual(['a'.repeat(64)]);
    f.data=image.data;
    const text=await updateCompetitorMark(scope,20,{type:'highlight',bulletIndex:0,start:5,end:12,text:'durable'});
    expect(text.data.marks[0].highlights).toEqual([{bulletIndex:0,start:5,end:12,text:'durable'}]);
    await expect(updateCompetitorMark(scope,20,{type:'highlight',bulletIndex:0,start:0,end:4,text:'wrong'})).rejects.toThrow('五点描述已变化');
  });
});
