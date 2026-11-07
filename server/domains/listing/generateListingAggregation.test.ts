vi.mock("../ai_os/services/assistantConfigurations",()=>({assistantConfigurationService:{get:async()=>({status:"unconfigured"})}}));
vi.mock("./researchLocks",()=>({assertResearchEditable:vi.fn()}));
import {beforeEach,describe,expect,it,vi} from "vitest";
const f=vi.hoisted(()=>({read:vi.fn(),save:vi.fn(),project:vi.fn(),records:vi.fn(),run:vi.fn(),
}));
vi.mock("./aggregationStore",()=>({readListingAggregation:f.read,saveListingAggregation:f.save,
}));
vi.mock("../../repositories",()=>({getProjectById:f.project,getCompetitorAnalysesByProject:f.records,
}));
vi.mock("../ai_os/services/skillRunner",()=>({runEmperorSkill:f.run,safeParseSkillJSON:JSON.parse,
}));
import {generateListingAggregation} from "./generateListingAggregation";
const scope={projectId:11,workspaceId:3,userId:7};
beforeEach(()=>{vi.resetAllMocks();f.project.mockResolvedValue({workspaceId:3,productFeatures: "耐用材质",productSpecs: "",productName: "测试",
  });
 f.read.mockResolvedValue({revision:0,data:{selling:[],reviews:[],questions:[],marks:[]},
  });
 f.records.mockResolvedValue([{id:10,asin: "B012345678",rawData:JSON.stringify({comparisonAnalysis:{version:2,reviewVersion:2,generatedAt: "2026-10-29T00:00:00Z",reviewSampleCount:4,
          reviewSentimentCounts: { positive: 2, negative: 2 },listing:{bullets:[{sellingPoints:["耐用"]}]},images:[],reviews:[{name: "结实",sentiment: "positive",reviewIds:["R1", "R2"]},
          ],
        },productQuestions:[],
      }),
    },
  ]);
 f.save.mockImplementation(async (_scope,_revision,data)=>({revision:1,data,
  }));
 f.run.mockImplementation(async (request:any)=> {
    const c = JSON.parse(request.context),
      id = c.selling[0]?.id ?? "unused-in-this-section";
    return {parsed:request.validate(JSON.stringify({
          features: [
            {
              id: "F1",
              text: "耐用材质",
              note: "材料依据",
              group: "quality",
              category:"core",sourceIds: [id],
            },
          ],
          selling:[{
              id: "B1",
              text: "耐用",note: "来源可靠",group: "primary",category:"core",sourceIds:[id],
            },
          ],
          links: [{ featureId: "F1", benefitId: "B1", note: "用料支撑耐用" }],reviews: c.reviews.length
            ? [{text: "结实",note: "用户反馈",sentiment: "positive",category:"core",sourceIds: c.reviews.map((r: any) => r.id),
                },
              ]
            : [],questions:[],
        })),
    };
  });
});
describe("aggregation generation",()=>{
 it("calculates review percentages and keeps evidence references from the observed sample",async()=>{const result=await generateListingAggregation(scope,{section:"reviews"});expect(result.data.reviews[0]).toMatchObject({text: "结实",percentage:50,status: "covered",evidence:[{analysisId:10,groupIndex:0,generatedAt: "2026-10-29T00:00:00Z" },
      ],
    });expect(f.save).toHaveBeenCalledWith(scope,0,expect.anything(),undefined,{generated:true});});
 it("keeps existing human edits when updating the aggregation",async()=>{const manual={id: "1985bc06-6528-46b3-af33-fd1eaf5d8c25",text: "人工卖点",note: "人工标注",group: "secondary",
    };f.read.mockResolvedValue({revision:4,data:{selling:[manual],reviews:[],questions:[],marks:[]},
    });const result=await generateListingAggregation(scope);expect(result.data.selling).toContainEqual(manual);expect(f.save).toHaveBeenCalledWith(scope,4,expect.anything(),undefined,{generated:true});});
 it("rejects model claims without real evidence",async()=>{f.run.mockImplementation(async (request:any)=>({parsed:request.validate(JSON.stringify({
          features: [],
          links: [],
          selling:[{text: "虚构",note: "",group: "primary",category:"core",sourceIds:["S999"]},
          ],reviews:[],questions:[],
        })),
    }));await expect(generateListingAggregation(scope)).rejects.toThrow(
      "引用了不存在的依据"
    );expect(f.save).not.toHaveBeenCalled();});
});

