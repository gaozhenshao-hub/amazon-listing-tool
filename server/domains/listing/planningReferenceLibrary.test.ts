import { it,expect,vi } from "vitest";
const f=vi.hoisted(()=>({records:vi.fn(),aggregate:vi.fn(),url:vi.fn()}));
vi.mock("../../repositories",()=>({getCompetitorAnalysesByProject:f.records}));
vi.mock("./aggregationStore",()=>({readListingAggregation:f.aggregate}));
vi.mock("../../storage",()=>({resolveStoredObjectUrl:f.url}));
import { competitorReferenceImages } from "./planningReferenceLibrary";
it("亮灯图片优先，保留同类图片独立序号并排除视频和重复素材",async()=>{const a="a".repeat(64),b="b".repeat(64),c="c".repeat(64),scope={projectId:1,workspaceId:3,userId:7};f.records.mockResolvedValue([{id:2,asin:"B000000002",rawData:{imageAssets:[{sourceUrlHash:a,storageKey:"image-a",role:"aplus"},{sourceUrlHash:a,storageKey:"duplicate",role:"aplus"},{sourceUrlHash:b,storageKey:"image-b",role:"aplus"},{sourceUrlHash:c,storageKey:"video-c",role:"main_video"}]}}]);f.aggregate.mockResolvedValue({data:{marks:[{analysisId:2,likedAssets:[b]}]}});f.url.mockImplementation(async(key:string)=>"https://example.com/"+key);const images=await competitorReferenceImages(scope);expect(images.map(i=>i.hash)).toEqual([b,a]);expect(images.map(i=>i.ordinal)).toEqual([2,1]);expect(images[0].liked).toBe(true);expect(f.aggregate).toHaveBeenCalledWith(scope);expect(f.records).toHaveBeenCalledWith(1);});
