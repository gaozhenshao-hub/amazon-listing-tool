import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { IMAGE_TAGGING_OPTIONS } from "../../../shared/imageTagging";
const mocks = vi.hoisted(() => ({ execute: vi.fn(), config: vi.fn(), snapshot: vi.fn(), run: vi.fn(), getJob: vi.fn(), startJob: vi.fn(), progress: vi.fn() }));
vi.mock("../../repositories/dbClient", () => ({ requireDb: async () => ({ execute: mocks.execute }) }));
vi.mock("../../storage", () => ({ parseStorageUri: () => ({provider:"local",key:"safe.png"}) }));
vi.mock("../../infrastructure/localObjectStorage", () => ({ verifiedLocalObjectPath: async () => "safe.png" }));
vi.mock("node:fs/promises", () => ({ readFile: async () => Buffer.from("synthetic") }));
vi.mock("sharp", () => ({ default: () => { const chain = {rotate:()=>chain,resize:()=>chain,jpeg:()=>chain,composite:()=>chain,toBuffer:async()=>Buffer.from("synthetic")}; return chain; } }));
vi.mock("../ai_os/services/assistantConfigurations", () => ({ assistantConfigurationService:{get:mocks.config}, skillManifestHash:()=>"hash" }));
vi.mock("../../services/emperorSkillRunner", () => ({ getEmperorSkillRuntimeSnapshot:mocks.snapshot,runEmperorSkill:mocks.run }));
vi.mock("../../services/aiJobRunner", () => ({ getAiJobRun:mocks.getJob,startRegisteredAiJob:mocks.startJob,updateAiJobProgress:mocks.progress,registerAiJobHandler:vi.fn() }));
import { enqueueAutomaticTags, runAutomaticTags, needsAutomaticTags, missingTagPatch } from "./automaticTagging";
const scope={workspaceId:1,userId:2,imageSetId:51};
const base={setStyle:IMAGE_TAGGING_OPTIONS.styles[0],setCategory:IMAGE_TAGGING_OPTIONS.categories[0],setPrimaryColor:"白色",setAccentColor:"",id:701,imageSetId:51,asin:"B012345678",productTitle:"Test",imagePosition:"main" as const,imageUrl:"storage://local/safe.png",tagsConfirmed:0,analysisConfirmed:0};
const candidate={tagCategory:IMAGE_TAGGING_OPTIONS.categories[0],tagImageTypeMain:Object.keys(IMAGE_TAGGING_OPTIONS.imageTypes)[0],tagImageTypeSub:"",tagSellingPointCategory:"",tagSellingPointDetail:"",
  tagComposition:IMAGE_TAGGING_OPTIONS.compositions[0],tagColorSchemeV2:IMAGE_TAGGING_OPTIONS.colors[0],tagDesignStyleV2:IMAGE_TAGGING_OPTIONS.styles[0],accentColor:"",evidence:"图中可见产品"};
