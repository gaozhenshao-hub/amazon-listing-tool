import "dotenv/config";
import { createHash } from "crypto";
import { readdirSync, readFileSync } from "fs";
import { relative, resolve } from "path";
import mysql from "mysql2/promise";
import ts from "typescript";

const ROOT = resolve(process.cwd());
const STRICT = process.argv.includes("--strict");

const BUSINESS_GLOBS = [
  "server/routers/adAnalysis.ts",
  "server/routers/adAnalysisP2.ts",
  "server/routers/adDeepAnalysis.ts",
  "server/routers/adLocalAnalysis.ts",
  "server/routers/adStructure.ts",
  "server/routers/afterSales.ts",
  "server/routers/analysis.ts",
  "server/routers/buyerQuestions.ts",
  "server/routers/conversionAiScorer.ts",
  "server/routers/customerProfile.ts",
  "server/routers/dashboardUpgrade.ts",
  "server/routers/devAnalysis.ts",
  "server/routers/devBom.ts",
  "server/routers/devManual.ts",
  "server/routers/devProfile.ts",
  "server/routers/devProjectTags.ts",
  "server/routers/devScoring.ts",
  "server/routers/devTagging.ts",
  "server/routers/imageAiAnalyzer.ts",
  "server/routers/imageWorkflow.ts",
  "server/routers/kbBot.ts",
  "server/routers/kbImages.ts",
  "server/routers/kbIntel.ts",
  "server/routers/kbListings.ts",
  "server/routers/kbProducts.ts",
  "server/routers/kbSkills.ts",
  "server/routers/kbVideos.ts",
  "server/routers/keywordAi.ts",
  "server/routers/listing.ts",
  "server/routers/offAnalytics.ts",
  "server/routers/offCampaign.ts",
  "server/routers/offContent.ts",
  "server/routers/offInfluencer.ts",
  "server/routers/offOutreach.ts",
  "server/routers/offSocial.ts",
  "server/routers/offsiteAnalysis.ts",
  "server/routers/operations.ts",
  "server/routers/opsProductPlan.ts",
  "server/routers/productOps.ts",
  "server/routers/projectFile.ts",
  "server/routers/reviewAggregation.ts",
  "server/routers/scoring.ts",
  "server/routers/taskManagement.ts",
  "server/routers/videoScript.ts",
  "server/intelAutoCollect.ts",
  "server/replenishmentEngine.ts",
  "server/scheduledHandlers.ts",
];

function discoverBusinessSkillFiles(directory = resolve(ROOT, "server")) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) return discoverBusinessSkillFiles(absolute);
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts") || /\s+\d+\.ts$/.test(entry.name)) return [];
    const source = readFileSync(absolute, "utf8");
    return source.includes("invokeBusinessSkill") ? [relative(ROOT, absolute)] : [];
  });
}

for (const file of discoverBusinessSkillFiles()) {
  if (!BUSINESS_GLOBS.includes(file)) BUSINESS_GLOBS.push(file);
}

function hash(value) {
  return createHash("sha256").update(value || "").digest("hex").slice(0, 16);
}

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => text.includes(pattern));
}

function inferImageWorkflowSkill(text) {
  if (hasAny(text, ["逐张分析", "竞品图片分析", "imageType", "expressionMethod"])) return "image.step0.competitor.analysis";
  if (hasAny(text, ["整体总结报告", "sellingPointDistribution", "differentiationOpportunities"])) return "image.step0.competitor.summary";
  if (hasAny(text, ["卖点体系", "核心卖点", "negativeReviewPoints"])) return "image.step1.sellingpoints";
  if (hasAny(text, ["图片大纲", "规划每张图片", "aPlusModules"])) return "image.step2.outline";
  if (hasAny(text, ["视觉风格方案", "styleOptions", "colorPalette"])) return "image.step3.style";
  if (hasAny(text, ["构图参考", "效果图参考", "imageReferences"])) return "image.step4.reference";
  if (hasAny(text, ["完整图片建议", "图片结构及内容建议", "aPlusContent"])) return "image.step5.final.suggestion";
  if (hasAny(text, ["A+模块规格", "selectedModules"])) return "image.step5.aplus.optimize";
  if (hasAny(text, ["某一个模块", "单独优化该模块"])) return "image.step5.aplus.single.optimize";
  if (hasAny(text, ["3套最佳", "模块组合方案"])) return "image.step5.aplus.combo.recommend";
  if (hasAny(text, ["AI提示词", "negativePrompt", "prompt和negativePrompt"])) return "image.step6.prompt";
  if (hasAny(text, ["翻译", "中英文翻译"])) return "listing.translate.chinese";
  return "image.workflow.general";
}

