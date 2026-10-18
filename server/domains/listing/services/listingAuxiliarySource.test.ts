import { describe, expect, it } from "vitest";
import { createListingAuxiliaryTestFixture } from "./listingAuxiliary.testFixture";
import { listingAuxiliaryBusinessContext, listingAuxiliaryOptimizationLineage } from "./listingAuxiliarySource";
import { listingAuxiliaryDraftHash, listingAuxiliaryTargets, ListingAuxiliaryPreviewInputSchema, ListingAuxiliaryQaItemSchema } from "../../../../shared/listingAuxiliaryWorkflow";
describe("auxiliary full private source and exact unsaved draft bindings",()=>{
 it.each(["keywordFabe","checkBullet","checkTitle","checkDescription","checkSearchTerms","checkQa"] as const)("%s can inspect missing facts without silently treating draft as evidence",async operation=>{
  const f=createListingAuxiliaryTestFixture(operation);f.state.sourceTables.projectFiles=[];const source=await f.capture();
  expect(source.attributeText).toBeNull();expect(source.confirmedFacts).toEqual([]);expect(listingAuxiliaryBusinessContext(source,0).constraints.submittedDraftIsNotProductEvidence).toBe(true);
 });
 it("actual raw file hash must match even when a fact row claims that hash",async()=>{
  const f=createListingAuxiliaryTestFixture();f.state.sourceTables.projectFiles[0].rawContent="DIFFERENT RAW";
  await expect(f.capture()).rejects.toMatchObject({code:"FACT_SOURCE_CHANGED"});
 });
 it("complete raw property changes are bound even when not included in safe provider context",async()=>{
  const f=createListingAuxiliaryTestFixture(),a=await f.capture();f.state.sourceTables.projects[0].description="ANOTHER FIELD";
  expect((await f.capture()).sourceHash).not.toBe(a.sourceHash);
 });
 it("explicit wrong workspace never hides inside a same-project historical row",async()=>{
  const f=createListingAuxiliaryTestFixture();f.state.sourceTables.listing_fact_revisions[0].workspaceId=8;
  await expect(f.capture()).rejects.toMatchObject({code:"ACCESS_DENIED"});
 });
 it("current file removes old confirmed fact evidence, never falls back to an earlier upload",async()=>{
  const f=createListingAuxiliaryTestFixture();f.state.sourceTables.projectFiles[0].status="pending";
  expect((await f.capture()).confirmedFacts).toEqual([]);
 });
 it("search terms bind all submitted title and bullet context without reading another unsaved step",()=>{
  const f=createListingAuxiliaryTestFixture("checkSearchTerms");if(f.request.operation!=="checkSearchTerms")throw new Error();
  const before=listingAuxiliaryDraftHash(f.request);f.request.payload.title+=" CHANGED";expect(listingAuxiliaryDraftHash(f.request)).not.toBe(before);
  const second=listingAuxiliaryDraftHash(f.request);f.request.payload.bulletPoints[0].fullText+=" CHANGED";expect(listingAuxiliaryDraftHash(f.request)).not.toBe(second);
 });
 it("optimization freezes all previous local bullets and cannot consume unconfirmed/template cores",async()=>{
  const f=createListingAuxiliaryTestFixture("optimizeBullet");if(f.request.operation!=="optimizeBullet")throw new Error();
  const before=listingAuxiliaryDraftHash(f.request);f.request.payload.previousBullets.push({subtitle:"local",fullText:"another unpublished draft"});expect(listingAuxiliaryDraftHash(f.request)).not.toBe(before);
  f.request.payload.coreInputHash="a".repeat(64);await expect(f.capture()).rejects.toMatchObject({code:"CONFIRMED_CORE_CHANGED"});
 });
 it("optimization depth is based on immutable lineage; third accepted optimization is final",async()=>{
  const f=createListingAuxiliaryTestFixture("optimizeBullet"),source=await f.capture();if(source.request.operation!=="optimizeBullet")throw new Error();
  const first=listingAuxiliaryOptimizationLineage(source);expect(first.depth).toBe(1);
  source.tables.listing_bullet_candidates.push({id:90,coreRevisionId:12,subtitle:"prior",fullText:"prior",gateResultJson:{provenance:{auxiliaryOptimization:{...first,depth:3}}}});
  source.request.payload.sourceCandidateId=90;expect(()=>listingAuxiliaryOptimizationLineage(source)).toThrow(/OPTIMIZATION_LIMIT/u);
 });
 it("same initial root cannot branch a fourth paid-applied optimization by omitting parent",async()=>{
  const f=createListingAuxiliaryTestFixture("optimizeBullet"),source=await f.capture(),first=listingAuxiliaryOptimizationLineage(source);
  for(let i=0;i<3;i++)source.tables.listing_bullet_candidates.push({id:90+i,coreRevisionId:12,subtitle:"prior",fullText:String(i),gateResultJson:{provenance:{auxiliaryOptimization:first}}});
  expect(()=>listingAuxiliaryOptimizationLineage(source)).toThrow(/OPTIMIZATION_LIMIT/u);
 });
 it("QA priority is preserved, item edits/reorder and all bullet targets change fingerprints",()=>{
  expect(ListingAuxiliaryQaItemSchema.parse({question:"Q",answer:"A",priority:2}).priority).toBe(2);
  expect(ListingAuxiliaryQaItemSchema.parse({question:"Q",answer:"A",priority:"high"}).priority).toBe("high");
  const f=createListingAuxiliaryTestFixture("checkBullet",9),targets=listingAuxiliaryTargets(f.request);expect(targets).toHaveLength(9);
  expect(new Set(targets.map(t=>t.targetHash)).size).toBe(9);
  if(f.request.operation!=="checkBullet")throw new Error();f.request.payload.items[0].bulletIndex=1;
  expect(ListingAuxiliaryPreviewInputSchema.safeParse(f.request).success).toBe(false);
 });
 it("does not truncate oversized request text or invent missing scope",()=>{
  const f=createListingAuxiliaryTestFixture("keywordFabe");
  expect(ListingAuxiliaryPreviewInputSchema.safeParse({...f.request,payload:{keyword:"x".repeat(201)}}).success).toBe(false);
  expect(ListingAuxiliaryPreviewInputSchema.safeParse({...f.request,expectedWorkspaceId:null}).success).toBe(false);
 });
});
