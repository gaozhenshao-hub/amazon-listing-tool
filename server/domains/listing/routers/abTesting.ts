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
  invokeLLM,
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

export const listingAbTestingProcedures = {


  // Generate A/B test variants - 3 different styles for title and bullet points
  generateABTest: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      // Which components to generate variants for
      components: z.array(z.enum(["title", "bulletPoints"])).default(["title", "bulletPoints"]),
      // Optional custom style instruction from user
      customStyle: z.object({
        name: z.string(),
        instruction: z.string(),
      }).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const enrichedData = await loadEnrichedData(input.projectId);
      const context = buildProductContext(project, analyses, enrichedData);

      const styles: Array<{
        id: string; name: string; nameEn: string; description: string;
        titleInstruction: string; bulletInstruction: string;
      }> = [
        {
          id: "professional",
          name: "专业技术型",
          nameEn: "Professional & Technical",
          description: "强调产品规格参数、技术优势、专利认证，适合注重品质和性能的买家",
          titleInstruction: "Focus on technical specifications, certifications, material quality, and performance metrics. Use precise numbers and professional terminology. Appeal to informed buyers who compare specs.",
          bulletInstruction: "Lead each bullet with a technical feature or specification. Use precise measurements, material names, and performance data. Include certifications, test results, and engineering details. Evidence should cite specific numbers and standards.",
        },
        {
          id: "emotional",
          name: "情感场景型",
          nameEn: "Emotional & Lifestyle",
          description: "强调使用场景、情感共鸣、生活方式，适合注重体验和感受的买家",
          titleInstruction: "Focus on lifestyle benefits, usage scenarios, and emotional outcomes. Paint a picture of how the product improves daily life. Use warm, relatable language that connects with the buyer's aspirations.",
          bulletInstruction: "Lead each bullet with a relatable scenario or emotional benefit. Describe how the product fits into the buyer's life, solves daily frustrations, or creates joyful moments. Use vivid, sensory language. Evidence should reference real customer experiences.",
        },
        {
          id: "datadriven",
          name: "数据驱动型",
          nameEn: "Data-Driven & Comparative",
          description: "强调数据对比、量化优势、竞品差异化，适合理性决策的买家",
          titleInstruction: "Focus on quantifiable advantages and comparative benefits. Use numbers, percentages, and measurable improvements. Highlight what makes this product X% better, X times stronger, or X units more efficient than alternatives.",
          bulletInstruction: "Lead each bullet with a quantified claim or data comparison. Use percentages, multipliers, and measurable outcomes (e.g., '3X faster', '50% lighter', 'supports 300lbs'). Compare against industry standards or common alternatives. Evidence should be data-backed with specific numbers.",
        },
      ];

      // Add custom style if provided by user
      if (input.customStyle) {
        styles.push({
          id: "custom",
          name: input.customStyle.name || "自定义风格",
          nameEn: "Custom Style",
          description: input.customStyle.instruction,
          titleInstruction: input.customStyle.instruction + " Write the title following this custom style direction from the user.",
          bulletInstruction: input.customStyle.instruction + " Write the bullet points following this custom style direction from the user.",
        });
      }

      const variants: any[] = [];

      // Generate all style variants in parallel (3 default + optional custom)
      const variantPromises = styles.map(async (style) => {
        const variant: any = { id: style.id, name: style.name, nameEn: style.nameEn, description: style.description };

        if (input.components.includes("title")) {
          const titleResponse = await invokeLLM({
            messages: [
              { role: "system", content: TITLE_GENERATION_PROMPT },
              {
                role: "user",
                content: `Generate optimized Amazon titles for this product. Each title MUST be exactly 180-200 characters.\n\nSTYLE INSTRUCTION: ${style.titleInstruction}\n\n${context}`,
              },
            ],
            response_format: { type: "json_object" },
          });

          const titleContent = typeof titleResponse.choices[0].message.content === "string"
            ? titleResponse.choices[0].message.content
            : JSON.stringify(titleResponse.choices[0].message.content);

          {
            let titleData = safeParseJSON<any>(titleContent);
            if (!(titleData as any).raw) {
              let validation = validateTitles(titleData);
              if (!validation.valid) {
                for (let retry = 0; retry < MAX_RETRIES && !validation.valid; retry++) {
                  titleData = await refineTitles(titleData, validation.issues);
                  validation = validateTitles(titleData);
                }
              }
            }
            variant.titleData = titleData;
          }
        }

        if (input.components.includes("bulletPoints")) {
          const bulletResponse = await invokeLLM({
            messages: [
              { role: "system", content: BULLET_POINTS_PROMPT },
              {
                role: "user",
                content: `Generate 5 optimized Amazon bullet points. Each bullet (subtitle + space + fullText) MUST be 200-280 characters.\n\nSTYLE INSTRUCTION: ${style.bulletInstruction}\n\n${context}`,
              },
            ],
            response_format: { type: "json_object" },
          });

          const bulletContent = typeof bulletResponse.choices[0].message.content === "string"
            ? bulletResponse.choices[0].message.content
            : JSON.stringify(bulletResponse.choices[0].message.content);

          {
            let bulletData = safeParseJSON<any>(bulletContent);
            if (!(bulletData as any).raw) {
              let validation = validateBullets(bulletData);
              if (!validation.valid) {
                for (let retry = 0; retry < MAX_RETRIES && !validation.valid; retry++) {
                  bulletData = await refineBullets(bulletData, validation.issues);
                  validation = validateBullets(bulletData);
                }
              }
            }
            variant.bulletData = bulletData;
          }
        }

        return variant;
      });

      const results = await Promise.all(variantPromises);
      // Maintain order
      for (const style of styles) {
        const found = results.find((r) => r.id === style.id);
        if (found) variants.push(found);
      }

      return { variants, projectId: input.projectId };
    }),


  // Apply a selected A/B variant to the active listing
  applyABVariant: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      // The selected variant data to apply
      title: z.string().optional(),
      bulletPoints: z.string().optional(), // JSON string of bullet points array
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      const listing = await db.getActiveListingByProject(input.projectId);
      if (!listing) throw new Error("No active listing found. Please generate a listing first.");

      const updateData: Record<string, any> = {};
      if (input.title) updateData.title = input.title;
      if (input.bulletPoints) updateData.bulletPoints = input.bulletPoints;

      if (Object.keys(updateData).length === 0) {
        throw new Error("No data to apply");
      }

      // Generate Chinese translation for the updated content
      const newTitle = input.title || listing.title || "";
      let newBullets: any[] = [];
      try {
        newBullets = input.bulletPoints ? JSON.parse(input.bulletPoints) : (listing.bulletPoints ? JSON.parse(listing.bulletPoints) : []);
      } catch {
        newBullets = [];
      }

      try {
        const cnData = await generateChineseTranslation(
          newTitle,
          newBullets,
          listing.description || "",
          listing.searchTerms || "",
          undefined,
          listing.itemHighlights || undefined,
          ctx.user.id,
        );
        if (input.title && cnData.titleCn) updateData.titleCn = cnData.titleCn;
        if (input.bulletPoints && cnData.bulletPointsCn?.length > 0) {
          updateData.bulletPointsCn = JSON.stringify(cnData.bulletPointsCn);
        }
      } catch (err) {
        console.error("Chinese translation for A/B variant failed:", err);
      }

      const updated = await db.updateListing(listing.id, updateData);

      // Save version snapshot after A/B variant applied
      if (updated) {
        const appliedParts = [];
        if (input.title) appliedParts.push("标题");
        if (input.bulletPoints) appliedParts.push("卖点");
        await saveListingVersion(updated, ctx.user.id, "ab_apply", `应用A/B测试方案: ${appliedParts.join("、")}`);
      }

      return { listing: updated, applied: Object.keys(updateData) };
    }),
};