/**
 * 视频脚本 Excel 导出模块
 * 生成两个 Sheet：拍摄脚本 + 剪辑脚本
 * 格式对齐实际业务模板（合并单元格、中英文字幕等）
 */
import ExcelJS from "exceljs";
import type {
  VideoScript,
  VideoScriptSection,
  VideoScriptSubtopic,
  VideoScriptShot,
  VideoEditScript,
} from "../drizzle/schema";

// ─── 常量映射 ───────────────────────────────────────────
const SHOOTING_METHOD_LABELS: Record<string, string> = {
  model_narration: "模特口播",
  live_action: "实拍",
  ai_generated: "AI生成",
  mixed: "混合拍摄",
  screen_recording: "屏幕录制",
};

const CAMERA_ANGLE_LABELS: Record<string, string> = {
  extreme_closeup: "极特写",
  closeup: "特写",
  medium_closeup: "近景",
  medium: "中景",
  medium_wide: "中远景",
  wide: "远景",
  extreme_wide: "全景",
};

const VIDEO_PURPOSE_LABELS: Record<string, string> = {
  spv_ad: "SP广告视频",
  sbv_ad: "SB广告视频",
  main_listing: "主图视频",
  aplus: "A+视频",
  social_media: "社媒视频",
  other: "其他",
};

// ─── 样式常量 ───────────────────────────────────────────
const HEADER_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF2B2B2B" },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 11,
  name: "微软雅黑",
};

const SECTION_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF5F5F0" },
};

const BODY_FONT: Partial<ExcelJS.Font> = {
  size: 10,
  name: "微软雅黑",
};

const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD0D0D0" } },
  left: { style: "thin", color: { argb: "FFD0D0D0" } },
  bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
  right: { style: "thin", color: { argb: "FFD0D0D0" } },
};

const WRAP_ALIGNMENT: Partial<ExcelJS.Alignment> = {
  vertical: "middle",
  wrapText: true,
};

// ─── 类型 ───────────────────────────────────────────────
interface SectionWithShots {
  section: VideoScriptSection;
  subtopics: VideoScriptSubtopic[];
  shots: VideoScriptShot[];
}

interface ExportData {
  script: VideoScript;
  sections: VideoScriptSection[];
  subtopics: VideoScriptSubtopic[];
  shots: VideoScriptShot[];
  editScripts: VideoEditScript[];
}