it("prepares a reviewable result without saving or changing the stored input", async () => {
  const result = await generateListingAggregation(scope, { preview: true });
  expect(result.revision).toBe(0);
  expect(result.data.features).toHaveLength(1);
  expect(result.data.links).toHaveLength(1);
  expect(f.save).not.toHaveBeenCalled();
});
it("adds review counts and uses the combined sample instead of averaging percentages", async () => {
  const records = await f.records();
  records.push({
    id: 11,
    asin: "B012345679",
    rawData: JSON.stringify({
      comparisonAnalysis: {
        version: 2,
        reviewVersion: 2,
        generatedAt: "2026-11-01",
        reviewSampleCount: 10,
        reviewSentimentCounts: { positive: 5, negative: 5 },
        listing: { bullets: [] },
        images: [],
        reviews: [
          {
            name: "结实耐用",
            reason: "",
            sentiment: "positive",
            reviewIds: ["R1"],
          },
        ],
      },
    }),
  });
  f.records.mockResolvedValue(records);
  const result = await generateListingAggregation(scope, { preview: true,section:"reviews" });
  expect(result.data.reviews[0]).toMatchObject({
    count: 3,
    sampleSize: 14,
    percentage: 21.4,
  });
  expect(result.data.reviewSummary).toMatchObject({
    sampleCount: 14,
    positive: 7,
    negative: 7,
    asinCount: 2,
  });
});

it("reuses an existing concept ID after a human renames it", async () => {
  const id = "11111111-1111-4111-8111-111111111111",
    node = {
      id,
      text: "人工命名耐用",
      group: "secondary",
      note: "保留说明",
      manual: true,
    };
  f.read.mockResolvedValue({
    revision: 3,
    data: { selling: [node], reviews: [], questions: [], marks: [] },
  });
  const original = f.run.getMockImplementation()!;
  f.run.mockImplementation(async request => {
    const result = await original(request);
    result.parsed.selling[0].id = id;
    return result;
  });
  const result = await generateListingAggregation(scope, { preview: true });
  expect(result.data.selling).toHaveLength(1);
  expect(result.data.selling[0]).toMatchObject(node);
});

it("moves a reused legacy configuration into features while preserving its original wording in annotations",async()=>{const id="11111111-1111-4111-8111-111111111111",node={id,text:"旧版完整的耐用材质配置描述",group:"primary",note:"既有说明"};f.read.mockResolvedValue({revision:3,data:{selling:[node],reviews:[],questions:[],marks:[]}});const original=f.run.getMockImplementation()!;f.run.mockImplementation(async request=>{const result=await original(request);result.parsed.features[0].id=id;result.parsed.links[0].featureId=id;return result;});const result=await generateListingAggregation(scope,{preview:true});expect(result.data.features![0]).toMatchObject({id,text:"耐用材质",group:"quality"});expect(result.data.features![0].note).toContain(node.text);expect(result.data.features![0].note).toContain(node.note);expect(result.data.selling.some(n=>n.id===id)).toBe(false);expect(result.data.links![0].featureId).toBe(id);});

it("archives superseded generated review totals instead of duplicating current themes",async()=>{const old={id:"11111111-1111-4111-8111-111111111111",text:"旧版结实与质量汇总",note:"保留旧标注",sentiment:"positive",sampleSize:8,percentage:75,status:"unset"};f.read.mockResolvedValue({revision:3,data:{selling:[],reviews:[old],questions:[],marks:[]}});const result=await generateListingAggregation(scope,{preview:true,section:"reviews"});expect(result.data.reviews).toHaveLength(1);expect(result.data.reviews[0]).toMatchObject({count:2,sampleSize:4,percentage:50});expect(result.data.reviewHistory).toContainEqual(old);});

it("does not resurrect a removed concept when the model rephrases its name but reuses its identity",async()=>{const id="11111111-1111-4111-8111-111111111111";f.read.mockResolvedValue({revision:3,data:{selling:[],features:[],reviews:[],questions:[],marks:[],excludedConcepts:[{id,kind:"features",text:"旧配置名称",sourceKey:"old-key"}]}});const original=f.run.getMockImplementation()!;f.run.mockImplementation(async request=>{const result=await original(request);expect(JSON.parse(request.context).excludedConcepts[0].id).toBe(id);result.parsed.features[0].id=id;result.parsed.links[0].featureId=id;return result;});const result=await generateListingAggregation(scope,{preview:true});expect(result.data.features).toEqual([]);expect(result.data.links).toEqual([]);});

it("repairs source IDs, answers every existing question and preserves the operator's wording",async()=>{
 const id="11111111-1111-4111-8111-111111111111";
 f.project.mockResolvedValue({workspaceId:3,productFeatures:"本品6个口袋",productSpecs:"",productName:"养蜂服"});
 f.read.mockResolvedValue({revision:8,data:{selling:[],features:[],reviews:[],questions:[{id,text:"本品是几个口袋？",note:"运营的问题说明",answer:"",manual:true,manualFields:["text","note","answer"],source:"manual"}],marks:[],productNotes:"本品6个口袋"}});
 let calls=0;
 f.run.mockImplementation(async request=>{const c=JSON.parse(request.context);calls++;if(calls===2)expect(c.correction).toContain("不存在的依据");return {parsed:request.validate(JSON.stringify({questions:[{id,text:"AI打算改标题",note:"新的说明",category:"details",source:"inferred",answer:"提供6个口袋，方便分类收纳作业工具。",sourceIds:[calls===1?id:"PRODUCT:notes"]}]}))};});
 const result=await generateListingAggregation(scope,{preview:true,section:"questions"});expect(calls).toBe(2);expect(result.data.questions[0]).toMatchObject({id,text:"本品是几个口袋？",note:"运营的问题说明",answer:"提供6个口袋，方便分类收纳作业工具。"});
});

