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
      !entry.includes("/server/services/emperorInvocationGateway.ts") &&
      !entry.includes("/server/domains/ai_os/services/businessSkillGateway.ts")
    );
  return line?.match(/\/server\/[^):]+/)?.[0] || "";
}

function hasAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
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

function inferKbSkill(file: string, text: string): string {
  if (file.endsWith("kbImages.ts") || file.endsWith("imageAiAnalyzer.ts") || hasAny(text, ["OCR", "图片", "image_url"])) {
    return "analysis.image.recognition";
  }
  if (file.endsWith("kbListings.ts")) return "listing.competitor.analyze";
  if (file.endsWith("kbIntel.ts")) return "analysis.competitor.multi";
  if (file.endsWith("kbSkills.ts")) return "analysis.competitor.single";
  return "analysis.competitor.single";
}

function inferSkillSlug(params: InvokeParams, callerFile: string, text: string): InferredSkill | null {
  const explicit = params.emperorSkill?.slug || params.skillSlug;
  if (explicit) return { slug: explicit, source: "explicit" };

  const source = callerFile.replace(/^.*\/server\//, "server/");
  if (!source) return null;

  if (callerFile.endsWith("listing.ts") || callerFile.includes("/domains/listing/")) {
    return { slug: inferListingSkill(text), source };
  }
  if (callerFile.includes("/domains/ops/") || callerFile.endsWith("opsProductPlan.ts")) {
    return { slug: inferOpsSkill(callerFile, text), source };
  }
  if (callerFile.endsWith("keywordAi.ts") || callerFile.includes("keyword")) {
    return { slug: inferKeywordSkill(text), source };
  }
  if (callerFile.includes("/routers/ad") || callerFile.includes("/domains/ads/") || callerFile.endsWith("adStructure.ts")) {
    return { slug: inferAdSkill(callerFile, text), source };
  }
  if (callerFile.includes("/routers/kb") || callerFile.endsWith("imageAiAnalyzer.ts")) return { slug: inferKbSkill(callerFile, text), source };
  if (callerFile.endsWith("buyerQuestions.ts")) return { slug: "analysis.rufus.attribute", source };
  if (callerFile.endsWith("conversionAiScorer.ts") || callerFile.endsWith("scoring.ts")) return { slug: "listing.scoring.overall", source };
  if (callerFile.endsWith("customerProfile.ts")) return { slug: "analysis.review.kano", source };
  if (callerFile.endsWith("reviewAggregation.ts")) return { slug: "analysis.review.extract", source };
  if (callerFile.endsWith("analysis.ts") || callerFile.endsWith("projectFile.ts") || callerFile.endsWith("taskManagement.ts")) {
    return { slug: "analysis.comparison.summary", source };
  }
  if (
    callerFile.includes("/domains/ops/") ||
    callerFile.endsWith("operations.ts") ||
    callerFile.endsWith("productOps.ts") ||
    callerFile.endsWith("dashboardUpgrade.ts") ||
    callerFile.endsWith("replenishmentEngine.ts") ||
    callerFile.endsWith("scheduledHandlers.ts")
  ) {
    return { slug: inferOpsSkill(callerFile, text), source };
  }

  return null;
}

function toInvokeResult(
  content: string,
  runId: string,
  modelSlug: string,
  usage: { inputTokens: number; outputTokens: number },
): InvokeResult {
  return {
    id: runId,
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
    workspaceId: params.emperorSkill?.workspaceId ?? null,
    context: params.emperorSkill?.context ?? legacyContext,
    emphasis: params.emperorSkill?.emphasis,
    variables,
    attachments: collectAttachments(params.messages),
    legacySystemPrompt,
    migrationSource: params.emperorSkill?.migrationSource || inferred.source,
    executionPreset: params.emperorSkill?.executionPreset,
    validate: (content) => content,
  });

  return toInvokeResult(result.content, result.runId, result.modelSlug, {
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  });
}
