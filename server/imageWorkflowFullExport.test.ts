import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildFullPlanContent } from "../client/src/pages/imageWorkflow/exportContent";

const root = path.resolve(import.meta.dirname, "..");

describe("图片工作流六步完整方案导出", () => {
  const session = {
    step0UserEdit: JSON.stringify({ overallSummary: "竞品更偏好用细节拆解表达密封能力" }),
    step1UserEdit: JSON.stringify({ coreSellingPoints: [{ point: "双重密封" }] }),
    step2UserEdit: JSON.stringify({ images: [{ imageLabel: "辅图 2", content: "展示密封结构" }] }),
    step3UserEdit: JSON.stringify({
      selectedStyles: [{ id: 9000, name: "工业风", source: "kb_asin", asinSetId: 18, asin: "B0TESTASIN", thumbnailUrl: "https://assets.example/thumbnail.jpg" }],
      styleKbImages: { 9000: [{ id: 9, imageUrl: "https://assets.example/style.jpg" }] },
    }),
    step4UserEdit: JSON.stringify({ imageReferences: [{
      imageLabel: "辅图 2",
      compositionRefImageUrl: "https://assets.example/composition.jpg",
      effectRefImageUrl: "https://assets.example/effect.jpg",
      compositionReference: {
        compositionType: "左图右文对比构图",
        layout: "左侧产品剖面，右侧放大密封结构",
        focalPoint: "O 型圈与 PTFE 胶带接缝",
        visualFlow: "从产品主体引导至放大细节",
        proportions: "产品 65%，文案 20%，留白 15%",
        designNotes: "避免背景抢占产品细节",
      },
      effectReference: {
        colorApplication: "深灰金属背景搭配工业蓝",
        typographyApplication: "无衬线粗字体搭配高对比白字",
        iconApplication: "使用放大镜与防漏图标",
        atmosphere: "专业、硬核、可信赖",
        lightingStyle: "右侧硬光突出金属边缘",
      },
      kbReferenceImages: [{ id: 10, imageUrl: "https://assets.example/reference.jpg" }],
    }] }),
    step5UserEdit: JSON.stringify({
      mainImage: { title: "密封管件", concept: "工业级可靠性" },
      aPlusContent: {
        overallStrategy: "先建立专业信任，再逐层证明密封能力",
        overallStory: "主图吸引注意，辅图拆解技术，A+ 收束品牌承诺",
        consistency: "全程沿用工业蓝与金属质感",
        modularDesign: "每个模块承接上一张图片的疑问",
        sections: [],
      },
    }),
    step5DesignerUploads: JSON.stringify([{ imageNumber: 2, imageUrl: "https://assets.example/designer.jpg", notes: "细节补充" }]),
  };

  const assets = {
    expressionGroups: [{
      expressionName: "细节拆解",
      userEdit: JSON.stringify({ summary: "用结构特写建立信任", highlights: [{ text: "密封圈剖面" }] }),
      images: [{ competitorName: "竞品 A", imageUrl: "https://assets.example/competitor.jpg" }],
    }],
    asinReferenceSets: [{
      id: 18,
      asin: "B0TESTASIN",
      productTitle: "参考工业管件",
      setStyle: "工业风",
      images: [{ imagePosition: "secondary", positionIndex: 2, imageUrl: "https://assets.example/asin-secondary.jpg" }],
    }],
  };

  it("输出 Step0 至 Step5 的目录与业务内容", () => {
    const html = buildFullPlanContent(session, undefined, undefined, assets);
    for (const label of ["Step 0: 竞品图片分析", "Step 1: 卖点梳理", "Step 2: 图片大纲", "Step 3: 风格确认", "Step 4: 参考图确认", "Step 5: 图片结构及内容建议"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("竞品更偏好用细节拆解表达密封能力");
    expect(html).toContain("双重密封");
  });

  it("嵌入竞品组图片、知识库风格图、ASIN 集全量图片和 Step4/5 资产", () => {
    const html = buildFullPlanContent(session, undefined, undefined, assets);
    for (const url of [
      "https://assets.example/competitor.jpg",
      "https://assets.example/style.jpg",
      "https://assets.example/asin-secondary.jpg",
      "https://assets.example/composition.jpg",
      "https://assets.example/effect.jpg",
      "https://assets.example/reference.jpg",
      "https://assets.example/designer.jpg",
    ]) {
      expect(html).toContain(url);
    }
    expect(html).toContain("参考工业管件");
    expect(html).toContain("B0TESTASIN");
  });

  it("导出 Step4 构图/效果方案文字及 Step5 整套图片叙事逻辑", () => {
    const html = buildFullPlanContent(session, undefined, undefined, assets);
    for (const content of [
      "左图右文对比构图",
      "左侧产品剖面，右侧放大密封结构",
      "O 型圈与 PTFE 胶带接缝",
      "从产品主体引导至放大细节",
      "深灰金属背景搭配工业蓝",
      "使用放大镜与防漏图标",
      "右侧硬光突出金属边缘",
      "先建立专业信任，再逐层证明密封能力",
      "主图吸引注意，辅图拆解技术，A+ 收束品牌承诺",
      "全程沿用工业蓝与金属质感",
    ]) {
      expect(html).toContain(content);
    }
    expect(html).toContain("整套图片叙事逻辑");
  });

  it("通过后端导出包接口而不是页面缓存来取得完整资产", () => {
    const sessionsRouter = fs.readFileSync(path.join(root, "server/domains/image/routers/sessions.ts"), "utf8");
    const page = fs.readFileSync(path.join(root, "client/src/pages/ImageWorkflowPage.tsx"), "utf8");
    expect(sessionsRouter).toContain("getExportBundle: protectedProcedure");
    expect(sessionsRouter).toContain("getExpressionGroupsByProject");
    expect(sessionsRouter).toContain("asinReferenceSets");
    expect(page).toContain("trpc.imageWorkflow.getExportBundle.useQuery");
    expect(page).toContain("buildFullPlanContent(bundle.session, undefined, undefined, bundle)");
  });
});
