import { z } from "zod";
import { safeParseSkillJSON } from "../ai_os/services/skillRunner";
import { runCompetitorSkill } from "./runCompetitorSkill";
import { mergeImportedReviews, reviewKey } from "./supplementalReviews";
import { REVIEW_SKILL } from "./listingSkillPrompts";

const text=z.string().trim().max(5000);
const batchSchema=z.object({groups:z.array(z.object({name:text.min(1),reason:text,reviewIds:z.array(z.string()).min(1).max(40),
      })).max(60),translations:z.array(z.object({id:z.string(),translation:text})).max(40),
});
const translationSchema=z.object({translations:z.array(z.object({id:z.string(),translation:text.min(1)})).max(40),
});
const mergeSchema=z.object({groups:z.array(z.object({name:text.min(1),reason:text,sourceIds:z.array(z.string()).min(1).max(200),
      })).max(200),
});
type Sentiment= "positive" | "negative";

export function ratedReviewSentiment(rating:unknown):Sentiment|null {
 const value=typeof rating=== "number" ?rating:Number.NaN;
 return Number.isInteger(value)&&value>=1&&value<=5? value>=4? "positive"
      : "negative"
    :null;
}

export async function analyzeCompetitorReviews(input:{userId:number;workspaceId:number;asin:string;reviews:any[];imported:any[];signal?:AbortSignal;onProgress?:(n:number)=>Promise<unknown>;
}) {
 const all=mergeImportedReviews(input.reviews,input.imported).filter(r=>String(r.body||r.content||r.title|| "").trim());
 const reviews=all.map(r=>({id:reviewKey(r),title:String(r.title|| ""),body:String(r.body||r.content|| ""),rating:r.rating??null,sentiment:ratedReviewSentiment(r.rating),
    })).filter(r=>r.sentiment!==null);
 const translations:Record<string,string>={};
 const findings:Array<{id:string;name:string;reason:string;sentiment:Sentiment;reviewIds:string[];
  }>=[];
 let done=0;
 async function run<T>(context:unknown,schema:z.ZodType<T>):Promise<T>{
  input.signal?.throwIfAborted();const value=JSON.stringify(context);
  return (await runCompetitorSkill<T>({skillSlug: REVIEW_SKILL,userId:input.userId,workspaceId:input.workspaceId,context:value,variables:{context:value},signal:input.signal,validate:content=>schema.parse(safeParseSkillJSON(content)),
      })).parsed;
 }
 for(const sentiment of ["positive", "negative"] as const){
  const items=reviews.filter(r=>r.sentiment===sentiment);
  for(let offset=0;offset<items.length;offset+=30){
   const batch=items.slice(offset,offset+30).map((review,index)=>({...review,stableId:review.id,id:`R${index+1}`,
        })),allowed=new Set(batch.map(r=>r.id));
   const stable=new Map(batch.map(r=>[r.id,r.stableId]));
   const publicBatch=batch.map(({stableId,...r})=>r);
   const result=await run({mode: "reviews",asin:input.asin,sentiment,reviews:publicBatch},batchSchema);
   if(result.groups.some(g=>g.reviewIds.some(id=>!allowed.has(id))) || result.translations.some(t=>!allowed.has(t.id)) || new Set(result.translations.map(t=>t.id)).size!==result.translations.length) throw new Error("评论分析引用不属于当前样本的评论");
   for(const t of result.translations)if(t.translation)translations[stable.get(t.id)!]=t.translation;
   const missing=publicBatch.filter(r=>!translations[stable.get(r.id)!]);
   if(missing.length){
    const translated=await run({mode: "translate",asin:input.asin,reviews:missing},translationSchema),expected=new Set(missing.map(r=>r.id));
    if(translated.translations.length!==expected.size||new Set(translated.translations.map(t=>t.id)).size!==expected.size||translated.translations.some(t=>!expected.has(t.id)))throw new Error("评论翻译不完整，请重试");
    for(const t of translated.translations)translations[stable.get(t.id)!]=t.translation;
   }
   for(const g of result.groups)findings.push({id:`G${findings.length+1}`,name:g.name,reason:g.reason,sentiment,reviewIds:[...new Set(g.reviewIds.map(id=>stable.get(id)!))],
        });
   done+=batch.length;await input.onProgress?.(60+Math.round((done/Math.max(1,reviews.length))*20));
  }
 }
 const resultGroups:Array<{name:string;reason:string;sentiment:Sentiment;reviewIds:string[];
  }>=[];
 for(const sentiment of ["positive", "negative"] as const){
  const groups=findings.filter(g=>g.sentiment===sentiment);
  if(!groups.length)continue;
  // A second pass reconciles synonyms across every batch; groups are an exact partition of the input groups.
  const result=await run({mode: "merge",asin:input.asin,sentiment,groups:groups.map(({id,name,reason})=>({id,name,reason})),
      },mergeSchema);
  const sources=new Map(groups.map(g=>[g.id,g]));const used=result.groups.flatMap(g=>g.sourceIds);
  if(used.length!==groups.length || new Set(used).size!==groups.length || used.some(id=>!sources.has(id)))throw new Error("评论主题归纳引用不完整，请重试");
  for(const group of result.groups){const ids=new Set(group.sourceIds.flatMap(id=>sources.get(id)!.reviewIds));resultGroups.push({name:group.name,reason:group.reason,sentiment,reviewIds:[...ids],
      });}
 }
 return {reviewSampleCount:reviews.length,reviewUnratedCount:all.length-reviews.length,
  reviewSentimentCounts:{positive:reviews.filter(r=>r.sentiment=== "positive").length,negative:reviews.filter(r=>r.sentiment=== "negative").length,
    },reviewTranslations:translations,
  reviews:resultGroups.map(group=>({...group,count:group.reviewIds.length,percentage:reviews.length?Math.round((group.reviewIds.length/reviews.length) *1000)/10:0,
    })),
  };
}