// ─── 主导出函数 ─────────────────────────────────────────
export async function generateVideoScriptExcel(data: ExportData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "亚马逊全链路智能工具";
  workbook.created = new Date();

  // 按 section 组织数据
  const sectionGroups = buildSectionGroups(data);

  // Sheet 1: 拍摄脚本
  buildShootingScriptSheet(workbook, data.script, sectionGroups);

  // Sheet 2: 剪辑脚本
  buildEditScriptSheet(workbook, data.script, data.editScripts, sectionGroups);

  // 导出为 Buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ─── 数据组织 ───────────────────────────────────────────
function buildSectionGroups(data: ExportData): SectionWithShots[] {
  const sortedSections = [...data.sections].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  return sortedSections.map((section) => {
    const sectionSubtopics = data.subtopics
      .filter((st) => st.sectionId === section.id)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    const sectionShots = data.shots
      .filter((sh) => sh.sectionId === section.id)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    return { section, subtopics: sectionSubtopics, shots: sectionShots };
  });
}

// ─── Sheet 1: 拍摄脚本 ─────────────────────────────────
function buildShootingScriptSheet(
  workbook: ExcelJS.Workbook,
  script: VideoScript,
  sectionGroups: SectionWithShots[]
) {
  const ws = workbook.addWorksheet("拍摄脚本", {
    properties: { defaultRowHeight: 28 },
  });

  // 列定义（对齐业务模板14列）
  ws.columns = [
    { header: "主题", key: "theme", width: 22 },
    { header: "拍摄方式", key: "shootingMethod", width: 18 },
    { header: "内容", key: "content", width: 20 },
    { header: "拍摄序号", key: "shotCode", width: 14 },
    { header: "时长（S)", key: "duration", width: 10 },
    { header: "分镜概述", key: "shotDescription", width: 35 },
    { header: "分镜画面布局/拍摄方法", key: "cameraInfo", width: 30 },
    { header: "画面文案", key: "overlayText", width: 30 },
    { header: "字幕", key: "narration", width: 35 },
    { header: "分镜画面", key: "storyboard", width: 16 },
    { header: "参考分镜画面", key: "reference", width: 16 },
    { header: "指定素材\n（转场动画，图案、图标）", key: "assets", width: 22 },
    { header: "辅助配色", key: "colorScheme", width: 16 },
    { header: "备注/参考视频链接", key: "notes", width: 22 },
  ];

  // 样式化表头
  const headerRow = ws.getRow(1);
  headerRow.height = 36;
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { ...WRAP_ALIGNMENT, horizontal: "center" };
    cell.border = BORDER_THIN;
  });

  // 写入数据行
  let currentRow = 2;

  for (const group of sectionGroups) {
    const { section, subtopics, shots } = group;
    const sectionStartRow = currentRow;

    // 按 subtopic 分组 shots
    const subtopicGroups = groupShotsBySubtopic(subtopics, shots);

    if (subtopicGroups.length === 0) {
      // 没有镜头的段落，写一行空行
      ws.getRow(currentRow).getCell(1).value = buildSectionLabel(section);
      ws.getRow(currentRow).getCell(2).value = SHOOTING_METHOD_LABELS[section.shootingMethod ?? ""] ?? section.shootingMethod ?? "";
      applyRowStyle(ws.getRow(currentRow));
      currentRow++;
    } else {
      for (const stGroup of subtopicGroups) {
        const subtopicStartRow = currentRow;

        for (const shot of stGroup.shots) {
          const row = ws.getRow(currentRow);
          row.getCell(4).value = shot.shotCode ?? "";
          row.getCell(5).value = shot.duration ? Number(shot.duration) : "";
          row.getCell(6).value = shot.shotDescription ?? "";
          row.getCell(7).value = buildCameraInfo(shot);
          row.getCell(8).value = buildOverlayText(shot);
          row.getCell(9).value = buildNarration(shot);
          row.getCell(10).value = shot.referenceImageUrl ? "（见链接）" : "";
          row.getCell(11).value = "";
          row.getCell(12).value = formatDesignatedAssets(shot);
          row.getCell(13).value = shot.colorScheme ?? "";
          row.getCell(14).value = shot.notes ?? "";
          applyRowStyle(row);
          row.height = 45;
          currentRow++;
        }

        // C列（内容/子主题）合并
        if (stGroup.shots.length > 0) {
          const subtopicEndRow = currentRow - 1;
          const subtopicCell = ws.getCell(subtopicStartRow, 3);
          subtopicCell.value = stGroup.subtopic?.subtopicName ?? "";
          subtopicCell.font = { ...BODY_FONT, bold: true };
          subtopicCell.alignment = WRAP_ALIGNMENT;
          subtopicCell.border = BORDER_THIN;
          if (subtopicEndRow > subtopicStartRow) {
            ws.mergeCells(subtopicStartRow, 3, subtopicEndRow, 3);
          }
        }
      }
    }

    const sectionEndRow = currentRow - 1;

    // A列（主题）合并
    const themeCell = ws.getCell(sectionStartRow, 1);
    themeCell.value = buildSectionLabel(section);
    themeCell.font = { ...BODY_FONT, bold: true };
    themeCell.fill = SECTION_FILL;
    themeCell.alignment = WRAP_ALIGNMENT;
    themeCell.border = BORDER_THIN;
    if (sectionEndRow > sectionStartRow) {
      ws.mergeCells(sectionStartRow, 1, sectionEndRow, 1);
    }

    // B列（拍摄方式）合并
    const methodCell = ws.getCell(sectionStartRow, 2);
    methodCell.value = SHOOTING_METHOD_LABELS[section.shootingMethod ?? ""] ?? section.shootingMethod ?? "";
    methodCell.font = BODY_FONT;
    methodCell.alignment = WRAP_ALIGNMENT;
    methodCell.border = BORDER_THIN;
    if (sectionEndRow > sectionStartRow) {
      ws.mergeCells(sectionStartRow, 2, sectionEndRow, 2);
    }
  }

  // 冻结首行
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 0 }];
}

