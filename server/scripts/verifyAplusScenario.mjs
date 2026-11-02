import * as imageDb from "../domains/image/repository.ts";
import { buildStep4ReferenceRecommendation } from "../domains/image/services/step4ReferenceJob.ts";
import { buildStep5FinalSuggestion } from "../domains/image/routerContext.ts";

const projectId = 780001;
const sessionId = 810001;
const userId = 1;

const project = await imageDb.getProjectByIdAdmin(projectId);
const storedSession = await imageDb.getImageWorkflowSessionById(sessionId);
if (!project || !storedSession) throw new Error("空气套件测试项目或图片会话不存在");

const outline = JSON.parse(storedSession.step2UserEdit || storedSession.step2AiResult || "{}");
outline.aPlusModules = Array.isArray(outline.aPlusModules) ? outline.aPlusModules : [];
outline.aPlusModules[0] = {
  ...(outline.aPlusModules[0] || {}),
  moduleNumber: 1,
  selectedModuleType: "premium_rule_carousel",
  selectedModuleName: "高级规则轮播",
  selectedModuleCategory: "轮播展示",
  selectedModuleStructure: "2-5张轮播面板",
  subModuleRemark: "4种场景：车库、庭院、露营、工地",
  subModuleCount: 4,
  subModules: ["车库", "庭院", "露营", "工地"].map((title, index) => ({
    subModuleNumber: index + 1,
    title,
    purpose: `围绕“${title}”展开的独立A+子图`,
    contentBrief: `展示产品在${title}场景中的核心价值、使用方式或结果。`,
    position: `A+模块 1.${index + 1}`,
  })),
};

const scenarioSession = {
  ...storedSession,
  step2UserEdit: JSON.stringify(outline),
  step2AiResult: JSON.stringify(outline),
};

const step4 = await buildStep4ReferenceRecommendation({
  project,
  session: scenarioSession,
  userId,
  workspaceId: project.workspaceId ?? null,
});
const references = Array.isArray(step4?.imageReferences) ? step4.imageReferences : [];
const scenarioReferences = references.filter((reference) => String(reference?.imageType || "").startsWith("A+模块 1."));

const step5 = await buildStep5FinalSuggestion(project, {
  ...scenarioSession,
  step4UserEdit: JSON.stringify(step4),
  step4AiResult: JSON.stringify(step4),
}, userId, project.workspaceId ?? null);
const sections = step5?.aPlusContent?.sections || [];
const scenarioSection = sections.find((section) => Number(section?.moduleNumber) === 1) || sections[0] || {};
const subModules = scenarioSection.subModules || scenarioSection.moduleSpecificContent?.subImages || [];

console.log(JSON.stringify({
  step4ScenarioReferences: scenarioReferences.map((reference) => ({ imageType: reference.imageType, title: reference.title, purpose: reference.purpose })),
  step5ScenarioSubModules: subModules.map((subModule) => ({ subModuleNumber: subModule.subModuleNumber, title: subModule.title, purpose: subModule.purpose })),
}, null, 2));