function inferListingSkill(text) {
  if (hasAny(text, ["translate", "翻译", "中文"])) return "listing.translate.chinese";
  if (hasAny(text, ["Q&A", "QA", "question", "answer"])) return "listing.qa.generate";
  if (hasAny(text, ["A/B", "AB测试", "variants"])) return "listing.abtest.generate";
  if (hasAny(text, ["checklist", "质量自检", "评分"])) return "listing.scoring.overall";
  if (hasAny(text, ["selling point", "卖点", "FABE"])) return "listing.sellingpoints.generate";
  if (hasAny(text, ["bullet", "五点"])) return "listing.bullets.generate";
  if (hasAny(text, ["search terms", "搜索词"])) return "listing.searchterms.generate";
  if (hasAny(text, ["description", "产品描述"])) return "listing.description.generate";
  if (hasAny(text, ["title", "标题"])) return "listing.title.generate";
  return "listing.general";
}

function inferKeywordSkill(text) {
  if (hasAny(text, ["root", "词根"])) return "keyword.root.classify";
  if (hasAny(text, ["traffic", "流量", "competition", "竞争"])) return "keyword.traffic.classify";
  if (hasAny(text, ["scene", "场景", "COSMO"])) return "keyword.scene.tag";
  if (hasAny(text, ["filter", "过滤", "相关性"])) return "keyword.semantic.filter";
  if (hasAny(text, ["listing", "标题", "五点", "Search Terms"])) return "keyword.listing.layout";
  return "keyword.strategy.matrix";
}

function inferAdSkill(file, text) {
  if (file.endsWith("adStructure.ts") || hasAny(text, ["广告结构", "campaigns", "adGroups"])) return "ad.structure.generate";
  if (hasAny(text, ["预算", "budget"])) return "ad.budget.allocation";
  if (hasAny(text, ["否定", "negative"])) return "ad.negative.generate";
  if (hasAny(text, ["分时", "dayparting", "时段"])) return "ad.dayparting.strategy";
  if (hasAny(text, ["搜索词", "search term"])) return "ad.searchterm.advice";
  return "ad.diagnosis";
}