// ─── Sheet 2: 剪辑脚本 ─────────────────────────────────
function buildEditScriptSheet(
  workbook: ExcelJS.Workbook,
  script: VideoScript,
  editScripts: VideoEditScript[],
  sectionGroups: SectionWithShots[]
) {
  const ws = workbook.addWorksheet("剪辑脚本", {
    properties: { defaultRowHeight: 28 },
  });

  // 列定义
  ws.columns = [
    { header: "视频名称", key: "name", width: 25 },
    { header: "视频用途", key: "purpose", width: 16 },
    { header: "时长控制", key: "duration", width: 14 },
    { header: "剪辑风格", key: "style", width: 16 },
    { header: "素材使用（段落引用）", key: "sections", width: 40 },
    { header: "说明", key: "description", width: 35 },
  ];

  // 样式化表头
  const headerRow = ws.getRow(1);
  headerRow.height = 32;
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { ...WRAP_ALIGNMENT, horizontal: "center" };
    cell.border = BORDER_THIN;
  });

  // 写入数据行
  const sortedEdits = [...editScripts].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  for (let i = 0; i < sortedEdits.length; i++) {
    const es = sortedEdits[i];
    const row = ws.getRow(i + 2);

    row.getCell(1).value = es.editName;
    row.getCell(2).value = VIDEO_PURPOSE_LABELS[es.videoPurpose ?? ""] ?? es.videoPurpose ?? "";
    row.getCell(3).value = es.maxDuration ? `${Number(es.maxDuration)}S 以内` : "";
    row.getCell(4).value = es.editStyle ?? "";
    row.getCell(5).value = buildSectionMappingText(es.sectionMapping, sectionGroups);
    row.getCell(6).value = es.description ?? "";

    applyRowStyle(row);
    row.height = 35;
  }

  // 如果没有剪辑脚本，添加提示行
  if (sortedEdits.length === 0) {
    const row = ws.getRow(2);
    row.getCell(1).value = "（暂无剪辑脚本数据）";
    row.getCell(1).font = { ...BODY_FONT, italic: true, color: { argb: "FF999999" } };
  }

  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 0 }];
}

// ─── 辅助函数 ───────────────────────────────────────────

function applyRowStyle(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = BODY_FONT;
    cell.alignment = WRAP_ALIGNMENT;
    cell.border = BORDER_THIN;
  });
}

function buildSectionLabel(section: VideoScriptSection): string {
  const name = section.sectionName;
  const code = section.sectionCode ? `\n${section.sectionCode}` : "";
  const duration = section.durationBudget ? `(${Number(section.durationBudget)}S)` : "";
  return `${name}${duration}${code}`;
}

function buildCameraInfo(shot: VideoScriptShot): string {
  const parts: string[] = [];
  if (shot.sceneLocation) parts.push(`场景：${shot.sceneLocation}`);
  if (shot.cameraAngle) parts.push(`景别：${CAMERA_ANGLE_LABELS[shot.cameraAngle] ?? shot.cameraAngle}`);
  if (shot.cameraMovement) parts.push(`镜头动作：${shot.cameraMovement}`);
  return parts.join("\n");
}

function buildOverlayText(shot: VideoScriptShot): string {
  const parts: string[] = [];
  if (shot.overlayTextEn) parts.push(shot.overlayTextEn);
  if (shot.overlayTextCn) parts.push(shot.overlayTextCn);
  return parts.join("\n");
}

function buildNarration(shot: VideoScriptShot): string {
  const parts: string[] = [];
  const en = shot.narrationEn || shot.subtitleEn || "";
  const cn = shot.narrationCn || shot.subtitleCn || "";
  if (en) parts.push(en);
  if (cn) parts.push(cn);
  return parts.join("\n");
}

function formatDesignatedAssets(shot: VideoScriptShot): string {
  if (!shot.designatedAssets) return "";
  const assets = shot.designatedAssets as any;
  if (Array.isArray(assets)) return assets.join("、");
  if (typeof assets === "string") return assets;
  return JSON.stringify(assets);
}

interface SubtopicGroup {
  subtopic: VideoScriptSubtopic | null;
  shots: VideoScriptShot[];
}

function groupShotsBySubtopic(
  subtopics: VideoScriptSubtopic[],
  shots: VideoScriptShot[]
): SubtopicGroup[] {
  if (subtopics.length === 0) {
    return shots.length > 0 ? [{ subtopic: null, shots }] : [];
  }

  const groups: SubtopicGroup[] = [];
  for (const st of subtopics) {
    const stShots = shots
      .filter((sh) => sh.subtopicId === st.id)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    groups.push({ subtopic: st, shots: stShots });
  }

  // Add orphan shots (not belonging to any subtopic)
  const assignedShotIds = new Set(groups.flatMap((g) => g.shots.map((s) => s.id)));
  const orphanShots = shots.filter((sh) => !assignedShotIds.has(sh.id));
  if (orphanShots.length > 0) {
    groups.push({ subtopic: null, shots: orphanShots });
  }

  return groups.filter((g) => g.shots.length > 0);
}

function buildSectionMappingText(
  mapping: unknown,
  sectionGroups: SectionWithShots[]
): string {
  if (!mapping) return "";

  const mappingArr = Array.isArray(mapping) ? mapping : [];
  if (mappingArr.length === 0) return "";

  const sectionMap = new Map(sectionGroups.map((g) => [g.section.id, g.section]));

  return mappingArr
    .map((item: any) => {
      const sectionId = typeof item === "number" ? item : item?.sectionId;
      const section = sectionMap.get(sectionId);
      if (!section) return `段落#${sectionId}`;
      const code = section.sectionCode ?? "";
      return `${section.sectionName}${code ? ` (${code})` : ""}`;
    })
    .join("\n");
}
