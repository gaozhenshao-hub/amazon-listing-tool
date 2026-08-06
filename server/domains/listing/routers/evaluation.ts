import * as shared from "../routerContext";

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

export const listingEvaluationProcedures = {


  // ─── Evaluate Bullet Checklist (15 Dimensions) ───
  evaluateBulletChecklist: protectedProcedure
    .input(z.object({
      subtitle: z.string(),
      fullText: z.string(),
      bulletIndex: z.number(),
    }))
    .mutation(async ({ input }) => {
      const bulletText = `${input.subtitle} ${input.fullText}`;

      const response = await invokeBusinessSkill({
        messages: [
          { role: "system", content: EVALUATE_BULLET_CHECKLIST_PROMPT },
          { role: "user", content: `Evaluate this Amazon bullet point (Bullet #${input.bulletIndex + 1}):\n\n${bulletText}` },
        ],
        response_format: { type: "json_object" },
      });

      const content = (response.choices?.[0]?.message?.content ?? "") as string;

      const parsedBullet = safeParseJSON<any>(content, {});
      return {
        checkListScores: parsedBullet.checkListScores || {},
        aiSemanticRelations: parsedBullet.aiSemanticRelations || null,
      };
    }),


  // ─── Checklist Scores Persistence ───
  saveChecklistScores: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      scores: z.string(), // JSON string of { [bulletIndex]: { checkListScores, aiSemanticRelations } }
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
        checklistScores: input.scores,
      });
    }),


  // ─── Title 10-Dimension Checklist Evaluation ───
  evaluateTitleChecklist: protectedProcedure
    .input(z.object({
      title: z.string(),
    }))
    .mutation(async ({ input }) => {
      const response = await invokeBusinessSkill({
        messages: [
          { role: "system", content: EVALUATE_TITLE_CHECKLIST_PROMPT },
          { role: "user", content: `Evaluate this Amazon product title:\n\n${input.title}\n\nCharacter count: ${input.title.length}` },
        ],
        response_format: { type: "json_object" },
      });
      const rawTitleMsg = response.choices?.[0]?.message?.content;
      const parsed = safeParseJSON<any>(rawTitleMsg, {});
      return { checkListScores: (parsed as any).checkListScores || {} };
    }),


  // ─── Description 8-Dimension Checklist Evaluation ───
  evaluateDescriptionChecklist: protectedProcedure
    .input(z.object({
      description: z.string(),
    }))
    .mutation(async ({ input }) => {
      const response = await invokeBusinessSkill({
        messages: [
          { role: "system", content: EVALUATE_DESCRIPTION_CHECKLIST_PROMPT },
          { role: "user", content: `Evaluate this Amazon product description:\n\n${input.description}\n\nCharacter count: ${input.description.length}` },
        ],
        response_format: { type: "json_object" },
      });
      const rawDescMsg = response.choices?.[0]?.message?.content;
      const parsedDesc = safeParseJSON<any>(rawDescMsg, {});
      return { checkListScores: (parsedDesc as any).checkListScores || {} };
    }),


  // ─── Search Terms 5-Dimension Checklist Evaluation ───
  evaluateSearchTermsChecklist: protectedProcedure
    .input(z.object({
      searchTerms: z.string(),
      title: z.string().optional(),
      bulletPoints: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      // 构建完整上下文传给 Emperor Skill
      let stContext = `Search Terms:\n${input.searchTerms}`;
      if (input.title) stContext += `\n\nProduct Title (for duplication check):\n${input.title}`;
      if (input.bulletPoints) stContext += `\n\nBullet Points (for long-tail coverage check):\n${input.bulletPoints}`;
      let userMsg = `Evaluate these Amazon backend search terms:\n\n${input.searchTerms}`;
      userMsg += `\n\nByte count: ${new TextEncoder().encode(input.searchTerms).length}`;
      if (input.title) userMsg += `\n\nProduct Title (for duplication check):\n${input.title}`;
      if (input.bulletPoints) userMsg += `\n\nBullet Points (for long-tail coverage check):\n${input.bulletPoints}`;
      const response = await invokeBusinessSkill({
        messages: [
          { role: "system", content: EVALUATE_SEARCH_TERMS_CHECKLIST_PROMPT },
          { role: "user", content: userMsg },
        ],
        response_format: { type: "json_object" },
      });
      const content = (response.choices?.[0]?.message?.content ?? "") as string;
      const parsedST = safeParseJSON<any>(content, {});
      return { checkListScores: parsedST.checkListScores || {} };
    }),


  // ─── QA 8-Dimension Checklist Evaluation ───
  evaluateQAChecklist: protectedProcedure
    .input(z.object({
      qaContent: z.string(),
    }))
    .mutation(async ({ input }) => {
      let qaText = input.qaContent;
      try {
        const parsed = JSON.parse(input.qaContent);
        if (Array.isArray(parsed)) {
          qaText = parsed.map((qa: any, i: number) =>
            `Q${i + 1}: ${qa.question || ""}\nA${i + 1}: ${qa.answer || ""}`
          ).join("\n\n");
        } else if (parsed.qaItems && Array.isArray(parsed.qaItems)) {
          qaText = parsed.qaItems.map((qa: any, i: number) =>
            `Q${i + 1}: ${qa.question || ""}\nA${i + 1}: ${qa.answer || ""}`
          ).join("\n\n");
        }
      } catch {}
      const response = await invokeBusinessSkill({
        messages: [
          { role: "system", content: EVALUATE_QA_CHECKLIST_PROMPT },
          { role: "user", content: `Evaluate these Amazon Q&A pairs:\n\n${qaText}` },
        ],
        response_format: { type: "json_object" },
      });
      const content = (response.choices?.[0]?.message?.content ?? "") as string;
      const parsedQA = safeParseJSON<any>(content, {});
      return { checkListScores: parsedQA.checkListScores || {} };
    }),
};