import { describe, expect, it } from "vitest";
import { parseKnowledgeAnalysisJson, parseKnowledgeImageAnalysis } from "./legacyImageAnalysis";
import { CATEGORY_OPTIONS, COLOR_TAG_OPTIONS, STYLE_NAME_OPTIONS, IMAGE_TYPE_HIERARCHY, IMAGE_BELONG_OPTIONS } from "../../../shared/imageTagConstants";
const type = Object.keys(IMAGE_TYPE_HIERARCHY)[0];
const sample = { tagCategory: CATEGORY_OPTIONS[0], tagImageTypeMain: type, tagImageTypeSub: IMAGE_TYPE_HIERARCHY[type as keyof typeof IMAGE_TYPE_HIERARCHY][0], tagSellingPointCategory: "", tagSellingPointDetail: "", tagComposition: "一拖二", tagColorSchemeV2: COLOR_TAG_OPTIONS[0], tagDesignStyleV2: STYLE_NAME_OPTIONS[0], tagImageBelong: IMAGE_BELONG_OPTIONS[0], tagImageBelongSub: "", singleImageScore: 8, highlights: [] };
describe("restored knowledge image analysis", () => {
  it("accepts fenced provider JSON with the original taxonomy", () => expect(parseKnowledgeImageAnalysis('```json\n'+JSON.stringify(sample)+'\n```').tagComposition).toBe("一拖二"));
  it("rejects photography terms and palettes instead of overwriting tags", () => {
    expect(()=>parseKnowledgeImageAnalysis(JSON.stringify({...sample,tagComposition:"三分法构图"}))).toThrow();
    expect(()=>parseKnowledgeImageAnalysis(JSON.stringify({...sample,tagColorSchemeV2:"黑金配色"}))).toThrow();
  });
  it("does not treat unrelated output as empty tags", () => expect(()=>parseKnowledgeImageAnalysis('{"productType":"test"}')).toThrow());
  it("supports summary JSON without accepting arrays", () => {expect(parseKnowledgeAnalysisJson('```json\n{"summary":"ok"}\n```')).toEqual({summary:"ok"});expect(()=>parseKnowledgeAnalysisJson('[]')).toThrow();});
});
