import { runSkillViaEmperor } from "../emperorClient";
/**
 * kbBot Router — 知识库AI机器人
 *
 * 功能：对话式检索知识库，AI根据用户问题自动走三层加载流程，
 * 回答中附带引用来源卡片（可展开查看原文、可点击跳转），支持多轮对话和上下文记忆。
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import { getDb } from "../db";
import {
  kbBotConversations,
  kbBotMessages,
} from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import {
  getL1Index,
  getL2Summary,
  getL3Detail,
  smartRoute,
  formatForPrompt,
  logKbCallBatch,
  type KbItemType,
  type L1Item,
  type L2Item,
  type L3Item,
} from "../kbContextEngine";

// ─── Types ───────────────────────────────────────

export interface KbReference {
  id: number;
  type: KbItemType;
  title: string;
  asin: string;
  score: number | null;
  relevanceScore: number;
  excerpt: string;
  category: string;
}

export interface SearchPathStep {
  level: "L1" | "L2" | "L3";
  scannedCount: number;
  matchedCount: number;
  tokensUsed: number;
}

// ─── DB Helpers ──────────────────────────────────

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

async function createConversation(userId: number, title: string) {
  const _d = await db();
  const now = Date.now();
  const [result] = await _d.insert(kbBotConversations).values({
    userId,
    title,
    lastMessageAt: now,
    messageCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  return result.insertId;
}

async function getConversation(id: number, userId: number) {
  const _d = await db();
  const [row] = await _d
    .select()
    .from(kbBotConversations)
    .where(and(eq(kbBotConversations.id, id), eq(kbBotConversations.userId, userId)));
  return row ?? null;
}

async function listConversations(userId: number) {
  const _d = await db();
  return _d
    .select()
    .from(kbBotConversations)
    .where(eq(kbBotConversations.userId, userId))
    .orderBy(desc(kbBotConversations.lastMessageAt));
}

async function deleteConversation(id: number, userId: number) {
  const _d = await db();
  // Delete messages first
  await _d.delete(kbBotMessages).where(eq(kbBotMessages.conversationId, id));
  // Then delete conversation
  await _d
    .delete(kbBotConversations)
    .where(and(eq(kbBotConversations.id, id), eq(kbBotConversations.userId, userId)));
}

async function clearAllConversations(userId: number) {
  const _d = await db();
  // Get all conversation IDs for this user
  const convos = await _d
    .select({ id: kbBotConversations.id })
    .from(kbBotConversations)
    .where(eq(kbBotConversations.userId, userId));
  if (convos.length > 0) {
    for (const c of convos) {
      await _d.delete(kbBotMessages).where(eq(kbBotMessages.conversationId, c.id));
    }
    await _d.delete(kbBotConversations).where(eq(kbBotConversations.userId, userId));
  }
}

async function addMessage(data: {
  conversationId: number;
  role: "user" | "assistant";
  content: string;
  references?: KbReference[];
  searchPath?: SearchPathStep[];
  tokensUsed?: number;
}) {
  const _d = await db();
  const [result] = await _d.insert(kbBotMessages).values({
    conversationId: data.conversationId,
    role: data.role,
    content: data.content,
    references: data.references ? JSON.stringify(data.references) : null,
    searchPath: data.searchPath ? JSON.stringify(data.searchPath) : null,
    tokensUsed: data.tokensUsed ?? null,
    createdAt: Date.now(),
  });
  // Update conversation
  await _d
    .update(kbBotConversations)
    .set({
      lastMessageAt: Date.now(),
      messageCount: data.role === "user" ? undefined : undefined, // handled below
      updatedAt: Date.now(),
    })
    .where(eq(kbBotConversations.id, data.conversationId));
  return result.insertId;
}

async function getMessages(conversationId: number) {
  const _d = await db();
  return _d
    .select()
    .from(kbBotMessages)
    .where(eq(kbBotMessages.conversationId, conversationId))
    .orderBy(kbBotMessages.createdAt);
}

// ─── AI Search Logic ─────────────────────────────

/**
 * Core AI-powered knowledge retrieval:
 * 1. smartRoute to determine which KB types to search
 * 2. L1 index scan for quick matching
 * 3. AI selects relevant items from L1 results
 * 4. L2 summary load for confirmed items
 * 5. AI selects top items for L3 detail load
 * 6. Generate final answer with references
 */
