import { beforeEach,describe,expect,it,vi } from "vitest";
import sharp from "sharp";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { IMAGE_TAGGING_OPTIONS } from "../../../shared/imageTagging";
const mocks=vi.hoisted(()=>({execute:vi.fn(),run:vi.fn(),config:vi.fn(),register:vi.fn(),enqueue:vi.fn(),getJob:vi.fn(),put:vi.fn()}));
vi.mock("../../repositories/dbClient",()=>({requireDb:async()=>({execute:mocks.execute})}));
vi.mock("../../storage",()=>({storagePut:mocks.put}));
vi.mock("./automaticTagging",()=>({imageTaggerConfiguration:mocks.config}));
vi.mock("../../services/emperorSkillRunner",()=>({runEmperorSkill:mocks.run}));
vi.mock("../../services/aiJobRunner",()=>({registerAiJobHandler:mocks.register,startRegisteredAiJob:mocks.enqueue,getAiJobRun:mocks.getJob}));
vi.mock("./taggingUnitPreview",()=>({taggingUnitPreview:async()=>Buffer.from("preview")}));
import {prepareStandaloneImage,standaloneImageAccess,uploadStandaloneImage,saveStandaloneTags,enqueueStandaloneTags,requireStandaloneImage,STANDALONE_TAGGING_KIND} from "./standaloneImages";
const handler=mocks.register.mock.calls.find(([spec])=>spec.id===STANDALONE_TAGGING_KIND)![0].handler;
const dialect=new MySqlDialect(),scope={userId:7,workspaceId:42};
const candidate={tagCategory:IMAGE_TAGGING_OPTIONS.categories[0],tagImageTypeMain:"细节",tagImageTypeSub:"单一特写",tagSellingPointCategory:"",tagSellingPointDetail:"",tagComposition:"一分构图",tagColorSchemeV2:"白色",tagDesignStyleV2:IMAGE_TAGGING_OPTIONS.styles[0],accentColor:"",evidence:"背景为白色，单一产品特写"};
const base={id:1,imageSetId:null,userId:7,workspaceId:42,imagePosition:"secondary",imageUrl:"storage://local/knowledge/42/images/7/a.webp",uploadHash:"a",labelStatus:"pending",labelRevision:0,labelRunId:null,uploadTitle:"test"};
let statements:Array<{sql:string;params:unknown[]}>,current:any;
beforeEach(()=>{
  vi.clearAllMocks();statements=[];current={...base};
  mocks.execute.mockImplementation(async query=>{const q=dialect.sqlToQuery(query);statements.push(q);return q.sql.startsWith("SELECT")?[[{...current}]]:[{affectedRows:1}];});
  mocks.config.mockResolvedValue({config:{modelSlug:"vision",rules:[],instructions:""},snapshot:{version:"6",manifestHash:"hash"},revision:5});
  mocks.getJob.mockResolvedValue(null);mocks.enqueue.mockResolvedValue({status:"queued"});
  mocks.run.mockResolvedValue({content:JSON.stringify({items:[{imageId:1,...candidate}]})});
  mocks.put.mockImplementation(async key=>({storageUri:"storage://local/"+key}));
});
describe("independent image upload and tagging",()=>{
  it("fully decodes supported images, creates bounded thumbnails, and rejects disguised or corrupt uploads",async()=>{
    const input=await sharp({create:{width:900,height:700,channels:3,background:"white"}}).png().toBuffer();
    const result=await prepareStandaloneImage(input.toString("base64"));
    expect((await sharp(result.thumbnail).metadata()).width).toBe(600);
    expect((await sharp(result.original).metadata()).width).toBe(900);
    await expect(prepareStandaloneImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>').toString("base64"))).rejects.toThrow("JPG");
    await expect(prepareStandaloneImage(input.subarray(0,40).toString("base64"))).rejects.toThrow();
    await expect(prepareStandaloneImage("abcd/!" )).rejects.toThrow();
  });
  it("deduplicates only within uploader/workspace and does not re-run complete labels",async()=>{
    current.labelStatus="complete";
    const bytes=await sharp({create:{width:8,height:8,channels:3,background:"white"}}).png().toBuffer();
    expect(await uploadStandaloneImage(scope,{filename:"image.png",base64:bytes.toString("base64")})).toMatchObject({id:1,duplicate:true});
    expect(mocks.put).not.toHaveBeenCalled();expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(statements[0].sql).toContain("imageSetId IS NULL");expect(statements[0].params.slice(0,2)).toEqual([42,7]);
  });
  it("requires a standalone image and workspace even for administrators",async()=>{
    const q=dialect.sqlToQuery(standaloneImageAccess({...scope,role:"admin"},"all",true));
    expect(q.sql).toContain("imageSetId IS NULL AND workspaceId=?");expect(q.params[0]).toBe(42);expect(q.sql).toContain("visibility='team'");
    mocks.execute.mockResolvedValue([[]]);await expect(requireStandaloneImage(scope,99,true)).rejects.toThrow("无权");
  });
  it("queues one durable job and prevents duplicate active model calls",async()=>{
    await enqueueStandaloneTags(scope,1,0);expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({kind:STANDALONE_TAGGING_KIND,workspaceId:42,userId:7,skillSlug:"knowledge.images.tag"}));
    current.labelRunId="active";mocks.getJob.mockResolvedValue({runId:"active",status:"running"});
    expect(await enqueueStandaloneTags(scope,1,0)).toEqual({runId:"active"});expect(mocks.enqueue).toHaveBeenCalledTimes(1);
  });
  it("infers all four labels from this image and saves under a revision/scope guard",async()=>{
    current.labelRunId="job";
    await handler({input:{id:1,revision:0,configurationRevision:5,actorRole:"",feedback:""},userId:7,workspaceId:42,runId:"job"},{signal:new AbortController().signal});
    expect(mocks.run.mock.calls[0][0].context).toContain("根据这张图自身判断类目、风格、主色和提亮色");
    const write=statements.find(q=>q.sql.includes("aiDimensionAnalysis="))!;
    expect(write.sql).toContain("`tagCategory`");expect(write.sql).toContain("`tagAccentColor`");expect(write.sql).toContain("labelRevision=? AND labelRunId=? AND recycleId IS NULL AND imageSetId IS NULL AND workspaceId=?");
    expect(write.sql).not.toContain("UPDATE kb_image_sets");
  });
  it("never accepts incomplete AI labels or overwrites a newer human revision",async()=>{
    current.labelRunId="job";mocks.run.mockResolvedValue({content:JSON.stringify({items:[{imageId:1,...candidate,tagCategory:""}]})});
    const job={input:{id:1,revision:0,configurationRevision:5,actorRole:"",feedback:""},userId:7,workspaceId:42,runId:"job"};
    await expect(handler(job,{signal:new AbortController().signal})).rejects.toThrow();
    expect(statements.some(q=>q.sql.includes("labelStatus='failed'"))).toBe(true);
    current.labelRevision=1;mocks.run.mockClear();expect(await handler(job,{signal:new AbortController().signal})).toEqual({skipped:true});expect(mocks.run).not.toHaveBeenCalled();
  });
  it("edits only this image with validated parent-child labels and conflict checks",async()=>{
    current={...base,...candidate};
    await expect(saveStandaloneTags(scope,1,0,{tagImageTypeSub:"综合对比"})).rejects.toThrow("子标签");
    await saveStandaloneTags(scope,1,0,{tagCategory:"宠物",tagAccentColor:"蓝色"});
    expect(statements.at(-1)!.sql).toContain("labelRevision=? AND recycleId IS NULL AND imageSetId IS NULL AND workspaceId=?");
    expect(statements.at(-1)!.params).toContain("宠物");
  });
});
