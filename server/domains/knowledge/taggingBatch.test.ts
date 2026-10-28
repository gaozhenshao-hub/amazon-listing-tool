import { describe, expect, it } from "vitest";
import { parseTaggingBatch } from "./taggingBatch";
import { IMAGE_TAGGING_OPTIONS } from "../../../shared/imageTagging";
const candidate = {imageId:1,tagCategory:IMAGE_TAGGING_OPTIONS.categories[0],tagImageTypeMain:"细节",tagImageTypeSub:"单一特写",tagSellingPointCategory:"",tagSellingPointDetail:"",tagComposition:"一分构图",tagColorSchemeV2:"黑色,白色",tagDesignStyleV2:IMAGE_TAGGING_OPTIONS.styles[0],accentColor:"蓝色",evidence:"白底实物特写"};
describe("tagging batch recovery",()=>{
  it("normalizes primary colours and ignores extra metadata without discarding other images",()=>{
    const result=parseTaggingBatch(JSON.stringify({items:[{...candidate,extra:"ignored"},{...candidate,imageId:2,tagComposition:"猜测"}]}),[1,2]);
    expect(result.size).toBe(1);expect(result.get(1)?.tagColorSchemeV2).toBe("黑色");
  });
  it("rejects unknown identities and ambiguous duplicate answers",()=>{
    const result=parseTaggingBatch(JSON.stringify({items:[candidate,candidate,{...candidate,imageId:99}]}),[1,2]);
    expect(result.size).toBe(0);
  });
  it("uses the controlled vocabulary parent for exact, uniquely known child labels",()=>{
    const result=parseTaggingBatch(JSON.stringify({items:[{...candidate,tagImageTypeMain:"必要",tagImageTypeSub:"多细节",tagSellingPointCategory:"功能",tagSellingPointDetail:"易收纳/便携/移动"}]}),[1]);
    expect(result.get(1)).toMatchObject({tagImageTypeMain:"细节",tagImageTypeSub:"多细节",tagSellingPointCategory:"附加值",tagSellingPointDetail:"易收纳/便携/移动"});
  });
  it("still rejects invented child labels instead of guessing their meaning",()=>{
    const result=parseTaggingBatch(JSON.stringify({items:[{...candidate,tagSellingPointCategory:"功能",tagSellingPointDetail:"随身魔法"}]}),[1]);
    expect(result.size).toBe(0);
  });
});

it("accepts local labels without duplicating set-level style and colours",()=>{
 const result=parseTaggingBatch(JSON.stringify({items:[{...candidate,tagCategory:"",tagDesignStyleV2:"",tagColorSchemeV2:"",accentColor:""}]}),[1]);
 expect(result.size).toBe(1);expect(result.get(1)?.tagComposition).toBe("一分构图");
});
