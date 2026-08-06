import * as shared from "../routerContext";
import { syncGenerationToAgent, syncStepLockToAgent, syncStepUnlockToAgent } from "../listingAgentBridge";

const {
  BULLET_POINTS_PROMPT,
  CHINESE_TRANSLATION_PROMPT,
  DESCRIPTION_PROMPT,
  EVALUATE_BULLET_CHECKLIST_PROMPT,
  EVALUATE_DESCRIPTION_CHECKLIST_PROMPT,
  EVALUATE_QA_CHECKLIST_PROMPT,
  EVALUATE_SEARCH_TERMS_CHECKLIST_PROMPT,
  EVALUATE_TITLE_CHECKLIST_PROMPT,
  EXPAND_KEYWORD_TO_FABE_PROMPT,
  IMAGE_ADVICE_PROMPT,
  IMAGE_ADVICE_TRANSLATION_PROMPT,
  MAX_RETRIES,
  QA_GENERATION_PROMPT,
  SEARCH_TERMS_PROMPT,
  SELLING_POINTS_CORE_PROMPT,
  SINGLE_BULLET_PROMPT,
  TITLE_GENERATION_PROMPT,
  TRPCError,
  buildListingContext,
  buildProductContext,
  checkDataReadiness,
  contextToPromptText,
  db,
  ensureWriteAccess,
  executeListingSkill,
  generateChineseTranslation,
  invokeBusinessSkill,
  loadEnrichedData,
  parseJsonOrThrow,
  protectedProcedure,
  refineBullets,
  refineTitles,
  resolveProjectAccess,
  router,
  runEmperorSkill,
  safeParseJSON,
  saveListingVersion,
  translateImageAdviceToChinese,
  validateBullets,
  validateTitles,
  z,
} = shared;

