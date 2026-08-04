import type { InvokeParams, InvokeResult, Message, MessageContent } from "../_core/llm";
import { runEmperorSkill } from "./emperorSkillRunner";

type InferredSkill = {
  slug: string;
  source: string;
};

function isTextPart(part: MessageContent): part is { type: "text"; text: string } {
  return typeof part !== "string" && part.type === "text";
}

function stringifyContent(content: Message["content"]): string {
  const parts = Array.isArray(content) ? content : [content];
  return parts.map((part) => {
    if (typeof part === "string") return part;
    if (part.type === "text") return part.text;
    if (part.type === "image_url") return `[image_url:${part.image_url.url}]`;
    if (part.type === "file_url") return `[file_url:${part.file_url.url}]`;
    return JSON.stringify(part);
  }).join("\n");
}

function collectAttachments(messages: Message[]): MessageContent[] {
  const attachments: MessageContent[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    const parts = Array.isArray(message.content) ? message.content : [message.content];
    for (const part of parts) {
      if (typeof part !== "string" && !isTextPart(part)) attachments.push(part);
    }
  }
  return attachments;
}

function getLegacySystemPrompt(messages: Message[]): string {
  return messages
    .filter((message) => message.role === "system")
    .map((message) => stringifyContent(message.content))
    .join("\n\n")
    .trim();
}

function buildContextFromMessages(messages: Message[]): string {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => `${message.role.toUpperCase()}:\n${stringifyContent(message.content)}`)
    .join("\n\n")
    .trim();
}

function getCallerFileFromStack(): string {
  const stack = new Error().stack || "";
  const line = stack
    .split("\n")
    .find((entry) =>
      entry.includes("/server/") &&
      !entry.includes("/server/_core/llm.ts") &&
      !entry.includes("/server/services/emperorInvocationGateway.ts")
    );
  return line?.match(/\/server\/[^):]+/)?.[0] || "";
}

function hasAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

