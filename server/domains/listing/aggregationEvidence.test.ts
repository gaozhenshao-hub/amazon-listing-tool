import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  project: vi.fn(),
  records: vi.fn(),
  url: vi.fn(),
  read:vi.fn(),
}));
vi.mock("../../repositories", () => ({
  getProjectById: f.project,
  getCompetitorAnalysesByProject: f.records,
}));
vi.mock("./aggregationStore", () => ({
  readListingAggregation: f.read,
}));
vi.mock("./competitorPresentation", () => ({
  hydrateCompetitorEvidence: vi.fn(async r => r),
}));
vi.mock("../../storage", () => ({ resolveStoredObjectUrl: f.url }));
import { aggregationSourceEvidence } from "./aggregationEvidence";
const hash = "a".repeat(64),
  scope = { projectId: 1, workspaceId: 1, userId: 2 };
beforeEach(() => {
  vi.clearAllMocks();
  f.project.mockResolvedValue({ workspaceId: 1 });
  f.read.mockResolvedValue({revision:0,data:{marks:[],features:[],selling:[],reviews:[],questions:[]}});
  f.url.mockResolvedValue("/signed/original.jpg");
  f.records.mockResolvedValue([
    {
      id: 10,
      asin: "B012345678",
      title: "Suit",
      rawData: JSON.stringify({
        comparisonAnalysis: {
          version: 2,
          generatedAt: "2026-11-01",
          images: [{ hash, translation: "厚实面料", sellingPoints: ["耐用"] }],
          listing: { bullets: [] },
        },
        imageAssets: [
          {
            role: "main",
            sourceUrlHash: hash,
            storageKey: "storage://local/acquisition/1/image.jpg",
          },
        ],
      }),
    },
  ]);
});
it("resolves the original image and flags edited or stale client quotes", async () => {
  const result = await aggregationSourceEvidence(scope, [
    {
      analysisId: 10,
      kind: "image",
      sourceKey: "image:" + hash + ":sellingPoints",
      hash,
      quote: "客户端改写的描述",
      basis: "direct",
    },
  ]);
  expect(result.items[0]).toMatchObject({
    imageUrl: "/signed/original.jpg",
    quote: "厚实面料",
    stale: true,
    asin: "B012345678",
  });
});
it("does not resolve a guessed source from another project", async () => {
  const result = await aggregationSourceEvidence(scope, [
    {
      analysisId: 99,
      kind: "image",
      sourceKey: "image:" + hash + ":sellingPoints",
      hash,
      quote: "",
      basis: "direct",
    },
  ]);
  expect(result.items[0].imageUrl).toBeNull();
  expect(f.url).not.toHaveBeenCalled();
});
it("rejects a mismatched workspace before reading records", async () => {
  f.project.mockResolvedValue({ workspaceId: 99 });
  await expect(aggregationSourceEvidence(scope, [])).rejects.toThrow(
    "不可访问"
  );
  expect(f.records).not.toHaveBeenCalled();
});

it("resolves individual video findings even when the poster shares the clip hash",async()=>{const records=await f.records();const raw=JSON.parse(records[0].rawData);raw.imageAssets.push({role:"main",sourceUrlHash:hash,storageKey:"storage://local/poster.jpg"},{role:"video",sourceUrlHash:hash,storageKey:"storage://local/movie.mp4"});raw.videos=[{hash,role:"main",moduleId:"main-video",status:"ready"}];raw.comparisonAnalysis.videoAnalyses=[{hash,status:"complete",cues:[],sellingPoints:[{text:"领口密封",moments:[{start:1,end:3,reason:"领口特写"}]},{text:"口袋便于收纳",moments:[{start:5,end:8,reason:"口袋特写"}]}]}];records[0].rawData=JSON.stringify(raw);f.records.mockResolvedValue(records);const result=await aggregationSourceEvidence(scope,[{analysisId:10,kind:"video",sourceKey:"video:"+hash+":0",hash,quote:"领口密封",basis:"direct",start:1,end:3}]);expect(result.items[0]).toMatchObject({stale:false,quote:"领口密封",video:{status:"ready",videoUrl:"/signed/original.jpg"},start:1});expect(f.url).toHaveBeenCalledWith("storage://local/movie.mp4");});

it("loads persisted evidence by a short node identity without sending quotations through the URL",async()=>{const id="11111111-1111-4111-8111-111111111111";f.read.mockResolvedValue({revision:1,data:{marks:[],features:[{id,text:"耐用",note:"",group:"quality",evidence:[{analysisId:10,kind:"image",sourceKey:"image:"+hash+":sellingPoints",hash,quote:"厚实面料",basis:"direct"}]}],selling:[],reviews:[],questions:[]}});const result=await aggregationSourceEvidence(scope,id);expect(result.items[0]).toMatchObject({stale:false,imageUrl:"/signed/original.jpg"});await expect(aggregationSourceEvidence(scope,"22222222-2222-4222-8222-222222222222")).rejects.toThrow("已更新");});
