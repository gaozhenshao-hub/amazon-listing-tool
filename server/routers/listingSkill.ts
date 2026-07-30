import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { runEmperorSkill } from "../services/emperorSkillRunner";

const listingStepSchema = z.enum([
  "listing.sellingpoints.generate",
  "listing.title.generate",
  "listing.bullets.generate",
  "listing.description.generate",
  "listing.searchterms.generate",
  "listing.qa.generate",
]);

const DEFAULT_FALLBACK_MODELS = [
  "claude-sonnet-5",
  "gemini-3-6-flash",
  "manus-default",
];

function parseJsonOutput(content: string): unknown {
  const cleaned = content
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/im, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const objectStart = cleaned.indexOf("{");
    const objectEnd = cleaned.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) {
      return JSON.parse(cleaned.slice(objectStart, objectEnd + 1));
    }
    const arrayStart = cleaned.indexOf("[");
    const arrayEnd = cleaned.lastIndexOf("]");
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      return JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1));
    }
    throw new Error("AI output is not valid JSON");
  }
}

const commonInput = z.object({
  context: z.string().min(1),
  emphasis: z.string().optional().default(""),
  variables: z.record(z.string(), z.unknown()).optional().default({}),
  modelOverride: z.string().optional(),
});

export const listingSkillRouter = router({
  /**
   * Safe compatibility endpoint. Existing Listing procedures remain unchanged.
   * This endpoint allows real-model verification before switching production UI.
   */
  runStep: protectedProcedure
    .input(commonInput.extend({ skillSlug: listingStepSchema }))
    .mutation(async ({ input, ctx }) => {
      return runEmperorSkill({
        skillSlug: input.skillSlug,
        userId: ctx.user.id,
        context: input.context,
        emphasis: input.emphasis,
        variables: input.variables,
        modelOverride: input.modelOverride,
        fallbackModels: DEFAULT_FALLBACK_MODELS,
        validate: parseJsonOutput,
      });
    }),

  /**
   * Runs the complete Listing workflow through Emperor Skills.
   * The original Listing flow is intentionally preserved for production rollback.
   */
  generateFiveSteps: protectedProcedure
    .input(commonInput)
    .mutation(async ({ input, ctx }) => {
      const base = {
        userId: ctx.user.id,
        context: input.context,
        emphasis: input.emphasis,
        modelOverride: input.modelOverride,
        fallbackModels: DEFAULT_FALLBACK_MODELS,
        validate: parseJsonOutput,
      };

      const sellingPoints = await runEmperorSkill({
        ...base,
        skillSlug: "listing.sellingpoints.generate",
        variables: input.variables,
      });

      const title = await runEmperorSkill({
        ...base,
        skillSlug: "listing.title.generate",
        variables: { ...input.variables, sellingPoints: sellingPoints.parsed },
      });

      const bullets = await runEmperorSkill({
        ...base,
        skillSlug: "listing.bullets.generate",
        variables: {
          ...input.variables,
          sellingPoints: sellingPoints.parsed,
          title: title.parsed,
        },
      });

      const description = await runEmperorSkill({
        ...base,
        skillSlug: "listing.description.generate",
        variables: {
          ...input.variables,
          sellingPoints: sellingPoints.parsed,
          title: title.parsed,
          bullets: bullets.parsed,
        },
      });

      const searchTerms = await runEmperorSkill({
        ...base,
        skillSlug: "listing.searchterms.generate",
        variables: {
          ...input.variables,
          title: title.parsed,
          bullets: bullets.parsed,
          description: description.parsed,
        },
      });

      const qa = await runEmperorSkill({
        ...base,
        skillSlug: "listing.qa.generate",
        variables: {
          ...input.variables,
          title: title.parsed,
          bullets: bullets.parsed,
          description: description.parsed,
          searchTerms: searchTerms.parsed,
        },
      });

      return {
        sellingPoints,
        title,
        bullets,
        description,
        searchTerms,
        qa,
        migrationMode: "safe_parallel" as const,
      };
    }),
});
