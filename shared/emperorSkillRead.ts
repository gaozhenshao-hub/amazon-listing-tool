import { z } from "zod";

/** This describes the CURRENT registry only, not a historical execution pin. */
export const EMPEROR_SKILL_READ_PROMPT_MAX_BYTES = 256 * 1024;
export const EmperorSkillSlugSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);
const id = z.number().int().positive().safe().max(2_147_483_647);
export const EmperorSkillReadInputSchema = z.object({
  slug: EmperorSkillSlugSchema,
  expectedWorkspaceId: id.nullable(),
}).strict();
export const EmperorSkillReadResultSchema = z.object({
  identity: z.object({ userId: id, workspaceId: id.nullable() }).strict(),
  skill: z.object({
    slug: EmperorSkillSlugSchema,
    name: z.string().min(1).max(255),
    description: z.string().max(65_535).nullable(),
    category: z.string().min(1).max(64),
    status: z.literal("Released"),
    scope: z.enum(["global", "private", "shared"]),
    version: z.string().min(1).max(64),
    sourceWorkspaceId: id.nullable(),
    systemPrompt: z.string().max(EMPEROR_SKILL_READ_PROMPT_MAX_BYTES).nullable(),
    userPromptTemplate: z.string().max(EMPEROR_SKILL_READ_PROMPT_MAX_BYTES).nullable(),
  }).strict(),
  provenance: z.object({ kind: z.literal("current_registry"), pinnedVersion: z.literal(false) }).strict(),
}).strict();
export type EmperorSkillReadInput = z.infer<typeof EmperorSkillReadInputSchema>;
export type EmperorSkillReadResult = z.infer<typeof EmperorSkillReadResultSchema>;
