import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { buyerQuestions } from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { invokeLLM } from "../_core/llm";

// ─── Buyer Questions Router ─────────────────────────────────────────────────
export const buyerQuestionsRouter = router({
  // List all buyer questions for a project
  list: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      source: z.enum(["ad_search_term", "sp_prompts", "qa_section", "competitor_review", "manual"]).optional(),
      status: z.enum(["active", "dismissed", "covered"]).optional(),
    }))
    .query(async ({ input }) => {
      const conditions = [eq(buyerQuestions.projectId, input.projectId)];
      if (input.source) conditions.push(eq(buyerQuestions.source, input.source));
      if (input.status) conditions.push(eq(buyerQuestions.status, input.status));

      const db = await getDb();
      const results = await db!
        .select()
        .from(buyerQuestions)
        .where(and(...conditions))
        .orderBy(desc(buyerQuestions.frequency), desc(buyerQuestions.createdAt));

      return results;
    }),

  // Add a single question manually
  add: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      question: z.string().min(1),
      questionCn: z.string().optional(),
      source: z.enum(["ad_search_term", "sp_prompts", "qa_section", "competitor_review", "manual"]).default("manual"),
      category: z.string().optional(),
      priority: z.enum(["high", "medium", "low"]).default("medium"),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      const [result] = await db!.insert(buyerQuestions).values({
        projectId: input.projectId,
        userId: ctx.user.id,
        question: input.question,
        questionCn: input.questionCn || null,
        source: input.source,
        category: input.category || null,
        priority: input.priority,
      });
      return { id: result.insertId };
    }),

  // Batch add questions
  batchAdd: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      questions: z.array(z.object({
        question: z.string(),
        questionCn: z.string().optional(),
        source: z.enum(["ad_search_term", "sp_prompts", "qa_section", "competitor_review", "manual"]),
        category: z.string().optional(),
        frequency: z.number().optional(),
        priority: z.enum(["high", "medium", "low"]).optional(),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.questions.length === 0) return { count: 0 };

      const values = input.questions.map(q => ({
        projectId: input.projectId,
        userId: ctx.user.id,
        question: q.question,
        questionCn: q.questionCn || null,
        source: q.source,
        category: q.category || null,
        frequency: q.frequency || 1,
        priority: q.priority || "medium" as const,
      }));

      const db = await getDb();
      await db!.insert(buyerQuestions).values(values);
      return { count: values.length };
    }),

  // Update a question
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      question: z.string().optional(),
      questionCn: z.string().optional(),
      category: z.string().optional(),
      priority: z.enum(["high", "medium", "low"]).optional(),
      status: z.enum(["active", "dismissed", "covered"]).optional(),
      coveredInBullet: z.number().optional(),
      coveredInDescription: z.number().optional(),
      coveredInQA: z.number().optional(),
      suggestedAnswer: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...updates } = input;
      const cleanUpdates: Record<string, any> = {};
      for (const [key, val] of Object.entries(updates)) {
        if (val !== undefined) cleanUpdates[key] = val;
      }
      if (Object.keys(cleanUpdates).length === 0) return { success: true };

      const db = await getDb();
      await db!.update(buyerQuestions)
        .set(cleanUpdates)
        .where(eq(buyerQuestions.id, id));
      return { success: true };
    }),

  // Delete a question
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      await db!.delete(buyerQuestions).where(eq(buyerQuestions.id, input.id));
      return { success: true };
    }),

  // AI: Extract buyer questions from search terms report data
  extractFromSearchTerms: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      searchTerms: z.array(z.string()), // Raw search terms from ad reports
      productContext: z.string().optional(), // Brief product description for context
    }))
    .mutation(async ({ input, ctx }) => {
      const prompt = `你是一位亚马逊广告数据分析专家。请从以下广告搜索词中提取买家的隐含问题和需求。

## 任务
分析这些搜索词，识别出买家在搜索时可能存在的疑问和需求。重点关注：
1. 疑问类搜索词（包含how, what, can, does, is it, for等疑问词的）
2. 比较类搜索词（vs, or, better, best等）
3. 场景类搜索词（for kids, for outdoor, for travel等 → 暗示"这个产品适合XX场景吗？"）
4. 规格类搜索词（size, dimension, weight等 → 暗示"尺寸/重量是多少？"）
5. 兼容性搜索词（fit, compatible, work with等 → 暗示"能和XX一起用吗？"）

${input.productContext ? `## 产品背景\n${input.productContext}\n` : ""}

## 搜索词列表
${input.searchTerms.slice(0, 200).join("\n")}

## 输出格式（JSON数组）
返回提取出的买家问题，每个问题包含：
- question: 英文买家问题（完整句子）
- questionCn: 中文翻译
- category: 分类（functionality/size/material/compatibility/usage_scenario/safety/durability/value）
- frequency: 相关搜索词数量（估算）
- priority: high/medium/low（基于频次和重要性）

只返回JSON数组，不要其他内容。`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "You are an Amazon advertising data analyst. Extract buyer questions from search terms. Return only valid JSON array." },
          { role: "user", content: prompt },
        ],
      });

      const rawContent2 = response.choices[0]?.message?.content;
      const content = typeof rawContent2 === "string" ? rawContent2 : "[]";
      let questions: any[] = [];
      try {
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          questions = JSON.parse(jsonMatch[0]);
        }
      } catch {
        console.error("Failed to parse AI response for buyer questions:", content.slice(0, 200));
        return { extracted: 0, questions: [] };
      }

      // Save to database
      if (questions.length > 0) {
        const values = questions.map((q: any) => ({
          projectId: input.projectId,
          userId: ctx.user.id,
          question: q.question || "",
          questionCn: q.questionCn || null,
          source: "ad_search_term" as const,
          category: q.category || null,
          frequency: q.frequency || 1,
          priority: (q.priority || "medium") as "high" | "medium" | "low",
        }));

        const db2 = await getDb();
        await db2!.insert(buyerQuestions).values(values);
      }

      return { extracted: questions.length, questions };
    }),

  // AI: Check which questions are covered in current listing content
  checkCoverage: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      bulletPoints: z.string().optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      // Get all active questions for this project
      const db = await getDb();
      const activeQuestions = await db!
        .select()
        .from(buyerQuestions)
        .where(and(
          eq(buyerQuestions.projectId, input.projectId),
          eq(buyerQuestions.status, "active")
        ));

      if (activeQuestions.length === 0) return { covered: 0, uncovered: 0, results: [] };

      const prompt = `你是一位亚马逊Listing质量审核专家。请检查以下买家问题是否在当前Listing内容中得到了回答。

## 当前Listing内容
### Bullet Points
${input.bulletPoints || "(空)"}

### Description
${input.description || "(空)"}

## 买家问题列表
${activeQuestions.map((q, i) => `${i + 1}. ${q.question}`).join("\n")}

## 输出格式（JSON数组）
对每个问题返回：
- questionId: 问题序号（从1开始）
- covered: true/false（是否在内容中被回答）
- coveredIn: "bullet"/"description"/"both"/null（在哪里被覆盖）
- notes: 简短说明

只返回JSON数组。`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "You are an Amazon Listing quality auditor. Check question coverage. Return only valid JSON array." },
          { role: "user", content: prompt },
        ],
      });

      const rawContent = response.choices[0]?.message?.content;
      const content = typeof rawContent === "string" ? rawContent : "[]";
      let results: any[] = [];
      try {
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          results = JSON.parse(jsonMatch[0]);
        }
      } catch {
        return { covered: 0, uncovered: activeQuestions.length, results: [] };
      }

      // Update coverage status in DB
      let coveredCount = 0;
      for (const r of results) {
        const idx = (r.questionId || 0) - 1;
        if (idx >= 0 && idx < activeQuestions.length) {
          const q = activeQuestions[idx];
          const updates: Record<string, any> = {};
          if (r.covered) {
            coveredCount++;
            if (r.coveredIn === "bullet" || r.coveredIn === "both") updates.coveredInBullet = 1;
            if (r.coveredIn === "description" || r.coveredIn === "both") updates.coveredInDescription = 1;
            updates.status = "covered";
          }
          if (Object.keys(updates).length > 0) {
            await db!.update(buyerQuestions).set(updates).where(eq(buyerQuestions.id, q.id));
          }
        }
      }

      return {
        covered: coveredCount,
        uncovered: activeQuestions.length - coveredCount,
        results: results.map((r: any, i: number) => ({
          ...r,
          question: activeQuestions[i]?.question || "",
        })),
      };
    }),

  // Get coverage summary stats for a project
  getCoverageStats: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      const all = await db!
        .select({
          total: sql<number>`COUNT(*)`,
          covered: sql<number>`SUM(CASE WHEN status = 'covered' THEN 1 ELSE 0 END)`,
          active: sql<number>`SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)`,
          highPriority: sql<number>`SUM(CASE WHEN priority = 'high' AND status = 'active' THEN 1 ELSE 0 END)`,
        })
        .from(buyerQuestions)
        .where(eq(buyerQuestions.projectId, input.projectId));

      return {
        total: Number(all[0]?.total || 0),
        covered: Number(all[0]?.covered || 0),
        active: Number(all[0]?.active || 0),
        highPriorityUncovered: Number(all[0]?.highPriority || 0),
      };
    }),
});
