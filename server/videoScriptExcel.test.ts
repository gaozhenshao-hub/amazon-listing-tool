import { describe, it, expect } from "vitest";
import { generateVideoScriptExcel } from "./videoScriptExcel";
import ExcelJS from "exceljs";

// Mock data matching the DB schema types
const mockScript = {
  id: 1,
  projectId: 1,
  userId: 1,
  scriptName: "测试铸铁面包盘视频脚本",
  productName: "铸铁面包盘",
  videoType: "main_video" as const,
  stylePreset: "professional",
  targetDuration: "60.0",
  currentStage: "stage_4" as const,
  stageStatus: JSON.stringify({ stage_0a: "completed", stage_0b: "completed", stage_1: "completed", stage_2: "completed", stage_3: "completed", stage_4: "completed" }),
  version: 1,
  versionNote: null,
  status: "completed" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockSections = [
  {
    id: 1, videoScriptId: 1, sectionCode: "MBP1", sectionName: "片头",
    sectionNameEn: "Opening", shootingMethod: "ai_generated" as const,
    durationBudget: "7.0", sellingPointRefs: null, painPointRefs: null,
    description: "开场吸引注意力", shotTypeSuggestion: null, propsSuggestion: null,
    sortOrder: 0, userConfirmed: 1, createdAt: new Date(), updatedAt: new Date(),
  },
  {
    id: 2, videoScriptId: 1, sectionCode: "MBP2", sectionName: "安装前-介绍配件",
    sectionNameEn: "Unboxing", shootingMethod: "model_narration" as const,
    durationBudget: "17.5", sellingPointRefs: null, painPointRefs: null,
    description: "展示产品配件", shotTypeSuggestion: null, propsSuggestion: null,
    sortOrder: 1, userConfirmed: 1, createdAt: new Date(), updatedAt: new Date(),
  },
];

const mockSubtopics = [
  {
    id: 1, sectionId: 1, subtopicName: "短片头", subtopicNameEn: "Short intro",
    durationBudget: "3.0", shotCount: 2, sellingPointRef: null,
    sortOrder: 0, createdAt: new Date(), updatedAt: new Date(),
  },
  {
    id: 2, sectionId: 2, subtopicName: "开箱展示", subtopicNameEn: "Unboxing display",
    durationBudget: "8.0", shotCount: 3, sellingPointRef: null,
    sortOrder: 0, createdAt: new Date(), updatedAt: new Date(),
  },
  {
    id: 3, sectionId: 2, subtopicName: "配件介绍", subtopicNameEn: "Accessories",
    durationBudget: "9.5", shotCount: 2, sellingPointRef: null,
    sortOrder: 1, createdAt: new Date(), updatedAt: new Date(),
  },
];

const mockShots = [
  {
    id: 1, subtopicId: 1, sectionId: 1, shotCode: "MBP1-1", duration: "3.0",
    shotDescription: "固定镜头拍切酸面包", sceneLocation: "厨房",
    cameraAngle: "closeup" as const, cameraMovement: "固定镜头",
    overlayTextEn: "AQOVOR Cast Iron Bread Pan", overlayTextCn: "AQOVOR 铸铁面包盘",
    narrationEn: null, narrationCn: null,
    subtitleEn: "The best bread you'll ever bake", subtitleCn: "你烤过的最好的面包",
    narratorType: "text_only" as const, generationStrategy: "ai_video" as const,
    reuseFromShotCode: null, designatedAssets: null, colorScheme: "黑白为主",
    props: null, notes: null, referenceImageUrl: null,
    sortOrder: 0, createdAt: new Date(), updatedAt: new Date(),
  },
  {
    id: 2, subtopicId: 1, sectionId: 1, shotCode: "MBP1-2", duration: "4.0",
    shotDescription: "品牌Logo展示", sceneLocation: "厨房",
    cameraAngle: "medium" as const, cameraMovement: "推镜头",
    overlayTextEn: null, overlayTextCn: null,
    narrationEn: null, narrationCn: null,
    subtitleEn: null, subtitleCn: null,
    narratorType: "none" as const, generationStrategy: "ai_image" as const,
    reuseFromShotCode: null, designatedAssets: ["品牌Logo", "转场动画"],
    colorScheme: null, props: null, notes: "参考竞品A的片头风格",
    referenceImageUrl: "https://example.com/ref.jpg",
    sortOrder: 1, createdAt: new Date(), updatedAt: new Date(),
  },
  {
    id: 3, subtopicId: 2, sectionId: 2, shotCode: "MBP2-3", duration: "3.0",
    shotDescription: "模特打开包装盒", sceneLocation: "厨房岛台",
    cameraAngle: "medium" as const, cameraMovement: "固定镜头",
    overlayTextEn: null, overlayTextCn: null,
    narrationEn: "Let me show you what's inside the box", narrationCn: "让我来展示一下包装内容",
    subtitleEn: null, subtitleCn: null,
    narratorType: "model_narration" as const, generationStrategy: "real_shoot" as const,
    reuseFromShotCode: null, designatedAssets: null, colorScheme: null,
    props: null, notes: null, referenceImageUrl: null,
    sortOrder: 0, createdAt: new Date(), updatedAt: new Date(),
  },
  {
    id: 4, subtopicId: 2, sectionId: 2, shotCode: "MBP2-4", duration: "2.5",
    shotDescription: "展示面包盘主体", sceneLocation: "厨房岛台",
    cameraAngle: "closeup" as const, cameraMovement: "向右运动",
    overlayTextEn: null, overlayTextCn: null,
    narrationEn: "The star of today", narrationCn: "今天的主角",
    subtitleEn: null, subtitleCn: null,
    narratorType: "model_narration" as const, generationStrategy: "real_shoot" as const,
    reuseFromShotCode: null, designatedAssets: null, colorScheme: null,
    props: null, notes: null, referenceImageUrl: null,
    sortOrder: 1, createdAt: new Date(), updatedAt: new Date(),
  },
  {
    id: 5, subtopicId: 3, sectionId: 2, shotCode: "MBP2-5", duration: "5.0",
    shotDescription: "展示配件清单", sceneLocation: "厨房岛台",
    cameraAngle: "medium_wide" as const, cameraMovement: "固定镜头",
    overlayTextEn: "Included accessories", overlayTextCn: "包含配件",
    narrationEn: "Everything you need is included", narrationCn: "所需配件一应俱全",
    subtitleEn: null, subtitleCn: null,
    narratorType: "voiceover" as const, generationStrategy: "real_shoot" as const,
    reuseFromShotCode: null, designatedAssets: null, colorScheme: null,
    props: null, notes: null, referenceImageUrl: null,
    sortOrder: 0, createdAt: new Date(), updatedAt: new Date(),
  },
];

const mockEditScripts = [
  {
    id: 1, videoScriptId: 1, editName: "铸铁面包盘 广告视频1",
    videoPurpose: "spv_ad" as const, maxDuration: "45.0",
    editStyle: "快节奏", sectionMapping: [{ sectionId: 1 }, { sectionId: 2 }],
    description: "使用片头和介绍配件段落", sortOrder: 0, userConfirmed: 1,
    createdAt: new Date(), updatedAt: new Date(),
  },
  {
    id: 2, videoScriptId: 1, editName: "铸铁面包盘 主图视频",
    videoPurpose: "main_listing" as const, maxDuration: "90.0",
    editStyle: "专业", sectionMapping: [{ sectionId: 1 }, { sectionId: 2 }],
    description: "完整产品展示", sortOrder: 1, userConfirmed: 0,
    createdAt: new Date(), updatedAt: new Date(),
  },
];

describe("videoScriptExcel", () => {
  it("should generate a valid Excel buffer with two sheets", async () => {
    const buffer = await generateVideoScriptExcel({
      script: mockScript,
      sections: mockSections,
      subtopics: mockSubtopics,
      shots: mockShots,
      editScripts: mockEditScripts,
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);

    // Parse the buffer back
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.worksheets.length).toBe(2);
    expect(workbook.worksheets[0].name).toBe("拍摄脚本");
    expect(workbook.worksheets[1].name).toBe("剪辑脚本");
  });

  it("should have correct shooting script headers (14 columns)", async () => {
    const buffer = await generateVideoScriptExcel({
      script: mockScript,
      sections: mockSections,
      subtopics: mockSubtopics,
      shots: mockShots,
      editScripts: mockEditScripts,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const ws = workbook.worksheets[0];

    const headerRow = ws.getRow(1);
    expect(headerRow.getCell(1).value).toBe("主题");
    expect(headerRow.getCell(4).value).toBe("拍摄序号");
    expect(headerRow.getCell(5).value).toBe("时长（S)");
    expect(headerRow.getCell(6).value).toBe("分镜概述");
    expect(headerRow.getCell(9).value).toBe("字幕");
    expect(headerRow.getCell(14).value).toBe("备注/参考视频链接");
  });

  it("should populate shot data correctly", async () => {
    const buffer = await generateVideoScriptExcel({
      script: mockScript,
      sections: mockSections,
      subtopics: mockSubtopics,
      shots: mockShots,
      editScripts: mockEditScripts,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const ws = workbook.worksheets[0];

    // Row 2 should be the first shot (MBP1-1)
    const row2 = ws.getRow(2);
    expect(row2.getCell(4).value).toBe("MBP1-1");
    expect(row2.getCell(5).value).toBe(3);
    expect(row2.getCell(6).value).toBe("固定镜头拍切酸面包");

    // Camera info should include scene, angle, movement
    const cameraInfo = row2.getCell(7).value as string;
    expect(cameraInfo).toContain("厨房");
    expect(cameraInfo).toContain("特写");
    expect(cameraInfo).toContain("固定镜头");

    // Overlay text
    const overlay = row2.getCell(8).value as string;
    expect(overlay).toContain("AQOVOR Cast Iron Bread Pan");
    expect(overlay).toContain("AQOVOR 铸铁面包盘");
  });

  it("should handle narration/subtitle fallback correctly", async () => {
    const buffer = await generateVideoScriptExcel({
      script: mockScript,
      sections: mockSections,
      subtopics: mockSubtopics,
      shots: mockShots,
      editScripts: mockEditScripts,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const ws = workbook.worksheets[0];

    // Shot MBP1-1 has no narration but has subtitle → should use subtitle
    const row2Narration = ws.getRow(2).getCell(9).value as string;
    expect(row2Narration).toContain("The best bread you'll ever bake");

    // Shot MBP2-3 has narration → should use narration
    // MBP2-3 is shot id=3, in section 2, subtopic 2, first shot → row depends on layout
    // Section 1 has 2 shots (rows 2-3), Section 2 starts at row 4
    const row4Narration = ws.getRow(4).getCell(9).value as string;
    expect(row4Narration).toContain("Let me show you what's inside the box");
  });

  it("should create merged cells for sections", async () => {
    const buffer = await generateVideoScriptExcel({
      script: mockScript,
      sections: mockSections,
      subtopics: mockSubtopics,
      shots: mockShots,
      editScripts: mockEditScripts,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const ws = workbook.worksheets[0];

    // Section 1 (片头) has 2 shots → A2:A3 should be merged
    // Section 2 (安装前) has 3 shots → A4:A6 should be merged
    // Check that merged cells exist
    const mergedCells = Array.from(ws.model.merges || []);
    expect(mergedCells.length).toBeGreaterThan(0);

    // Check section label content
    const themeCell = ws.getCell("A2").value as string;
    expect(themeCell).toContain("片头");
    expect(themeCell).toContain("7");
  });

  it("should populate edit script sheet correctly", async () => {
    const buffer = await generateVideoScriptExcel({
      script: mockScript,
      sections: mockSections,
      subtopics: mockSubtopics,
      shots: mockShots,
      editScripts: mockEditScripts,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const ws = workbook.worksheets[1];

    // Header
    expect(ws.getRow(1).getCell(1).value).toBe("视频名称");
    expect(ws.getRow(1).getCell(2).value).toBe("视频用途");

    // Row 2: first edit script
    expect(ws.getRow(2).getCell(1).value).toBe("铸铁面包盘 广告视频1");
    expect(ws.getRow(2).getCell(2).value).toBe("SP广告视频");
    expect(ws.getRow(2).getCell(3).value).toBe("45S 以内");

    // Row 3: second edit script
    expect(ws.getRow(3).getCell(1).value).toBe("铸铁面包盘 主图视频");
    expect(ws.getRow(3).getCell(2).value).toBe("主图视频");
  });

  it("should handle empty data gracefully", async () => {
    const buffer = await generateVideoScriptExcel({
      script: mockScript,
      sections: [],
      subtopics: [],
      shots: [],
      editScripts: [],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.worksheets.length).toBe(2);
    // Edit script sheet should have placeholder text
    const ws2 = workbook.worksheets[1];
    expect(ws2.getRow(2).getCell(1).value).toBe("（暂无剪辑脚本数据）");
  });

  it("should format designated assets correctly", async () => {
    const buffer = await generateVideoScriptExcel({
      script: mockScript,
      sections: mockSections,
      subtopics: mockSubtopics,
      shots: mockShots,
      editScripts: mockEditScripts,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const ws = workbook.worksheets[0];

    // Shot MBP1-2 (row 3) has designatedAssets: ["品牌Logo", "转场动画"]
    const assetsCell = ws.getRow(3).getCell(12).value as string;
    expect(assetsCell).toContain("品牌Logo");
    expect(assetsCell).toContain("转场动画");
  });

  it("should include reference image indicator", async () => {
    const buffer = await generateVideoScriptExcel({
      script: mockScript,
      sections: mockSections,
      subtopics: mockSubtopics,
      shots: mockShots,
      editScripts: mockEditScripts,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const ws = workbook.worksheets[0];

    // Shot MBP1-2 (row 3) has referenceImageUrl → should show indicator
    expect(ws.getRow(3).getCell(10).value).toBe("（见链接）");
    // Shot MBP1-1 (row 2) has no referenceImageUrl → should be empty
    expect(ws.getRow(2).getCell(10).value).toBe("");
  });
});