let images: any[], statements: Array<{sql:string;params:unknown[]}>;
beforeEach(()=>{
  vi.clearAllMocks(); images=[{...base}];statements=[];
  mocks.execute.mockImplementation(async query=>{const q=new MySqlDialect().sqlToQuery(query); statements.push(q);
    if(q.sql.includes("SELECT manifest"))return [[{manifest:{}}]];
    if(q.sql.includes("SELECT runId"))return [[]];
    if(q.sql.startsWith("SELECT"))return [images.map(i=>({...i}))];
    return [{affectedRows:1}];});
  mocks.config.mockResolvedValue({status:"configured",record:{revision:2,config:{enabled:true,modelSlug:"vision-test",instructions:"规则",rules:[],skills:[{slug:"knowledge.images.tag",enabled:true,version:3,manifestSha256:"hash"}]}}});
  mocks.snapshot.mockResolvedValue({version:"3",manifestHash:"runtime-hash"});
  mocks.getJob.mockResolvedValue(null);mocks.startJob.mockImplementation(async input=>({...input,status:"queued"}));
  mocks.run.mockResolvedValue({runId:"skill-1",content:JSON.stringify({items:[{imageId:701,...candidate}]})});
});
describe("automatic acquisition tags",()=>{
  it("analyses a whole four-image module once and writes only to its first source image",async()=>{
    const hashes=[1,2,3,4].map(n=>String(n).repeat(64));
    const sourceLayout={version:1,modules:[{id:'four',section:'aplus',kind:'grid',subtype:'四图文',cards:hashes.map(hash=>({images:[{hash,alt:''}],title:'',text:''}))}]};
    images=hashes.map((sourceUrlHash,i)=>({...base,id:701+i,imagePosition:'aplus',imageUrl:`storage://local/${i}.png`,sourceUrlHash,sourceLayout}));
    await runAutomaticTags(scope,{runId:'job',configurationRevision:2,signal:new AbortController().signal});
    expect(mocks.run).toHaveBeenCalledTimes(1);expect(mocks.run.mock.calls[0][0].attachments).toHaveLength(2);
    expect(mocks.run.mock.calls[0][0].attachments[0].text).toContain('由 4 张图片组合');
    const updates=statements.filter(q=>q.sql.startsWith('UPDATE'));expect(updates).toHaveLength(1);expect(updates[0].params).toContain(701);expect(updates[0].params).not.toContain(702);
  });
  it("enqueues durably once and does not enqueue brand-story or confirmed images",async()=>{
    const job=await enqueueAutomaticTags(scope); expect(mocks.startJob).toHaveBeenCalledWith(expect.objectContaining({kind:"knowledge.images.autotag",workspaceId:1,userId:2,maxAttempts:1}));
    mocks.getJob.mockResolvedValue(job);expect(await enqueueAutomaticTags(scope)).toEqual(job);expect(mocks.startJob).toHaveBeenCalledTimes(1);
    images=[{...base,imagePosition:"brand_story"},{...base,id:702,tagsConfirmed:1}];expect(await enqueueAutomaticTags(scope)).toBeNull();
  });
  it("rejects missing configuration without calling a model",async()=>{
    mocks.config.mockResolvedValue({status:"unconfigured"});await expect(enqueueAutomaticTags(scope)).rejects.toThrow("小酷");expect(mocks.run).not.toHaveBeenCalled();
  });
  it("fills missing labels while preserving module subtype and human labels with a database comparison guard",async()=>{
    images=[{...base,tagCategory:"existing",tagImageBelongSub:"图片轮播"},{...base,id:702,imagePosition:"brand_story"}];
    await runAutomaticTags(scope,{runId:"job-1",configurationRevision:2,signal:new AbortController().signal});
    expect(mocks.run).toHaveBeenCalledTimes(1);expect(mocks.run.mock.calls[0][0].attachments).toHaveLength(2);
    const update=statements.find(q=>q.sql.startsWith("UPDATE"))!;expect(update.sql).toContain("i.tagsConfirmed=0");expect(update.sql).toContain("<=>");
    expect(update.sql.split("WHERE")[0]).not.toContain("tagCategory");expect(update.sql).not.toContain("tagImageBelongSub");
    expect(missingTagPatch({tagCategory:"existing"},candidate)).not.toHaveProperty("tagCategory");
  });
  it("retries malformed answers singly once but never retries a failed provider call automatically",async()=>{
    mocks.run.mockResolvedValueOnce({content:'{"items":[]}'});await runAutomaticTags(scope,{runId:"job",configurationRevision:2,signal:new AbortController().signal});expect(mocks.run).toHaveBeenCalledTimes(2);
    mocks.run.mockClear();mocks.run.mockRejectedValueOnce(new Error("unknown outcome"));await expect(runAutomaticTags(scope,{runId:"job",configurationRevision:2,signal:new AbortController().signal})).rejects.toThrow("unknown outcome");expect(mocks.run).toHaveBeenCalledTimes(1);
  });
  it("does not write results after cancellation or send replaced/removed images",async()=>{
    const control=new AbortController();mocks.run.mockImplementationOnce(async()=>{control.abort();return {content:JSON.stringify({items:[{imageId:701,...candidate}]})};});
    await expect(runAutomaticTags(scope,{runId:"job",configurationRevision:2,signal:control.signal})).rejects.toBeDefined();expect(statements.some(q=>q.sql.startsWith("UPDATE"))).toBe(false);
    expect(needsAutomaticTags({...base,...candidate})).toBe(false);
  });
});
