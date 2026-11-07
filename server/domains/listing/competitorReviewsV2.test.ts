import { expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({wrongMerge:false}));
vi.mock('../ai_os/services/skillRunner',()=>({safeParseSkillJSON:JSON.parse,runEmperorSkill:async (input:any)=>{
 const c=JSON.parse(input.context);
 const result=c.mode==='reviews'?{groups:[{name:c.reviews[0].body.includes('other')?'质量好':'做工好',reason:'评价',reviewIds:c.reviews.map((r:any)=>r.id)}],translations:c.reviews.map((r:any)=>({id:r.id,translation:`中文 ${r.title}`}))}
   :{groups:[{name:'质量与做工',reason:'归纳',sourceIds:state.wrongMerge?['invalid']:c.groups.map((g:any)=>g.id)}]};
 return {parsed:input.validate(JSON.stringify(result))};
}}));
import { analyzeCompetitorReviews, ratedReviewSentiment } from './competitorReviewsV2';
it('merges across batches and counts each original review once after merging',async()=>{
 state.wrongMerge=false;
 const reviews=Array.from({length:31},(_,i)=>({title:String(i),body:i===30?'other quality':'quality',rating:5}));
 const result=await analyzeCompetitorReviews({userId:1,workspaceId:1,asin:'B012345678',reviews,imported:[]});
 expect(result.reviews).toHaveLength(1);expect(result.reviews[0]).toMatchObject({name:'质量与做工',count:31,percentage:100});
 expect(result.reviews[0].reviewIds).toHaveLength(31);expect(result.reviews[0].reviewIds.every(id=>/^[a-f0-9]{64}$/.test(id))).toBe(true);expect(Object.keys(result.reviewTranslations)).toHaveLength(31);
});
it('rejects missing or fabricated groups during consolidation',async()=>{
 state.wrongMerge=true;await expect(analyzeCompetitorReviews({userId:1,workspaceId:1,asin:'B012345678',reviews:[{body:'good',rating:4}],imported:[]})).rejects.toThrow('评论主题归纳引用不完整');
});
it('classifies 3 stars as negative and does not invent a rating',()=>{
 expect(ratedReviewSentiment(3)).toBe('negative');expect(ratedReviewSentiment(4)).toBe('positive');expect(ratedReviewSentiment(null)).toBeNull();
});
