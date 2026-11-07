import { z } from "zod";
import { safeParseSkillJSON } from "../ai_os/services/skillRunner";
import { runCompetitorSkill } from './runCompetitorSkill';
import { translateRichContent } from '../knowledge/richContentTranslation';
import { analyzeCompetitorReviews } from "./competitorReviewsV2";
import { unifyModuleSellingPoints } from "./moduleSellingPoints";

const text = z.string().max(5000);
const categories=z.array(z.enum(['质量','设计','售后','功能','场景','其他'])).max(12).optional();
const listingResult = z.object({titleTranslation:text, bullets:z.array(z.object({index:z.number().int().nonnegative(),translation:text,sellingPoints:z.array(text).max(12),sellingPointCategories:categories})).max(20)});
const SKILL = "listing.competitor.content.v2";

export async function analyzeCompetitorStudyV2(input: { userId:number;workspaceId:number;data:any;assets:any[];imported:any[];signal?:AbortSignal;previous?:unknown;onProgress?:(n:number)=>Promise<unknown> }) {
  const run = async <T>(context:unknown, schema:z.ZodType<T>, attachments?:any[]):Promise<T> => {
    input.signal?.throwIfAborted(); const value=JSON.stringify(context);
    const result=await runCompetitorSkill<T>({skillSlug:SKILL,userId:input.userId,workspaceId:input.workspaceId,context:value,
      variables:{context:value},attachments,signal:input.signal,validate:content=>schema.parse(safeParseSkillJSON(content))});
    return result.parsed;
  };
  const bullets:string[]=input.data.bulletPoints||[];
  const listing=await run({mode:"listing",asin:input.data.asin,title:input.data.title,bullets},listingResult);
  if(listing.bullets.length!==bullets.length || new Set(listing.bullets.map(b=>b.index)).size!==bullets.length || listing.bullets.some(b=>b.index>=bullets.length)) throw new Error("五点翻译不完整，请重试");
  const rich=await translateRichContent({userId:input.userId,workspaceId:input.workspaceId,layout:input.data.sourceLayout,assets:input.assets,previous:input.previous,signal:input.signal,onProgress:async(done,total)=>input.onProgress?.(35+Math.round(done/Math.max(1,total)*25))});
  const images=rich.findings;
  rich.presentation.modulePoints=await unifyModuleSellingPoints({userId:input.userId,workspaceId:input.workspaceId,layout:input.data.sourceLayout,presentation:rich.presentation,findings:images,signal:input.signal,onProgress:async(done,total)=>input.onProgress?.(60+Math.round(done/Math.max(1,total)*5))});
  const reviewAnalysis=await analyzeCompetitorReviews({userId:input.userId,workspaceId:input.workspaceId,asin:input.data.asin,reviews:input.data.research?.reviews||[],imported:input.imported,signal:input.signal,onProgress:input.onProgress});
  return {version:2 as const,reviewVersion:2 as const,generatedAt:new Date().toISOString(),listing,images,richContent:rich.presentation,...reviewAnalysis};
}