async function performKbSearch(
  query: string,
  userId: number,
  conversationHistory: Array<{ role: string; content: string }>
): Promise<{
  content: string;
  references: KbReference[];
  searchPath: SearchPathStep[];
  tokensUsed: number;
}> {
  const searchPath: SearchPathStep[] = [];
  let totalTokensUsed = 0;

  // Step 1: Smart route to determine search strategy
  const route = smartRoute(query);

  // Step 2: L1 Index scan
  const l1Items = await getL1Index({
    types: route.suggestedTypes,
    keyword: extractKeyword(query),
    scope: "shared",
    userId,
  });

  searchPath.push({
    level: "L1",
    scannedCount: l1Items.length,
    matchedCount: l1Items.length,
    tokensUsed: l1Items.length * 50,
  });
  totalTokensUsed += l1Items.length * 50;

  if (l1Items.length === 0) {
    return {
      content: "抱歉，知识库中暂未找到与您问题相关的内容。您可以尝试换个关键词，或者先在知识库中录入相关案例。",
      references: [],
      searchPath,
      tokensUsed: totalTokensUsed,
    };
  }

  // Step 3: AI selects relevant items from L1 (if too many, use AI to filter)
  let selectedL1Ids: number[] = [];
  let selectedL1Types: KbItemType[] = [];

  if (l1Items.length <= 10) {
    // Few enough to load all as L2
    selectedL1Ids = l1Items.map((i) => i.id);
    selectedL1Types = l1Items.map((i) => i.type);
  } else {
    // Use AI to select most relevant from L1
    const l1Prompt = formatForPrompt(l1Items, "L1");
      // [Emperor] 优先调用 Emperor Skill: analysis.competitor.single

    try {

      const _emperorRes = await runSkillViaEmperor("analysis.competitor.single", { context: JSON.stringify({}).slice(0, 3000) });

      if (_emperorRes.success && _emperorRes.output) {

        // Emperor 成功，结果已记录

      }

    } catch (_e) { console.warn("[Emperor] kbBot.ts fallback:", _e); }

    const selectionResponse = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `你是一位知识库检索助手。用户正在查询亚马逊运营相关知识。
请从以下知识库索引中选出最相关的条目（最多10条）。

当前知识库索引：
${l1Prompt}`,
        },
        {
          role: "user",
          content: query,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "kb_selection",
          strict: true,
          schema: {
            type: "object",
            properties: {
              selectedIndices: {
                type: "array",
                items: { type: "integer" },
                description: "选中条目的序号（从1开始），最多10条",
              },
              reasoning: {
                type: "string",
                description: "选择理由的简要说明",
              },
            },
            required: ["selectedIndices", "reasoning"],
            additionalProperties: false,
          },
        },
      },
    });

    try {
      const selectionContent = typeof selectionResponse.choices[0]?.message?.content === "string"
        ? selectionResponse.choices[0].message.content
        : "";
      const selection = JSON.parse(selectionContent);
      const indices = (selection.selectedIndices || []) as number[];
      for (const idx of indices) {
        if (idx >= 1 && idx <= l1Items.length) {
          selectedL1Ids.push(l1Items[idx - 1].id);
          selectedL1Types.push(l1Items[idx - 1].type);
        }
      }
    } catch {
      // Fallback: take first 10
      selectedL1Ids = l1Items.slice(0, 10).map((i) => i.id);
      selectedL1Types = l1Items.slice(0, 10).map((i) => i.type);
    }

    totalTokensUsed += selectionResponse.usage?.total_tokens ?? 500;
  }

  if (selectedL1Ids.length === 0) {
    return {
      content: "抱歉，知识库中暂未找到与您问题高度相关的内容。您可以尝试更具体的描述。",
      references: [],
      searchPath,
      tokensUsed: totalTokensUsed,
    };
  }

  // Step 4: L2 Summary load
  const l2Items = await getL2Summary(selectedL1Ids, selectedL1Types);
  searchPath.push({
    level: "L2",
    scannedCount: selectedL1Ids.length,
    matchedCount: l2Items.length,
    tokensUsed: l2Items.length * 200,
  });
  totalTokensUsed += l2Items.length * 200;

  // Step 5: Select top items for L3 detail (max 5)
  let l3Ids: number[] = [];
  let l3Types: KbItemType[] = [];

  if (l2Items.length <= 5) {
    l3Ids = l2Items.map((i) => i.id);
    l3Types = l2Items.map((i) => i.type);
  } else {
    // Use AI to pick top 5 from L2 summaries
    const l2Prompt = formatForPrompt(l2Items, "L2");
      // [Emperor] 优先调用 Emperor Skill: analysis.competitor.single

    try {

      const _emperorRes = await runSkillViaEmperor("analysis.competitor.single", { context: JSON.stringify({}).slice(0, 3000) });

      if (_emperorRes.success && _emperorRes.output) {

        // Emperor 成功，结果已记录

      }

    } catch (_e) { console.warn("[Emperor] kbBot.ts fallback:", _e); }

    const l2SelectionResponse = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `你是一位知识库检索助手。请从以下摘要中选出与用户问题最相关的条目（最多5条）。

知识库摘要：
${l2Prompt}`,
        },
        {
          role: "user",
          content: query,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "kb_l2_selection",
          strict: true,
          schema: {
            type: "object",
            properties: {
              selectedIndices: {
                type: "array",
                items: { type: "integer" },
                description: "选中条目的序号（从1开始），最多5条",
              },
            },
            required: ["selectedIndices"],
            additionalProperties: false,
          },
        },
      },
    });

    try {
      const l2Content = typeof l2SelectionResponse.choices[0]?.message?.content === "string"
        ? l2SelectionResponse.choices[0].message.content
        : "";
      const l2Selection = JSON.parse(l2Content);
      const indices = (l2Selection.selectedIndices || []) as number[];
      for (const idx of indices) {
        if (idx >= 1 && idx <= l2Items.length) {
          l3Ids.push(l2Items[idx - 1].id);
          l3Types.push(l2Items[idx - 1].type);
        }
      }
    } catch {
      l3Ids = l2Items.slice(0, 5).map((i) => i.id);
      l3Types = l2Items.slice(0, 5).map((i) => i.type);
    }

    totalTokensUsed += l2SelectionResponse.usage?.total_tokens ?? 500;
  }

  // Step 6: L3 Detail load
  const l3Items = l3Ids.length > 0 ? await getL3Detail(l3Ids, l3Types) : [];
  searchPath.push({
    level: "L3",
    scannedCount: l3Ids.length,
    matchedCount: l3Items.length,
    tokensUsed: l3Items.length * 1000,
  });
  totalTokensUsed += l3Items.length * 1000;

  // Step 7: Generate final answer with context
  const l3Prompt = l3Items.length > 0 ? formatForPrompt(l3Items, "L3") : formatForPrompt(l2Items, "L2");
  const contextLevel = l3Items.length > 0 ? "L3" : "L2";

  // Build conversation context (last 6 messages for context memory)
  const recentHistory = conversationHistory.slice(-6);
  const historyMessages = recentHistory.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

      // [Emperor] 优先调用 Emperor Skill: analysis.competitor.single

  try {

    const _emperorRes = await runSkillViaEmperor("analysis.competitor.single", { context: JSON.stringify({}).slice(0, 3000) });

    if (_emperorRes.success && _emperorRes.output) {

      // Emperor 成功，结果已记录

    }

  } catch (_e) { console.warn("[Emperor] kbBot.ts fallback:", _e); }

  const answerResponse = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `你是一位专业的亚马逊运营知识库助手。你的任务是根据知识库中的内容，为用户提供准确、有用的回答。

回答规则：
1. 基于知识库内容回答，不要编造信息
2. 如果知识库中有多个相关案例，进行对比分析
3. 回答要有结构性，使用Markdown格式
4. 在回答中引用具体的知识库条目时，使用 [引用X] 格式标注（X为条目序号）
5. 如果知识库内容不足以完全回答问题，诚实说明并给出建议
6. 回答要实用，给出可操作的建议

当前知识库相关内容（${contextLevel}层详情）：
${l3Prompt}`,
      },
      ...historyMessages,
      {
        role: "user",
        content: query,
      },
    ],
  });

  const answerContent = typeof answerResponse.choices[0]?.message?.content === "string"
    ? answerResponse.choices[0].message.content
    : "抱歉，生成回答时出现了问题。";
  totalTokensUsed += answerResponse.usage?.total_tokens ?? 1000;

  // Build references from the items used
  const sourceItems = l3Items.length > 0 ? l3Items : l2Items;
  const references: KbReference[] = sourceItems.map((item, idx) => ({
    id: item.id,
    type: item.type,
    title: item.title || "未命名",
    asin: item.asin || "",
    score: item.score,
    relevanceScore: Math.max(0.5, 1 - idx * 0.1), // Approximate relevance by order
    excerpt: (item as L2Item).summary || (item as L2Item).keyPoints || "",
    category: item.category || "",
  }));

  // Log KB calls
  try {
    await logKbCallBatch(
      sourceItems.map((item) => ({
        userId,
        callerModule: "kbBot",
        callerAction: "chat",
        kbItemId: item.id,
        kbItemType: item.type,
        loadLevel: (l3Items.length > 0 ? "L3" : "L2") as "L1" | "L2" | "L3",
      }))
    );
  } catch (e) {
    console.error("Failed to log KB calls:", e);
  }

  return {
    content: answerContent,
    references,
    searchPath,
    tokensUsed: totalTokensUsed,
  };
}

