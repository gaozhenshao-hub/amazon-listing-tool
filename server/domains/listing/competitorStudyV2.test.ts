import { expect, it, vi } from "vitest";
const f=vi.hoisted(()=>({invalid:false,modes:[] as string[],skills:[] as string[],
}));
vi.mock("../knowledge/richContentTranslation",()=>({translateRichContent:async(input:any)=>({presentation:{version:1,texts:[],images:[],generatedAt: "2026-10-30",
    },findings:input.assets.map((a:any)=>({hash:a.sourceUrlHash,translation: "图片文字",sellingPoints:["耐用"],sellingPointCategories:["质量"],
    })),
  }),
}));
vi.mock("../../storage",()=>({resolveStoredObjectUrl:async (key:string)=>`https://example.invalid/${key}`,
}));
vi.mock("../ai_os/services/skillRunner",()=>({safeParseSkillJSON:JSON.parse,runEmperorSkill:async (input:any)=>{
 const c=JSON.parse(input.context);f.modes.push(c.mode);f.skills.push(input.skillSlug);let result:any;
 if(c.mode=== "listing")result={titleTranslation: "测试产品",bullets:c.bullets.map((_:string,index:number)=>({index,translation: "翻译",sellingPoints:["耐用"],
        })),
      };
 if(c.mode=== "images")result={images:c.images.map((image:any)=>({hash:image.hash,translation: "图片文字",sellingPoints:["耐用"],
        })),
      };
 if(c.mode=== "reviews")result={groups:[{name: "质量好",reason: "质量依据",reviewIds:f.invalid?["wrong"]:c.reviews.map((r:any)=>r.id),
          },...(c.sentiment=== "positive"
            ?[{name: "透气",reason: "透气依据",reviewIds:[c.reviews[0].id],
                },
              ]:[]),
        ],translations:c.reviews.map((r:any)=>({id:r.id,translation: "原文翻译",
        })),
      };
 if(c.mode=== "merge")result={groups:c.groups.map((g:any)=>({name:g.name,reason:g.reason,sourceIds:[g.id],
        })),
      };
 return {parsed:input.validate(JSON.stringify(result))};
},
}));
import { analyzeCompetitorStudyV2 } from "./competitorStudyV2";
const example={userId:7,workspaceId:3,data:{asin: "B012345678",title: "Test",bulletPoints:["durable"],research:{reviews:[{id: "a",title: "a",body: "good and breathable",rating:5},{id: "b",title: "b",body: "poor",rating:3},{id: "c",title: "c",body: "unrated",rating:null},
      ],
    },
  },assets:[{role: "main",storageKey: "image",sourceUrlHash: "a".repeat(64)},
  ],imported:[],
};
it("uses separate skills, counts 3-star as negative and allows one review in multiple themes",async()=>{
 f.invalid=false;f.modes=[];f.skills=[];const result=await analyzeCompetitorStudyV2(example);
 expect(result.reviewSampleCount).toBe(2);expect(result.reviewUnratedCount).toBe(1);expect(result.reviewSentimentCounts).toEqual({positive:1,negative:1});
 const positive=result.reviews.filter(r=>r.sentiment=== "positive");expect(positive).toHaveLength(2);expect(positive[0].reviewIds).toEqual(positive[1].reviewIds);expect(positive[0].percentage).toBe(50);
 expect(f.skills).toContain("listing.competitor.content.v2");expect(f.skills).toContain("listing.competitor.reviews.v2");expect(Object.keys(result.reviewTranslations)).toHaveLength(2);
});
it("rejects fabricated review evidence",async()=>{f.invalid=true;await expect(analyzeCompetitorStudyV2(example)).rejects.toThrow(
    "评论分析引用不属于当前样本"
  );});
