import { describe, expect, it } from "vitest";
import { planningModelSources, compactPlanningEvidence, planningModelCatalog } from "./imagePlanningContext";

describe("图片规划输入保留结论并精简重复材料", () => {
  it("保留三类全部关联编号、产品事实与人工标注，并明确标记证据精简", () => {
    const input = {
      product: { productName: "养蜂服", features: "双层面纱", specs: "六组尺码", notes: "宽袖口" }, productNotes: "宽袖口",
      selling: [{ id: "benefit", text: "舒适", note: "详细说明", evidence: Array.from({length: 20}, () => ({ quote: "证据".repeat(1000), asin: "B012345678" })) }],
      features: [{ id: "feature", text: "双层面纱", note: "内部空间更大" }],
      reviews: [{ id: "review", text: "面纱贴脸" }], questions: [{ id: "question", text: "如何选码" }],
      competitors: Array.from({ length: 3 }, (_, analysisId) => ({ analysisId, asin: "B012345678", title: "竞品", modules: Array.from({length: 60}, () => ({ content: "重复资料".repeat(2000) })), layout: { html: "raw".repeat(10000) } })),
    };
    const result = planningModelSources(input);
    expect(result.selling[0]).toMatchObject({ id: "benefit", note: "详细说明", evidenceCount: 20 });
    expect(result.features[0].id).toBe("feature");
    expect(result.features[0].claimScope).toContain("运营已保存确认的本品资料");
    expect(result.factRules).toContain("卖点梳理就是完善的本品资料");
    expect(result.planningDefaults).toMatchObject({ mainImageAlternatives: 3, secondaryImages: 7, premiumAPlusModules: 7, brandStorySections: 1 });
    expect(result.factRules).toContain("历史AI建议不是本品事实");
    expect(result.contentRules).toContain("功能与用户获益放关联卖点");
    expect(result.reviews).toEqual(input.reviews);
    expect(result.questions).toEqual(input.questions);
    expect(result.product).toEqual({ productName: "养蜂服", features: "双层面纱", specs: "六组尺码" });
    expect(result.productNotes).toBe("宽袖口");
    expect(result.competitors[0].modules.compacted).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThan(40000);
  });
  it("不把原始页面、存储地址和定位坐标交给模型，目录保留全部类型与尺寸", () => {
    expect(compactPlanningEvidence({ html: "page", imageUrl: "private", bounds: [1,2], text: "结构特写" }).value).toEqual({ text: "结构特写" });
    expect(planningModelCatalog).toHaveLength(41);
    expect(planningModelCatalog.find(s => s.family === "高级A+" && s.name === "四列图片")).toMatchObject({ min: 3, max: 4, width: 300, height: 225 });
  });
});