/** Refine existing conclusions; only inspect the saved quality evidence when splitting a hidden zipper issue. */
export async function refineExistingReviewGroups(input: {
  userId: number;
  workspaceId: number;
  asin: string;
  study: any;
  reviews: any[];
  imported: any[];
  signal?: AbortSignal;
}) {
  const groups = input.study.reviews.map((g: any) => ({
    ...g,
    reviewIds: [...new Set<string>(g.reviewIds || [])],
  }));
  const run = async <T>(context: unknown, validate: (content: string) => T) => {
    const value = JSON.stringify(context);
    return (
      await runCompetitorSkill({
        skillSlug: REVIEW_SKILL,
        userId: input.userId,
        workspaceId: input.workspaceId,
        signal: input.signal,
        context: value,
        variables: { context: value },
        validate,
      })
    ).parsed;
  };
  if (
    !groups.some(
      (g: any) => g.sentiment === "negative" && /拉链|zipper/i.test(g.name)
    )
  ) {
    const quality = groups.filter(
      (g: any) =>
        g.sentiment === "negative" &&
        /质量|做工/.test(g.name) &&
        /拉链|zipper/i.test(g.reason)
    );
    const allowed = new Set<string>(quality.flatMap((g: any) => g.reviewIds));
    const source = mergeImportedReviews(input.reviews, input.imported)
      .map(r => ({
        id: reviewKey(r),
        title: r.title || "",
        body: r.body || r.content || "",
      }))
      .filter(r => allowed.has(r.id));
    const classifications = new Map<
      string,
      { zipperProblem: boolean; otherQualityProblem: boolean; reason: string }
    >();
    for (let offset = 0; offset < source.length; offset += 30) {
      const batch = source.slice(offset, offset + 30),
        ids = new Set(batch.map(r => r.id));
      const schema = z.object({
        items: z
          .array(
            z.object({
              id: z.string(),
              zipperProblem: z.boolean(),
              otherQualityProblem: z.boolean(),
              reason: z.string().max(2000),
            })
          )
          .max(30),
      });
      const result = await run(
        { mode: "zipperEvidence", asin: input.asin, reviews: batch },
        content => {
          const result = schema.parse(safeParseSkillJSON(content));
          if (
            result.items.length !== ids.size ||
            new Set(result.items.map(r => r.id)).size !== ids.size ||
            result.items.some(r => !ids.has(r.id))
          )
            throw new Error("拉链问题核对引用不完整");
          return result;
        }
      );
      result.items.forEach(r => classifications.set(r.id, r));
    }
    const zipperIds = [...classifications]
      .filter(([, r]) => r.zipperProblem)
      .map(([id]) => id);
    if (zipperIds.length) {
      for (const group of quality)
        group.reviewIds = group.reviewIds.filter((id: string) => {
          const value = classifications.get(id);
          return !value?.zipperProblem || value.otherQualityProblem;
        });
      groups.push({
        name: "拉链易坏、卡顿脱轨",
        reason:
          "拉链故障已单独归类：" +
          zipperIds
            .slice(0, 12)
            .map(id => classifications.get(id)!.reason)
            .join("；"),
        sentiment: "negative",
        reviewIds: zipperIds,
      });
    }
  }
  const titleSchema = z.object({
    groups: z
      .array(
        z.object({
          index: z.number().int().nonnegative(),
          name: z.string().trim().min(1).max(100),
          reason: z.string().trim().min(1).max(5000),
        })
      )
      .max(200),
  });
  const named = await run(
    {
      mode: "refineTitles",
      asin: input.asin,
      instruction:
        "拉链若已单列，其他质量主题聚焦其余做工问题。已有星级组内若出现矛盾反馈，必须如实表达，不为正向标题编造好处。保留原结论依据。",
      groups: groups.map((g: any, index: number) => ({
        index,
        name: g.name,
        reason: g.reason,
        sentiment: g.sentiment,
        count: g.reviewIds.length,
      })),
    },
    content => {
      const result = titleSchema.parse(safeParseSkillJSON(content)),
        ids = result.groups.map(g => g.index);
      if (
        ids.length !== groups.length ||
        new Set(ids).size !== groups.length ||
        ids.some(id => id >= groups.length)
      )
        throw new Error("评论标题整理遗漏主题");
      if (
        result.groups.some(g =>
          [
            "安全防蜇",
            "质量与做工",
            "通风透气与舒适",
            "尺码与版型",
            "售后服务",
          ].includes(g.name)
        )
      )
        throw new Error("评论标题仍然过于中性，请表达具体表现和评价方向");
      return result;
    }
  );
  return groups.map((g: any, index: number) => {
    const title = named.groups.find(t => t.index === index)!;
    return {
      ...g,
      name: title.name,
      reason: title.reason,
      count: g.reviewIds.length,
      percentage: input.study.reviewSampleCount
        ? Math.round(
            (g.reviewIds.length / input.study.reviewSampleCount) * 1000
          ) / 10
        : 0,
    };
  });
}