function inferSkill(file, text, explicitSlug) {
  if (explicitSlug) return explicitSlug;
  if (file.endsWith("imageWorkflow.ts") || file.includes("/domains/image/")) return inferImageWorkflowSkill(text);
  if (file.endsWith("listing.ts") || file.includes("/domains/listing/")) return inferListingSkill(text);
  if (file.includes("/domains/ops/") || file.endsWith("opsProductPlan.ts")) {
    if (hasAny(text, ["库存", "补货", "inventory", "stock"])) return "ops.inventory.analysis";
    if (hasAny(text, ["搜索词", "关键词", "search term"])) return "ops.searchterm.advice";
    if (hasAny(text, ["竞品", "competitor"])) return "ops.competitor.analysis";
    return "ops.profit.analysis";
  }
  if (file.endsWith("keywordAi.ts") || file.includes("keyword")) return inferKeywordSkill(text);
  if (file.includes("/routers/ad") || file.includes("/domains/ads/") || file.endsWith("adStructure.ts")) return inferAdSkill(file, text);
  if (file.endsWith("offSocial.ts")) return "off.social.content";
  if (file.endsWith("offOutreach.ts")) return "off.outreach.email";
  if (file.endsWith("offInfluencer.ts")) return "off.influencer.match";
  if (file.endsWith("offContent.ts")) return "off.content.calendar";
  if (file.endsWith("offCampaign.ts") || file.endsWith("offAnalytics.ts")) return "off.campaign.analysis";
  if (file.includes("/routers/off")) return "offsite.summary";
  if (file.endsWith("videoScript.ts")) {
    if (hasAny(text, ["分镜", "shots", "镜头"])) return "video.shot.detail";
    if (hasAny(text, ["脚本", "timeline", "editingNotes"])) return "video.edit.script";
    if (hasAny(text, ["竞品视频", "video.competitor"])) return "video.competitor.analysis";
    return "video.section.plan";
  }
  if (file.includes("/routers/dev") || file.includes("/domains/product_development/")) return "dev.analysis.product";
  if (file.endsWith("kbImages.ts") || file.endsWith("imageAiAnalyzer.ts") || hasAny(text, ["OCR", "图片", "image_url"])) return "analysis.image.recognition";
  if (file.endsWith("kbListings.ts")) return "listing.competitor.analyze";
  if (file.endsWith("kbVideos.ts")) return "video.competitor.analysis";
  if (file.endsWith("kbIntel.ts")) return "analysis.competitor.multi";
  if (file.endsWith("kbProducts.ts") || file.endsWith("kbSkills.ts") || file.endsWith("kbBot.ts")) return "analysis.competitor.single";
  if (file.endsWith("afterSales.ts")) {
    if (hasAny(text, ["退货", "return"])) return "aftersales.return.diagnosis";
    if (hasAny(text, ["邮件", "email", "reply"])) return "aftersales.email.reply";
    if (hasAny(text, ["评论", "review"])) return "aftersales.review.analysis";
    return "aftersales.service.briefing";
  }
  if (file.endsWith("buyerQuestions.ts")) return "analysis.rufus.attribute";
  if (file.endsWith("conversionAiScorer.ts") || file.endsWith("scoring.ts")) return "listing.scoring.overall";
  if (file.endsWith("customerProfile.ts")) return "analysis.review.kano";
  if (file.endsWith("reviewAggregation.ts")) return "analysis.review.extract";
  if (file.endsWith("analysis.ts") || file.endsWith("projectFile.ts") || file.endsWith("taskManagement.ts")) return "analysis.comparison.summary";
  if (file.endsWith("operations.ts") || file.endsWith("productOps.ts") || file.endsWith("dashboardUpgrade.ts") || file.endsWith("replenishmentEngine.ts") || file.endsWith("scheduledHandlers.ts")) {
    if (hasAny(text, ["库存", "补货", "inventory", "stock"])) return "ops.inventory.analysis";
    if (hasAny(text, ["利润", "profit", "ROI", "毛利"])) return "ops.profit.analysis";
    if (hasAny(text, ["搜索词", "关键词", "search term"])) return "ops.searchterm.advice";
    if (hasAny(text, ["竞品", "competitor"])) return "ops.competitor.analysis";
    return "ops.profit.analysis";
  }
  if (file.endsWith("intelAutoCollect.ts")) return "analysis.competitor.multi";
  return null;
}

