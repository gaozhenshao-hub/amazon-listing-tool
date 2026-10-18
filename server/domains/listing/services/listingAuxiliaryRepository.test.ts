import { describe, expect, it } from "vitest";
import { createListingAuxiliaryTestFixture, listingApplyId, listingOperationId } from "./listingAuxiliary.testFixture";
import { createListingAuxiliaryProcessor } from "./listingAuxiliaryWorker";
import { listingAuxiliaryOperationScope, listingAuxiliaryCandidate } from "./listingAuxiliaryRepository";
import { listingAuxiliaryHash as hash } from "../../../../shared/listingAuxiliaryWorkflow";
export const processFixture = (f: ReturnType<typeof createListingAuxiliaryTestFixture>) => createListingAuxiliaryProcessor({ repository:f.repository,runtime:f.runtime,loadConfiguration:async()=>f.configuration,enabled:()=>f.control.enabled,heartbeatMs:100000 });
const hint = (f: ReturnType<typeof createListingAuxiliaryTestFixture>) => ({ id:Number(f.state.jobs[0].id),...f.identity,projectId:8,operationId:listingOperationId });
async function finished(operation: Parameters<typeof createListingAuxiliaryTestFixture>[0] = "checkTitle", count = 1) {
 const f=createListingAuxiliaryTestFixture(operation,count), input=await f.submitted(); await processFixture(f)(hint(f));
 const {run}=await f.repository.check(f.identity,listingAuxiliaryOperationScope(input)); expect(run?.state).toBe("succeeded");
 return {f,input,run:run!,apply:{...listingAuxiliaryOperationScope(input),applyOperationId:listingApplyId,expectedSourceHash:run!.sourceHash,expectedResultHash:run!.resultHash!,expectedDraftHash:run!.source.draftHash,confirmHumanReview:true as const}};
}
describe("auxiliary private SQL workflow (synthetic protocol, not native acceptance)",()=>{
 it.each(["keywordFabe","optimizeBullet","checkBullet","checkTitle","checkDescription","checkSearchTerms","checkQa"] as const)("%s complete output and explicit application",async operation=>{
  const {f,run,apply}=await finished(operation);const before=structuredClone(f.state.sourceTables.listings);
  const receipt=await f.repository.apply(f.identity,apply);expect(receipt.status).toBe("committed");expect(receipt.requestHash).toBe(hash({identity:f.identity,request:apply}));
  expect(receipt.candidateIds).toHaveLength(operation==="optimizeBullet"?1:0);expect(receipt.reportArtifactId).toMatch(/^laux_/u);
  expect(f.state.sourceTables.listings).toEqual(before);expect(f.state.sourceTables.listing_core_revisions).toHaveLength(1);
  if(operation==="optimizeBullet")expect(f.state.sourceTables.listing_bullet_candidates[0]).toMatchObject({status:"review_required",coreRevisionId:12,parentCandidateId:null});
  expect(listingAuxiliaryCandidate(run)?.targets).toHaveLength(1);expect(f.providerInputs).toHaveLength(1);
 });
 it("all nine bullet targets have independent durable receipts and no target is silently omitted",async()=>{
  const {f,run}=await finished("checkBullet",9);expect(run.steps.map(step=>step.attempt.targetIndex)).toEqual([0,1,2,3,4,5,6,7,8]);
  expect(listingAuxiliaryCandidate(run)?.targets).toHaveLength(9);expect(f.providerInputs).toHaveLength(9);expect(run.runtimeSnapshot.maxCalls).toBe(9);
 });
 it("no uploaded profile is required to inspect draft or expand planning keyword",async()=>{
  for(const operation of ["keywordFabe","checkTitle"] as const){const f=createListingAuxiliaryTestFixture(operation);f.state.sourceTables.projectFiles=[];
   const source=await f.capture();expect(source.confirmedFacts).toEqual([]);expect(source.limitations).toContain("confirmed_product_facts_missing_objects_are_not_product_claims");await f.submitted();}
 });
 it("optimization still requires a currently confirmed fact/core source",async()=>{
  const f=createListingAuxiliaryTestFixture("optimizeBullet");f.state.sourceTables.listing_core_revisions[0].status="draft";await expect(f.submitted()).rejects.toMatchObject({code:"CONFIRMED_CORE_CHANGED"});expect(f.providerInputs).toHaveLength(0);
 });
 it("same UUID replays before changed configuration and rejects changed request",async()=>{
  const f=createListingAuxiliaryTestFixture(),input=await f.submitted();f.configuration.config.enabled=false;
  await f.repository.reserve(f.identity,input,async()=>{throw new Error("MUST_NOT_PREPARE");});expect(f.state.jobs).toHaveLength(1);
  await expect(f.repository.reserve(f.identity,{...input,maxCostCents:input.maxCostCents+1},f.prepare)).rejects.toMatchObject({code:"OPERATION_CONTENT_CONFLICT"});
 });
 it("known invalid optimization response permits original two repairs; unknown never advances",async()=>{
  const f=createListingAuxiliaryTestFixture("optimizeBullet");f.responses.splice(0,1,{subtitle:"bad",fullText:"bad"},{subtitle:"bad",fullText:"bad"},f.good.optimizeBullet);
  const input=await f.submitted();await processFixture(f)(hint(f));const {run}=await f.repository.check(f.identity,listingAuxiliaryOperationScope(input));
  expect(run?.state).toBe("succeeded");expect(run?.steps.map(step=>step.attempt.qualityAttempt)).toEqual([0,1,2]);expect(f.providerInputs).toHaveLength(3);
 });
 it("paid unknown blocks next target and any automatic retry",async()=>{
  const f=createListingAuxiliaryTestFixture("checkBullet",3);f.control.providerThrows=true;const input=await f.submitted();await processFixture(f)(hint(f));
  expect((await f.repository.check(f.identity,listingAuxiliaryOperationScope(input))).run?.state).toBe("outcome_unknown");f.control.now+=121;await processFixture(f)(hint(f));expect(f.providerInputs).toHaveLength(1);
 });
 it("unknown second target retains first complete paid report but never dispatches third",async()=>{
  const f=createListingAuxiliaryTestFixture("checkBullet",3);f.control.afterDispatch=async()=>{if(f.providerInputs.length===2)f.control.providerThrows=true;};
  const input=await f.submitted();await processFixture(f)(hint(f));const {run}=await f.repository.check(f.identity,listingAuxiliaryOperationScope(input));
  expect(run?.state).toBe("outcome_unknown");expect(run?.steps).toHaveLength(2);expect(run?.steps[0].returned?.candidate?.checkListScores).toEqual(f.good.checkBullet.checkListScores);
  expect(run?.steps[1].returned).toBeNull();expect(listingAuxiliaryCandidate(run!)).toBeNull();await processFixture(f)(hint(f));expect(f.providerInputs).toHaveLength(2);
 });
 it("persists three optimization revisions and blocks a fourth without replacing prior candidates",async()=>{
  const f=createListingAuxiliaryTestFixture("optimizeBullet");if(f.request.operation!=="optimizeBullet")throw new Error();
  for(let depth=1;depth<=3;depth++){
   f.request.operationId=`0000000${depth}-1111-4111-8111-111111111111`;
   f.good.optimizeBullet.fullText += " daily";
   const input=await f.submitted();await processFixture(f)({...hint(f),operationId:f.request.operationId});const {run}=await f.repository.check(f.identity,listingAuxiliaryOperationScope(input));expect(run?.state).toBe("succeeded");
   const receipt=await f.repository.apply(f.identity,{...listingAuxiliaryOperationScope(input),applyOperationId:`1000000${depth}-1111-4111-8111-111111111111`,expectedSourceHash:run!.sourceHash,expectedResultHash:run!.resultHash!,expectedDraftHash:run!.source.draftHash,confirmHumanReview:true});
   const saved=f.state.sourceTables.listing_bullet_candidates.find(row=>row.id===receipt.candidateIds[0])!;
   expect(saved.status).toBe("review_required");expect(saved.gateResultJson).toMatchObject({provenance:{auxiliaryOptimization:{depth}}});
   f.request.payload.sourceCandidateId=receipt.candidateIds[0];f.request.payload.currentBullet={subtitle:String(saved.subtitle),fullText:String(saved.fullText)};
  }
  f.request.operationId="00000004-1111-4111-8111-111111111111";
  await expect(f.submitted()).rejects.toMatchObject({code:"OPTIMIZATION_LIMIT"});expect(f.providerInputs).toHaveLength(3);expect(f.state.sourceTables.listing_bullet_candidates).toHaveLength(3);
 });
 it.each(["dispatch_ack","paid_ack","flagoff"])("%s retains exact UUID and never pays twice",async mode=>{
  const f=createListingAuxiliaryTestFixture(),input=await f.submitted();
  if(mode==="dispatch_ack")f.control.ackLostOn="UPDATE ai_jobs SET output";
  else f.control.afterPaid=async()=>{if(mode==="paid_ack")f.control.ackLostOn="UPDATE ai_jobs SET output";else f.control.enabled=false;};
  await processFixture(f)(hint(f));f.control.now+=121;await processFixture(f)(hint(f));const {run}=await f.repository.check(f.identity,listingAuxiliaryOperationScope(input));
  expect(run?.state).toBe(mode==="dispatch_ack"?"outcome_unknown":"succeeded");expect(f.providerInputs).toHaveLength(mode==="dispatch_ack"?0:1);
 });
 it("fresh permission and source changes never dispatch",async()=>{
  for(const mode of ["permission","source"]){const f=createListingAuxiliaryTestFixture();await f.submitted();if(mode==="permission")f.control.deny=true;else f.state.sourceTables.projects[0].name="CHANGED";
   await processFixture(f)(hint(f)).catch(()=>undefined);expect(f.providerInputs).toHaveLength(0);}
 });
 it("cancel-before-start and application tombstones recover with flag off",async()=>{
  const f=createListingAuxiliaryTestFixture(),input=await f.submitted(),scope=listingAuxiliaryOperationScope(input),op={...scope,operationId:listingApplyId};f.control.enabled=false;
  await f.repository.cancel(f.identity,op);f.control.enabled=true;await f.repository.reserve(f.identity,{...input,operationId:listingApplyId},f.prepare);expect(f.state.jobs).toHaveLength(1);
  const g=await finished();const applyScope={...listingAuxiliaryOperationScope(g.input),applyOperationId:listingApplyId};await g.f.repository.applyCancel(g.f.identity,applyScope);g.f.control.enabled=false;
  expect((await g.f.repository.apply(g.f.identity,g.apply)).status).toBe("cancelled");
 });
 it("apply audit failure rolls candidate/immutable report back and lost ACK recovers final",async()=>{
  const a=await finished("optimizeBullet");a.f.control.failWrite="INSERT INTO security_audit_logs";await expect(a.f.repository.apply(a.f.identity,a.apply)).rejects.toBeDefined();expect(a.f.state.sourceTables.listing_bullet_candidates).toEqual([]);
  const b=await finished();b.f.control.ackLostOn="INSERT INTO security_audit_logs";await expect(b.f.repository.apply(b.f.identity,b.apply)).rejects.toBeDefined();b.f.control.enabled=false;
  expect((await b.f.repository.applyCheck(b.f.identity,{...listingAuxiliaryOperationScope(b.input),applyOperationId:listingApplyId}))?.status).toBe("committed");
 });
 it("current source/draft drift and wrong target fingerprints cannot apply",async()=>{
  const a=await finished();await expect(a.f.repository.apply(a.f.identity,{...a.apply,expectedDraftHash:"a".repeat(64)})).rejects.toMatchObject({code:"DRAFT_CHANGED"});
  a.f.state.sourceTables.listings[0].title="HUMAN";await expect(a.f.repository.apply(a.f.identity,a.apply)).rejects.toMatchObject({code:"SOURCE_CHANGED"});
 });
 it("private canonical scalar storage and owner history never expose another target",async()=>{
  const {f,input}=await finished();expect(typeof f.state.jobs[0].input).toBe("string");expect(f.state.artifacts.every(row=>typeof row.contentJson==="string")).toBe(true);
  expect(await f.repository.history(f.identity,{...f.scope,beforeId:null,limit:10})).toMatchObject({items:[{operationId:input.operationId,operation:"checkTitle"}],nextBeforeId:null});
  await expect(f.repository.check({...f.identity,workspaceId:9},listingAuxiliaryOperationScope(input))).rejects.toMatchObject({code:"ACCESS_DENIED"});
 });
});
