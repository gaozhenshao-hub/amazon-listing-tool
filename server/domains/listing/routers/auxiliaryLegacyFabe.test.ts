import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../../../_core/context";
const mocks=vi.hoisted(()=>({skill:vi.fn(),project:vi.fn(),enriched:vi.fn(),analyses:vi.fn(),write:vi.fn()}));
vi.mock("../../../services/emperorSkillRunner",()=>({runEmperorSkill:mocks.skill}));
vi.mock("../routerContext",async original=>{
 const actual=await original<typeof import("../routerContext")>();
 const {initTRPC}=await import("@trpc/server");const t=initTRPC.context<TrpcContext>().create();
 return {...actual,protectedProcedure:t.procedure,router:t.router,resolveProjectAccess:mocks.project,ensureWriteAccess:mocks.write,
   loadEnrichedData:mocks.enriched,db:{...actual.db,getCompetitorAnalysesByProject:mocks.analyses}};
});
import { listingEditingProcedures } from "./editing";
import { router } from "../routerContext";
const caller=()=>router({expand:listingEditingProcedures.expandKeywordToFABE}).createCaller({user:{id:3,defaultWorkspaceId:7},workspaceId:7} as TrpcContext);
beforeEach(()=>{
 vi.clearAllMocks();mocks.project.mockResolvedValue({id:8,userId:3,workspaceId:7,productName:"Synthetic product"});
 mocks.analyses.mockResolvedValue([]);mocks.enriched.mockResolvedValue({});
 mocks.skill.mockResolvedValue({runId:"synthetic",modelSlug:"synthetic",content:JSON.stringify({theme:"Organization",themeZh:"整理",description:"Investigate this need",descriptionZh:"规划方向",fabeDirection:{feature:"unknown",advantage:"unknown",benefit:"unknown",evidence:"missing"},targetKeywords:[],addressesGap:"missing evidence"}),inputTokens:0,outputTokens:0});
});
describe("original keyword FABE route explicit user Skill mapping",()=>{
 it("actual gateway chooses original FABE slug despite translation/QA words in the original prompt",async()=>{
  const value=await caller().expand({projectId:8,keyword:"translate question 中文"});
  expect(value).toMatchObject({theme:"Organization",themeZh:"整理"});expect(mocks.skill).toHaveBeenCalledOnce();
  expect(mocks.skill.mock.calls[0][0]).toMatchObject({skillSlug:"listing.keyword.fabe.expand",userId:3,workspaceId:7,migrationSource:"explicit"});
  expect(mocks.skill.mock.calls[0][0].variables.originalSystemPrompt).toContain("FABE");
  expect(mocks.skill.mock.calls[0][0].executionPreset).toBeUndefined();
 });
 it("keeps original project/write access denial before any gateway call",async()=>{
  mocks.write.mockImplementation(()=>{throw new Error("SYNTHETIC_DENIED");});
  await expect(caller().expand({projectId:8,keyword:"organization"})).rejects.toThrow("SYNTHETIC_DENIED");expect(mocks.skill).not.toHaveBeenCalled();
 });
});
