import {beforeEach,expect,it,vi} from 'vitest';
import type {TrpcContext} from './_core/context';
const f=vi.hoisted(()=>({project:vi.fn(),record:vi.fn(),extra:vi.fn(),hydrate:vi.fn(),aggregate:vi.fn()}));
vi.mock('./repositories',async original=>({...await original<typeof import('./repositories')>(),getProjectById:f.project,getPersistedCompetitorAnalysisById:f.record}));
vi.mock('./domains/listing/competitorPresentation',async original=>({...await original<typeof import('./domains/listing/competitorPresentation')>(),hydrateCompetitorEvidence:f.hydrate}));
vi.mock('./domains/listing/supplementalReviews',async original=>({...await original<typeof import('./domains/listing/supplementalReviews')>(),loadSupplementalReviews:f.extra}));
vi.mock('./domains/listing/aggregationStore',async original=>({...await original<typeof import('./domains/listing/aggregationStore')>(),readListingAggregation:f.aggregate}));
vi.mock('./services/securityGovernance',async original=>({...await original<typeof import('./services/securityGovernance')>(),assertResourceAction:vi.fn().mockResolvedValue(undefined)}));
import {analysisRouter} from './routers/analysis';
import {reviewKey} from './domains/listing/supplementalReviews';
const review={title:'Good',body:'Strong and airy',rating:5,date:null},hash=reviewKey(review),timestamp='2026-10-29T00:00:00Z';
const ctx={user:{id:7,role:'ops_specialist'},workspaceId:3,req:{},res:{},requestId:'evidence'} as TrpcContext;
const record={id:12,projectId:11,asin:'B012345678',rawData:JSON.stringify({research:{reviews:[review]},comparisonAnalysis:{reviewVersion:2,generatedAt:timestamp,reviews:[{sentiment:'positive',reviewIds:[hash]}],reviewTranslations:{[hash]:'结实又透气'}}})};
beforeEach(()=>{vi.clearAllMocks();f.project.mockResolvedValue({id:11,userId:7,workspaceId:3});f.record.mockResolvedValue(record);f.hydrate.mockImplementation(async r=>r);f.extra.mockResolvedValue([]);});
it('returns original evidence and its translation only from the authorized project',async()=>{
 const result=await analysisRouter.createCaller(ctx).reviewEvidence({projectId:11,analysisId:12,groupIndex:0,generatedAt:timestamp});
 expect(result.items).toEqual([expect.objectContaining({body:'Strong and airy',translation:'结实又透气',rating:5})]);expect(result.total).toBe(1);
 f.project.mockResolvedValue({id:11,userId:8,workspaceId:3});await expect(analysisRouter.createCaller(ctx).reviewEvidence({projectId:11,analysisId:12,groupIndex:0,generatedAt:timestamp})).rejects.toMatchObject({code:'NOT_FOUND'});
});
it('rejects stale analysis and never presents absent source text as evidence',async()=>{
 await expect(analysisRouter.createCaller(ctx).reviewEvidence({projectId:11,analysisId:12,groupIndex:0,generatedAt:'old'})).rejects.toMatchObject({code:'CONFLICT'});
 f.hydrate.mockResolvedValue({...record,rawData:JSON.stringify({research:{reviews:[]},comparisonAnalysis:{reviewVersion:2,generatedAt:timestamp,reviews:[{reviewIds:[hash]}]}})});
 const result=await analysisRouter.createCaller(ctx).reviewEvidence({projectId:11,analysisId:12,groupIndex:0,generatedAt:timestamp});expect(result).toMatchObject({total:1,available:0,items:[]});
});
it('deduplicates a review referenced by multiple aggregated themes and checks its source version',async()=>{
 const id='12c6d10c-21c6-4eb7-a31b-9dcba7fd1612';
 const raw=JSON.parse(record.rawData);raw.comparisonAnalysis.reviews.push({sentiment:'positive',reviewIds:[hash]});
 f.record.mockResolvedValue({...record,rawData:JSON.stringify(raw)});
 f.aggregate.mockResolvedValue({data:{reviews:[{id,sentiment:'positive',evidence:[{analysisId:12,groupIndex:0,generatedAt:timestamp},{analysisId:12,groupIndex:1,generatedAt:timestamp}]}]}});
 const result=await analysisRouter.createCaller(ctx).aggregationReviewEvidence({projectId:11,itemId:id});expect(result).toMatchObject({total:1,available:1,stale:false});
 raw.comparisonAnalysis.generatedAt='changed';f.record.mockResolvedValue({...record,rawData:JSON.stringify(raw)});
 const stale=await analysisRouter.createCaller(ctx).aggregationReviewEvidence({projectId:11,itemId:id});expect(stale).toMatchObject({stale:true,items:[]});
});