/**
 * Extract main keyword from user query for DB search
 */
function extractKeyword(query: string): string | undefined {
  // Remove common question words and extract meaningful keywords
  const cleaned = query
    .replace(/帮我|请|找|一些|有没有|怎么|如何|什么|哪些|关于|的|吗|呢|吧|了|啊/g, "")
    .trim();
  // If the cleaned query is too short, return undefined to search all
  if (cleaned.length < 2) return undefined;
  // Return the first meaningful segment (max 20 chars)
  return cleaned.slice(0, 20);
}

/**
 * Generate a conversation title from the first user message
 */
async function generateTitle(message: string): Promise<string> {
  // Simple: take first 30 chars of the message
  const title = message.slice(0, 30).replace(/\n/g, " ");
  return title + (message.length > 30 ? "..." : "");
}

// ─── Router ──────────────────────────────────────

export const kbBotRouter = router({
  /**
   * Send a message and get AI response
   * If no conversationId provided, creates a new conversation
   */
  chat: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().optional(),
        message: z.string().min(1).max(5000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      let conversationId = input.conversationId;

      // Create new conversation if needed
      if (!conversationId) {
        const title = await generateTitle(input.message);
        conversationId = Number(
          await createConversation(userId, title)
        );
      } else {
        // Verify ownership
        const convo = await getConversation(conversationId, userId);
        if (!convo) {
          throw new Error("对话不存在或无权访问");
        }
      }

      // Save user message
      await addMessage({
        conversationId,
        role: "user",
        content: input.message,
      });

      // Get conversation history for context
      const allMessages = await getMessages(conversationId);
      const conversationHistory = allMessages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content }));

      // Perform AI-powered KB search
      const result = await performKbSearch(
        input.message,
        userId,
        conversationHistory.slice(0, -1) // Exclude the just-added user message from history
      );

      // Save assistant message
      const messageId = await addMessage({
        conversationId,
        role: "assistant",
        content: result.content,
        references: result.references,
        searchPath: result.searchPath,
        tokensUsed: result.tokensUsed,
      });

      // Update conversation message count
      const _d = await db();
      const msgCount = allMessages.length + 1; // +1 for the assistant message
      await _d
        .update(kbBotConversations)
        .set({ messageCount: msgCount, updatedAt: Date.now() })
        .where(eq(kbBotConversations.id, conversationId));

      return {
        conversationId,
        messageId: Number(messageId),
        content: result.content,
        references: result.references,
        searchPath: result.searchPath,
        tokensUsed: result.tokensUsed,
      };
    }),

  /**
   * List all conversations for the current user
   */
  listConversations: protectedProcedure.query(async ({ ctx }) => {
    return listConversations(ctx.user.id);
  }),

  /**
   * Get message history for a conversation
   */
  getHistory: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ ctx, input }) => {
      // Verify ownership
      const convo = await getConversation(input.conversationId, ctx.user.id);
      if (!convo) {
        throw new Error("对话不存在或无权访问");
      }

      const messages = await getMessages(input.conversationId);
      return {
        conversation: convo,
        messages: messages.map((m) => ({
          ...m,
          references: m.references ? (typeof m.references === "string" ? JSON.parse(m.references) : m.references) : [],
          searchPath: m.searchPath ? (typeof m.searchPath === "string" ? JSON.parse(m.searchPath) : m.searchPath) : [],
        })),
      };
    }),

  /**
   * Delete a conversation and all its messages
   */
  deleteConversation: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await deleteConversation(input.conversationId, ctx.user.id);
      return { success: true };
    }),

  /**
   * Clear all conversations for the current user
   */
  clearAll: protectedProcedure.mutation(async ({ ctx }) => {
    await clearAllConversations(ctx.user.id);
    return { success: true };
  }),

  /**
   * Update conversation title
   */
  updateTitle: protectedProcedure
    .input(z.object({ conversationId: z.number(), title: z.string().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const convo = await getConversation(input.conversationId, ctx.user.id);
      if (!convo) {
        throw new Error("对话不存在或无权访问");
      }
      const _d = await db();
      await _d
        .update(kbBotConversations)
        .set({ title: input.title, updatedAt: Date.now() })
        .where(eq(kbBotConversations.id, input.conversationId));
      return { success: true };
    }),
});