it("answers from confirmed product facts without sending full evidence or legacy competitor attributes",async()=>{
 const id="11111111-1111-4111-8111-111111111111";
 f.project.mockResolvedValue({workspaceId:3,productName:"养蜂服",productFeatures:"旧表8个口袋",productSpecs:"旧竞品参数"});
 f.read.mockResolvedValue({revision:8,data:{selling:[],features:[{id,text:"6个口袋",note:"运营确认",group:"detail",manual:true,manualFields:["text"],evidence:[{kind:"user",basis:"user",sourceKey:"manual-evidence",quote:"HUGE_EVIDENCE".repeat(400)}]}],reviews:[],questions:[],marks:[]}});
 f.run.mockImplementation(async request=>{const c=JSON.parse(request.context);expect(c.currentProductFacts.features[0].text).toBe("6个口袋");expect(c.product).toEqual({productName:"养蜂服"});expect(c.selling.map((s:any)=>s.id)).toEqual(["PRODUCT:CONFIRMED:"+id]);expect(request.context).not.toContain("HUGE_EVIDENCE");return {parsed:request.validate(JSON.stringify({questions:[{text:"口袋能装工具吗？",note:"收纳工具",category:"details",source:"listing",answer:"6个口袋便于分类放置工具。",sourceIds:["PRODUCT:CONFIRMED:"+id]}]}))};});
 const result=await generateListingAggregation(scope,{preview:true,section:"questions"});expect(result.data.questions[0].answer).toContain("6个口袋");
});

it("repairs an unsupported manufacturing claim before returning a question preview",async()=>{
 f.read.mockResolvedValue({revision:0,data:{selling:[],features:[],reviews:[],questions:[],marks:[],productNotes:"六组尺码，有详细尺码说明"}});
 let calls=0;
 f.run.mockImplementation(async request=>{const c=JSON.parse(request.context);calls++;if(calls===2)expect(c.correction).toContain("预缩");return {parsed:request.validate(JSON.stringify({questions:[{text:"如何选尺码？",note:"选码说明",category:"information",source:"listing",answer:calls===1?"本品经过预缩处理，预留8-10英寸余量。":"提供六组尺码与详细说明，可对照身体测量结果选择。",sourceIds:["PRODUCT:notes"]}]}))};});
 const result=await generateListingAggregation(scope,{preview:true,section:"questions"});expect(calls).toBe(2);expect(result.data.questions[0].answer).not.toContain("预缩");
});

it("retains the saved comparison scope and its own-product source when an existing differentiated node is returned without them",async()=>{
 const id="11111111-1111-4111-8111-111111111111";
 f.read.mockResolvedValue({revision:1,data:{selling:[],features:[{id,text:"宽带袖口",note:"运营确认",group:"differentiated",category:"details",comparisonScope:"相对细绳袖口款，采用宽弹性带；不宣称市场独有。"}],reviews:[],questions:[],marks:[]}});
 f.run.mockImplementation(async request=>{const c=JSON.parse(request.context);return {parsed:request.validate(JSON.stringify({features:[{id,text:"宽带袖口",note:"宽带减少勒感",group:"differentiated",category:"details",sourceIds:[c.selling.find((s:any)=>!s.id.startsWith("PRODUCT:")).id]}],selling:[],links:[]}))};});
 const result=await generateListingAggregation(scope,{preview:true});expect(result.data.features![0].comparisonScope).toContain("相对细绳袖口款");expect(result.data.features![0].evidence.some(e=>e.sourceKey==="PRODUCT:CONFIRMED:"+id)).toBe(true);
});
it("replaces several answered sizing questions with one comprehensive question and answer",async()=>{
 const first="11111111-1111-4111-8111-111111111111",second="22222222-2222-4222-8222-222222222222";
 f.read.mockResolvedValue({revision:3,data:{selling:[],features:[],reviews:[],marks:[],productNotes:"提供六组尺码和详细选码说明",questions:[{id:first,text:"尺码偏大偏小？",note:"",answer:"有六组尺码。",source:"inferred"},{id:second,text:"如何按身高体重选码？",note:"",answer:"对照选码说明。",source:"inferred"}]}});
 f.run.mockImplementation(async request=>({parsed:request.validate(JSON.stringify({questions:[{id:first,text:"尺码是否合适，如何选择合适尺码？",note:"综合尺码偏差、合身与选码",answer:"提供六组尺码和详细说明，建议按身体测量结果对照选择，并预留作业活动空间。",category:"information",source:"listing",sourceIds:["PRODUCT:notes"],mergedQuestionIds:[first,second]}]}))}));
 const result=await generateListingAggregation(scope,{preview:true,section:"questions"});expect(result.data.questions).toHaveLength(1);expect(result.data.questions[0].originalQuestions).toHaveLength(2);expect(result.data.questionMergeBase).toMatch(/^[a-f0-9]{64}$/);
});