export const listingEditingProcedures = {


  // Update a listing (for manual edits)
  // Update listing by project ID (for Step components that only know projectId)
  updateByProject: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      field: z.string(),
      value: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);
      let listing = await db.getActiveListingByProject(input.projectId);
      if (!listing) {
        // Auto-create listing if not exists
        listing = await db.createListing({
          projectId: input.projectId,
          title: "",
          bulletPoints: "[]",
          description: "",
          searchTerms: "",
        });
      }
      const data: Record<string, string> = { [input.field]: input.value };
      const result = await db.updateListing(listing.id, data);
      if (result && ctx.user) {
        const fieldMap: Record<string, string> = { title: '标题', itemHighlights: '价值亮点', bulletPoints: '卖点', description: '描述', searchTerms: '搜索词', qaContent: 'QA问答', titleCn: '中文标题', itemHighlightsCn: '中文价值亮点', bulletPointsCn: '中文卖点', descriptionCn: '中文描述', searchTermsCn: '中文搜索词', qaContentCn: '中文QA问答' };
        await saveListingVersion(result, ctx.user.id, "manual_edit", `Step编辑: ${fieldMap[input.field] || input.field}`);
      }
      return result;
    }),


  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().optional(),
      itemHighlights: z.string().optional(),
      bulletPoints: z.string().optional(),
      description: z.string().optional(),
      searchTerms: z.string().optional(),
      qaContent: z.string().optional(),
      titleCn: z.string().optional(),
      itemHighlightsCn: z.string().optional(),
      bulletPointsCn: z.string().optional(),
      descriptionCn: z.string().optional(),
      searchTermsCn: z.string().optional(),
      qaContentCn: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const result = await db.updateListing(id, data);
      // Save version snapshot after manual edit
      if (result && ctx.user) {
        const updatedFields = Object.keys(data).filter(k => (data as any)[k] !== undefined);
        const fieldMap: Record<string, string> = { title: '标题', itemHighlights: '价值亮点', bulletPoints: '卖点', description: '描述', searchTerms: '搜索词', qaContent: 'QA问答', titleCn: '中文标题', itemHighlightsCn: '中文价值亮点', bulletPointsCn: '中文卖点', descriptionCn: '中文描述', searchTermsCn: '中文搜索词', qaContentCn: '中文QA问答' };
        const fieldNames = updatedFields.map(f => fieldMap[f] || f).join('、');
        await saveListingVersion(result, ctx.user.id, "manual_edit", `手动编辑: ${fieldNames}`);
      }
      return result;
    }),


  // ─── Lock State Persistence ───
  updateLockedSteps: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      lockedSteps: z.array(z.number()), // e.g. [1, 2, 3]
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);
      let listing = await db.getActiveListingByProject(input.projectId);
      if (!listing) {
        listing = await db.createListing({
          projectId: input.projectId,
          title: "",
          bulletPoints: "[]",
          description: "",
          searchTerms: "",
        });
      }
      return db.updateListing(listing.id, {
        lockedSteps: JSON.stringify(input.lockedSteps),
      });
      // Sync locked/unlocked steps to Agent DAG (best-effort)
      const prevLocked: number[] = listing.lockedSteps ? JSON.parse(listing.lockedSteps) : [];
      const newLocked = input.lockedSteps;
      // Newly locked steps
      for (const step of newLocked) {
        if (!prevLocked.includes(step)) {
          void syncStepLockToAgent({
            agentRunId: listing.agentRunId,
            stepNumber: step,
            projectId: input.projectId,
            userId: ctx.user.id,
            workspaceId: ctx.workspaceId ?? null,
          });
        }
      }
      // Newly unlocked steps
      for (const step of prevLocked) {
        if (!newLocked.includes(step)) {
          void syncStepUnlockToAgent({
            agentRunId: listing.agentRunId,
            stepNumber: step,
            projectId: input.projectId,
            userId: ctx.user.id,
            workspaceId: ctx.workspaceId ?? null,
          });
        }
      }
    }),


  // ─── Step-by-Step Bullet Generation (卖点核心→逐条生成) ───

  // Step 1: Generate 5 selling point core themes for user to confirm
  generateSellingPointsCores: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      emphasis: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const enrichedData = await loadEnrichedData(input.projectId);
      let context = buildProductContext(project, analyses, enrichedData);
      if (input.emphasis?.trim()) {
        context += `\n\n--- [User Emphasis] ---\n用户希望重点突出：${input.emphasis.trim()}`;
      }

      // Inject buyer questions for coverage requirement
      try {
        const { getDb } = await import("../repository");
        const dbInst = await getDb();
        const { buyerQuestions: bqTable } = await import("../schema");
        const { eq, and } = await import("drizzle-orm");
        const activeQuestions = await dbInst!.select().from(bqTable).where(
          and(eq(bqTable.projectId, input.projectId), eq(bqTable.status, "active"))
        );
        if (activeQuestions.length > 0) {
          const highPriority = activeQuestions.filter((q: any) => q.priority === "high");
          const others = activeQuestions.filter((q: any) => q.priority !== "high");
          context += `\n\n--- [买家问题库 - Buyer Questions to Address] ---`;
          context += `\n以下是买家常见问题，卖点必须覆盖高优先级问题，尽量覆盖中低优先级问题：`;
          if (highPriority.length > 0) {
            context += `\n【高优先级 - 必须覆盖】`;
            highPriority.forEach((q: any, i: number) => { context += `\n  ${i + 1}. ${q.question}${q.questionCn ? ` (中: ${q.questionCn})` : ""}`; });
          }
          if (others.length > 0) {
            context += `\n【中/低优先级 - 尽量覆盖】`;
            others.slice(0, 10).forEach((q: any, i: number) => { context += `\n  ${i + 1}. ${q.question}`; });
          }
        }
      } catch (e) { /* buyer questions not available, continue without */ }

      const parsed = await executeListingSkill<any>(
        "listing.sellingpoints.generate",
        ctx.user.id,
        context,
        { project, analyses, enrichedData },
        input.emphasis,
      );
      if (!Array.isArray(parsed.sellingPoints)) {
        if (Array.isArray(parsed.selling_points)) parsed.sellingPoints = parsed.selling_points;
        else if (Array.isArray(parsed.points)) parsed.sellingPoints = parsed.points;
        else if (Array.isArray(parsed.bulletCores)) parsed.sellingPoints = parsed.bulletCores;
        else if (Array.isArray(parsed.cores)) parsed.sellingPoints = parsed.cores;
        else if (Array.isArray(parsed.themes)) parsed.sellingPoints = parsed.themes;
      }
      if (!parsed.overallStrategy) {
        if (parsed.overall_strategy) parsed.overallStrategy = parsed.overall_strategy;
        else if (parsed.strategy) parsed.overallStrategy = parsed.strategy;
        else if (parsed.summary) parsed.overallStrategy = parsed.summary;
      }
      return parsed;
    }),


  // Step 2: Generate a single bullet point based on confirmed selling point core
  generateSingleBullet: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      sellingPoint: z.object({
        index: z.number(),
        theme: z.string(),
        themeZh: z.string().optional(),
        description: z.string(),
        descriptionZh: z.string().optional(),
        fabeDirection: z.object({
          feature: z.string(),
          advantage: z.string(),
          benefit: z.string(),
          evidence: z.string(),
        }).optional(),
        targetKeywords: z.array(z.string()).optional(),
        addressesGap: z.string().optional(),
      }),
      // Previously confirmed bullets for context continuity
      previousBullets: z.array(z.object({
        subtitle: z.string(),
        fullText: z.string(),
      })).optional(),
      emphasis: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const enrichedData = await loadEnrichedData(input.projectId);
      let context = buildProductContext(project, analyses, enrichedData);
      if (input.emphasis?.trim()) {
        context += `\n\n--- [User Emphasis] ---\n用户希望重点突出：${input.emphasis.trim()}`;
      }

      // Inject buyer questions for single bullet coverage
      try {
        const { getDb } = await import("../repository");
        const dbInst = await getDb();
        const { buyerQuestions: bqTable } = await import("../schema");
        const { eq, and } = await import("drizzle-orm");
        const activeQuestions = await dbInst!.select().from(bqTable).where(
          and(eq(bqTable.projectId, input.projectId), eq(bqTable.status, "active"))
        );
        if (activeQuestions.length > 0) {
          const highPriority = activeQuestions.filter((q: any) => q.priority === "high");
          if (highPriority.length > 0) {
            context += `\n\n--- [买家高优先级问题 - Must Address in Bullets] ---`;
            highPriority.forEach((q: any, i: number) => { context += `\n  ${i + 1}. ${q.question}`; });
          }
        }
      } catch (e) { /* buyer questions not available, continue without */ }

      // Build the selling point instruction
      const sp = input.sellingPoint;
      let spInstruction = `\n\n--- [Selling Point Core #${sp.index}] ---`;
      spInstruction += `\nTheme: ${sp.theme}`;
      if (sp.themeZh) spInstruction += ` (${sp.themeZh})`;
      spInstruction += `\nDescription: ${sp.description}`;
      if (sp.fabeDirection) {
        spInstruction += `\nFABE Direction:`;
        spInstruction += `\n  Feature: ${sp.fabeDirection.feature}`;
        spInstruction += `\n  Advantage: ${sp.fabeDirection.advantage}`;
        spInstruction += `\n  Benefit: ${sp.fabeDirection.benefit}`;
        spInstruction += `\n  Evidence: ${sp.fabeDirection.evidence}`;
      }
      if (sp.targetKeywords?.length) {
        spInstruction += `\nTarget Keywords to incorporate: ${sp.targetKeywords.join(", ")}`;
      }
      if (sp.addressesGap) {
        spInstruction += `\nAddresses: ${sp.addressesGap}`;
      }

      // Add previous bullets context to avoid repetition
      if (input.previousBullets?.length) {
        spInstruction += `\n\n--- [Previously Confirmed Bullets - DO NOT repeat these themes] ---`;
        input.previousBullets.forEach((b, i) => {
          spInstruction += `\nBullet ${i + 1}: ${b.subtitle} ${b.fullText}`;
        });
      }

      const response = await invokeBusinessSkill({
        max_tokens: 3072,
        messages: [
          { role: "system", content: SINGLE_BULLET_PROMPT },
          { role: "user", content: `Generate ONE optimized Amazon bullet point for selling point #${sp.index}.\n\nCRITICAL: The bullet (subtitle + space + fullText) MUST be 200-280 characters. Count every character precisely before outputting.\n\n${context}${spInstruction}` },
        ],
        response_format: { type: "json_object" },
      });

            const content = (response.choices?.[0]?.message?.content ?? "") as string;
      let parsed = safeParseJSON<any>(content);
      if ((parsed as any).raw) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 返回格式异常，请重试" });
      // Validate character count
      if (parsed.subtitle && parsed.fullText) {
        const combined = `${parsed.subtitle} ${parsed.fullText}`;
        parsed.actualCharacterCount = combined.length;
        parsed.characterCount = combined.length;
        parsed.inRange = combined.length >= 200 && combined.length <= 280;

        // Retry if out of range
        if (!parsed.inRange) {
          const issues = combined.length > 280
            ? [`Bullet is ${combined.length} chars (max 280)`]
            : [`Bullet is only ${combined.length} chars (min 200)`];

          const retryData = await refineBullets(
            { bulletPoints: [parsed] },
            issues
          );
          if (retryData?.bulletPoints?.[0]) {
            const refined = retryData.bulletPoints[0];
            const refinedCombined = `${refined.subtitle} ${refined.fullText}`;
            refined.actualCharacterCount = refinedCombined.length;
            refined.characterCount = refinedCombined.length;
            refined.inRange = refinedCombined.length >= 200 && refinedCombined.length <= 280;
            return refined;
          }
        }
      }

      return parsed;
    }),


  // ─── Expand Keyword to FABE Selling Point ──────
  expandKeywordToFABE: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      keyword: z.string().min(1).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const enrichedData = await loadEnrichedData(input.projectId);

      // Build a concise product context for the AI
      let contextSnippet = "";
      if (project.productName) contextSnippet += `Product: ${project.productName}\n`;
      if (project.category) contextSnippet += `Category: ${project.category}\n`;
      if (enrichedData.productAttributes) {
        const attrs = enrichedData.productAttributes;
        if (attrs.usp) contextSnippet += `USP: ${JSON.stringify(attrs.usp).slice(0, 300)}\n`;
        if (attrs.specs) contextSnippet += `Specs: ${JSON.stringify(attrs.specs).slice(0, 300)}\n`;
      }
      if (analyses.length > 0) {
        const topCompetitors = analyses.slice(0, 3).map((a: any) => {
          const parsed = a.analysisResult ? JSON.parse(a.analysisResult) : {};
          return `ASIN ${a.asin}: ${parsed.advantages?.slice(0, 2)?.join(", ") || "N/A"}`;
        });
        contextSnippet += `Competitors: ${topCompetitors.join("; ")}\n`;
      }
      if (enrichedData.reviewAggregation) {
        const ra = enrichedData.reviewAggregation;
        if (ra.painPoints?.length) contextSnippet += `Pain points: ${ra.painPoints.slice(0, 3).map((p: any) => p.point || p).join(", ")}\n`;
      }

      const userMessage = `User keyword/theme: "${input.keyword}"

Product context:
${contextSnippet || "No additional product context available."}

Please expand this keyword/theme into a complete selling point core with FABE direction.`;

      const response = await invokeBusinessSkill({
        messages: [
          { role: "system", content: EXPAND_KEYWORD_TO_FABE_PROMPT },
          { role: "user", content: userMessage },
        ],
      });

            const content = String(response.choices?.[0]?.message?.content || "");
      const parsed = safeParseJSON<any>(content);
      if ((parsed as any).raw) throw new Error("AI response format error");
      return {
        theme: parsed.theme || input.keyword,
        themeZh: parsed.themeZh || "",
        description: parsed.description || "",
        descriptionZh: parsed.descriptionZh || "",
        fabeDirection: {
          feature: parsed.fabeDirection?.feature || "",
          advantage: parsed.fabeDirection?.advantage || "",
          benefit: parsed.fabeDirection?.benefit || "",
          evidence: parsed.fabeDirection?.evidence || "",
        },
        targetKeywords: parsed.targetKeywords || [],
        addressesGap: parsed.addressesGap || "",
      };
    }),


  // ─── Sync Confirmed Bullets from Step-by-Step Selling Points ──────
  syncBulletsFromSellingPoints: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      bullets: z.array(z.object({
        subtitle: z.string(),
        fullText: z.string(),
      })).min(1).max(9),
    }))
    .mutation(async ({ ctx, input }) => {
      const { projectId, bullets } = input;
      const project = await resolveProjectAccess(projectId, ctx.user!);
      if (!project) throw new Error("项目不存在");
      ensureWriteAccess(project, ctx.user);

      // Format bullets as JSON array of strings (subtitle + fullText)
      const bulletStrings = bullets.map(b => `${b.subtitle} ${b.fullText}`);
      const bulletPointsJson = JSON.stringify(bulletStrings);

      // Check if active listing exists
      let listing = await db.getActiveListingByProject(projectId);
      if (listing) {
        // Update existing listing's bulletPoints
        const updated = await db.updateListing(listing.id, {
          bulletPoints: bulletPointsJson,
        });
        if (updated) {
          await saveListingVersion(updated, ctx.user.id, "manual_edit", `同步分步卖点精雕结果 (${bullets.length}条)`);
        }
        return { action: "updated", listingId: listing.id, bulletCount: bullets.length };
      } else {
        // Create new listing with only bulletPoints
        const newListing = await db.createListing({
          projectId,
          bulletPoints: bulletPointsJson,
          version: 1,
          isActive: 1,
        });
        if (newListing) {
          await saveListingVersion(newListing, ctx.user.id, "generate", `从分步卖点精雕创建 (${bullets.length}条)`);
        }
        return { action: "created", listingId: newListing?.id, bulletCount: bullets.length };
      }
    }),


  // Generate QA (Questions & Answers)
  generateQA: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      emphasis: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const enrichedData = await loadEnrichedData(input.projectId);
      let context = buildProductContext(project, analyses, enrichedData);

      // Include confirmed listing content for context
      const listing = await db.getActiveListingByProject(input.projectId);
      if (listing) {
        context += "\n\n--- [Confirmed Listing Content] ---";
        if (listing.title) context += `\nTitle: ${listing.title}`;
        if (listing.bulletPoints) {
          try {
            const bps = JSON.parse(listing.bulletPoints);
            if (Array.isArray(bps)) {
              context += `\nBullet Points:\n${bps.map((bp: any, i: number) => {
                if (typeof bp === 'string') return `  ${i + 1}. ${bp}`;
                return `  ${i + 1}. ${bp.subtitle || ''} ${bp.fullText || ''}`;
              }).join("\n")}`;
            }
          } catch {}
        }
        if (listing.description) context += `\nDescription: ${listing.description}`;
        if (listing.searchTerms) context += `\nSearch Terms: ${listing.searchTerms}`;
      }

      if (input.emphasis?.trim()) {
        context += `\n\n--- [User Emphasis] ---\n用户希望重点突出：${input.emphasis.trim()}`;
      }

      const parsed = await executeListingSkill<any>(
        "listing.qa.generate",
        ctx.user.id,
        context,
        { project, analyses, enrichedData, listing },
        input.emphasis,
      );

      // Auto-save QA to listing if active listing exists
      if (listing) {
        await db.updateListing(listing.id, {
          qaContent: JSON.stringify(parsed),
        });
        await saveListingVersion(
          { ...listing, qaContent: JSON.stringify(parsed) },
          ctx.user.id, "generate", "AI生成QA问答"
        );
        // Sync to Agent DAG: G5 QA node waiting for user review
        void syncGenerationToAgent({
          agentRunId: listing.agentRunId,
          nodeKey: "qa",
          projectId: input.projectId,
          userId: ctx.user.id,
          workspaceId: ctx.workspaceId ?? null,
          aiOutput: parsed,
        });
      }

      return parsed;
    }),


  // AI Chat assistant for workflow canvas
  aiChat: protectedProcedure
    .input(z.object({
      messages: z.array(z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string(),
      })),
    }))
    .mutation(async ({ input }) => {
      const response = await invokeBusinessSkill({
        messages: input.messages,
      });
      const content = response.choices[0].message.content;
      return {
        content: typeof content === "string" ? content : JSON.stringify(content),
      };
    }),
};