function getProp(objectNode, name, sourceFile) {
  if (!ts.isObjectLiteralExpression(objectNode)) return undefined;
  return objectNode.properties.find((prop) => {
    if (!ts.isPropertyAssignment(prop)) return false;
    return prop.name?.getText(sourceFile).replace(/^["']|["']$/g, "") === name;
  })?.initializer;
}

function literalText(node, sourceFile) {
  if (!node) return "";
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return node.getText(sourceFile);
}

function findCallsites(file) {
  const abs = resolve(ROOT, file);
  const sourceText = readFileSync(abs, "utf8");
  const sf = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const callsites = [];

  function visit(node) {
    if (ts.isCallExpression(node) && ["invokeLLM", "invokeBusinessSkill"].includes(node.expression.getText(sf))) {
      const arg = node.arguments[0];
      let systemPrompt = "";
      let explicitSlug = "";
      if (arg && ts.isObjectLiteralExpression(arg)) {
        explicitSlug = literalText(getProp(arg, "skillSlug", sf), sf);
        const messages = getProp(arg, "messages", sf);
        if (messages && ts.isArrayLiteralExpression(messages)) {
          const systemMsg = messages.elements.find((entry) => {
            if (!ts.isObjectLiteralExpression(entry)) return false;
            return literalText(getProp(entry, "role", sf), sf) === "system";
          });
          if (systemMsg && ts.isObjectLiteralExpression(systemMsg)) {
            systemPrompt = literalText(getProp(systemMsg, "content", sf), sf);
          }
        }
      }
      const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      const textAround = sourceText.slice(Math.max(0, node.getStart(sf) - 1500), Math.min(sourceText.length, node.end + 1500));
      const slug = inferSkill(file, `${systemPrompt}\n${textAround}`, explicitSlug);
      callsites.push({
        file,
        line: pos.line + 1,
        slug,
        systemPrompt,
        dynamicPrompt: !systemPrompt || systemPrompt.startsWith("`") || systemPrompt.includes("${"),
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return callsites;
}

function parseManifest(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL 未设置，无法读取 emperor_skills 做 prompt 对比。");
  process.exit(1);
}

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.query("SELECT slug,name,manifest FROM emperor_skills");
await conn.end();

const skills = new Map();
for (const row of rows) {
  const manifest = parseManifest(row.manifest);
  skills.set(row.slug, {
    name: row.name,
    systemPrompt: manifest?.implementation?.systemPrompt || "",
  });
}

const callsites = BUSINESS_GLOBS.flatMap(findCallsites).filter((site) => site.slug);
const missing = [];
const empty = [];
const mismatches = [];
const ok = [];

for (const site of callsites) {
  const skill = skills.get(site.slug);
  if (!skill) {
    missing.push(site);
    continue;
  }
  if (!skill.systemPrompt.trim()) {
    empty.push(site);
    continue;
  }
  const canCompare = site.systemPrompt && !site.dynamicPrompt;
  const normalizedMatch = canCompare && normalize(site.systemPrompt) === normalize(skill.systemPrompt);
  const record = {
    ...site,
    skillName: skill.name,
    legacyHash: canCompare ? hash(site.systemPrompt) : "dynamic",
    skillHash: hash(skill.systemPrompt),
    legacyLength: canCompare ? site.systemPrompt.length : 0,
    skillLength: skill.systemPrompt.length,
  };
  if (canCompare && !normalizedMatch) mismatches.push(record);
  else ok.push(record);
}

console.log("Emperor Prompt Consistency Audit");
console.log(`Callsites: ${callsites.length}`);
console.log(`OK/dynamic: ${ok.length}`);
console.log(`Missing skills: ${missing.length}`);
console.log(`Empty systemPrompt: ${empty.length}`);
console.log(`Mismatched literal prompts: ${mismatches.length}`);

function printSection(title, records, limit = 40) {
  if (!records.length) return;
  console.log(`\n${title}`);
  for (const item of records.slice(0, limit)) {
    console.log(`- ${item.slug || "(unmapped)"} ${relative(ROOT, item.file)}:${item.line}`);
    if (item.legacyHash) console.log(`  legacy=${item.legacyHash}(${item.legacyLength}) skill=${item.skillHash}(${item.skillLength})`);
  }
  if (records.length > limit) console.log(`... ${records.length - limit} more`);
}

printSection("Missing skills", missing);
printSection("Empty systemPrompt", empty);
printSection("Mismatched literal prompts", mismatches);

if (missing.length || empty.length || (STRICT && mismatches.length)) {
  process.exit(2);
}