function inferImageWorkflowSkill(text: string): string {
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

function inferListingSkill(text: string): string {
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

function inferKeywordSkill(text: string): string {
  if (hasAny(text, ["root", "词根"])) return "keyword.root.classify";
  if (hasAny(text, ["traffic", "流量", "competition", "竞争"])) return "keyword.traffic.classify";
  if (hasAny(text, ["scene", "场景", "COSMO"])) return "keyword.scene.tag";
  if (hasAny(text, ["filter", "过滤", "相关性"])) return "keyword.semantic.filter";
  if (hasAny(text, ["listing", "标题", "五点", "Search Terms"])) return "keyword.listing.layout";
  return "keyword.strategy.matrix";
}

function inferAdSkill(file: string, text: string): string {
  if (file.endsWith("adStructure.ts") || hasAny(text, ["广告结构", "campaigns", "adGroups"])) return "ad.structure.generate";
  if (hasAny(text, ["预算", "budget"])) return "ad.budget.allocation";
  if (hasAny(text, ["否定", "negative"])) return "ad.negative.generate";
  if (hasAny(text, ["分时", "dayparting", "时段"])) return "ad.dayparting.strategy";
  if (hasAny(text, ["搜索词", "search term"])) return "ad.searchterm.advice";
  return "ad.diagnosis";
}

function inferOpsSkill(file: string, text: string): string {
  if (file.includes("replenishment") || hasAny(text, ["库存", "补货", "inventory", "stock"])) return "ops.inventory.analysis";
  if (hasAny(text, ["利润", "profit", "ROI", "毛利"])) return "ops.profit.analysis";
  if (hasAny(text, ["搜索词", "关键词", "search term"])) return "ops.searchterm.advice";
  if (hasAny(text, ["竞品", "competitor"])) return "ops.competitor.analysis";
  return "ops.profit.analysis";
}

function inferOffsiteSkill(file: string): string {
  if (file.endsWith("offSocial.ts")) return "off.social.content";
  if (file.endsWith("offOutreach.ts")) return "off.outreach.email";
  if (file.endsWith("offInfluencer.ts")) return "off.influencer.match";
  if (file.endsWith("offContent.ts")) return "off.content.calendar";
  if (file.endsWith("offCampaign.ts") || file.endsWith("offAnalytics.ts")) return "off.campaign.analysis";
  return "offsite.summary";
}

function inferVideoSkill(text: string): string {
  if (hasAny(text, ["分镜", "shots", "镜头"])) return "video.shot.detail";
  if (hasAny(text, ["脚本", "timeline", "editingNotes"])) return "video.edit.script";
  if (hasAny(text, ["竞品视频", "video.competitor"])) return "video.competitor.analysis";
  return "video.section.plan";
}

function inferDevSkill(): string {
  return "dev.analysis.product";
}

function inferKbSkill(file: string, text: string): string {
  if (file.endsWith("kbImages.ts") || file.endsWith("imageAiAnalyzer.ts") || hasAny(text, ["OCR", "图片", "image_url"])) {
    return "analysis.image.recognition";
  }
  if (file.endsWith("kbListings.ts")) return "listing.competitor.analyze";
  if (file.endsWith("kbVideos.ts")) return "video.competitor.analysis";
  if (file.endsWith("kbIntel.ts")) return "analysis.competitor.multi";
  if (file.endsWith("kbSkills.ts")) return "analysis.competitor.single";
  return "analysis.competitor.single";
}

function inferSkillSlug(params: InvokeParams, callerFile: string, text: string): InferredSkill | null {
  const explicit = params.emperorSkill?.slug || params.skillSlug;
  if (explicit) return { slug: explicit, source: "explicit" };

  const source = callerFile.replace(/^.*\/server\//, "server/");
  if (!source) return null;

  if (callerFile.endsWith("imageWorkflow.ts") || callerFile.includes("/domains/image/")) {
    return { slug: inferImageWorkflowSkill(text), source };
  }
  if (callerFile.endsWith("listing.ts")) return { slug: inferListingSkill(text), source };
  if (callerFile.endsWith("keywordAi.ts")) return { slug: inferKeywordSkill(text), source };
  if (callerFile.includes("/routers/ad") || callerFile.endsWith("adStructure.ts")) return { slug: inferAdSkill(callerFile, text), source };
  if (callerFile.includes("/routers/off")) return { slug: inferOffsiteSkill(callerFile), source };
  if (callerFile.endsWith("videoScript.ts")) return { slug: inferVideoSkill(text), source };
  if (callerFile.includes("/routers/dev")) return { slug: inferDevSkill(), source };
  if (callerFile.includes("/routers/kb") || callerFile.endsWith("imageAiAnalyzer.ts")) return { slug: inferKbSkill(callerFile, text), source };
  if (callerFile.endsWith("afterSales.ts")) {
    if (hasAny(text, ["退货", "return"])) return { slug: "aftersales.return.diagnosis", source };
    if (hasAny(text, ["邮件", "email", "reply"])) return { slug: "aftersales.email.reply", source };
    if (hasAny(text, ["评论", "review"])) return { slug: "aftersales.review.analysis", source };
    return { slug: "aftersales.service.briefing", source };
  }
  if (callerFile.endsWith("buyerQuestions.ts")) return { slug: "analysis.rufus.attribute", source };
  if (callerFile.endsWith("conversionAiScorer.ts") || callerFile.endsWith("scoring.ts")) return { slug: "listing.scoring.overall", source };
  if (callerFile.endsWith("customerProfile.ts")) return { slug: "analysis.review.kano", source };
  if (callerFile.endsWith("reviewAggregation.ts")) return { slug: "analysis.review.extract", source };
  if (callerFile.endsWith("analysis.ts") || callerFile.endsWith("projectFile.ts") || callerFile.endsWith("taskManagement.ts")) {
    return { slug: "analysis.comparison.summary", source };
  }
  if (
    callerFile.endsWith("operations.ts") ||
    callerFile.endsWith("productOps.ts") ||
    callerFile.endsWith("dashboardUpgrade.ts") ||
    callerFile.endsWith("replenishmentEngine.ts") ||
    callerFile.endsWith("scheduledHandlers.ts")
  ) {
    return { slug: inferOpsSkill(callerFile, text), source };
  }
  if (callerFile.endsWith("intelAutoCollect.ts")) return { slug: "analysis.competitor.multi", source };

  return null;
}

function toInvokeResult(
  content: string,
  skillSlug: string,
  modelSlug: string,
  usage: { inputTokens: number; outputTokens: number },
): InvokeResult {
  return {
    id: `emperor_${skillSlug}_${Date.now()}`,
    created: Math.floor(Date.now() / 1000),
    model: modelSlug,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: usage.inputTokens,
      completion_tokens: usage.outputTokens,
      total_tokens: usage.inputTokens + usage.outputTokens,
    },
  };
}

export async function invokeViaEmperorSkill(params: InvokeParams): Promise<InvokeResult | null> {
  const callerFile = getCallerFileFromStack();
  const legacySystemPrompt = getLegacySystemPrompt(params.messages);
  const legacyContext = buildContextFromMessages(params.messages);
  const searchableText = `${legacySystemPrompt}\n${legacyContext}`;
  const inferred = inferSkillSlug(params, callerFile, searchableText);
  if (!inferred) return null;

  const variables = {
    responseFormat: params.responseFormat || params.response_format || null,
    maxTokens: params.maxTokens ?? params.max_tokens ?? null,
    legacyMessages: params.messages.map((message) => ({
      role: message.role,
      content: stringifyContent(message.content),
    })),
    originalSystemPrompt: legacySystemPrompt,
    originalUserPrompt: legacyContext,
    ...(params.emperorSkill?.variables || {}),
  };

  const result = await runEmperorSkill<string>({
    skillSlug: inferred.slug,
    userId: params.emperorSkill?.userId ?? params.userId ?? 0,
    context: params.emperorSkill?.context ?? legacyContext,
    emphasis: params.emperorSkill?.emphasis,
    variables,
    attachments: collectAttachments(params.messages),
    legacySystemPrompt,
    migrationSource: inferred.source,
    validate: (content) => content,
  });

  return toInvokeResult(result.content, inferred.slug, result.modelSlug, {
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  });
}
