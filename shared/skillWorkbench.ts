import { z } from "zod";

export const SkillDraftContentSchema = z.object({
  systemPrompt: z.string().trim().min(1).max(50000),
  userPromptTemplate: z.string().trim().min(1).max(30000),
});
export type SkillDraftContent = z.infer<typeof SkillDraftContentSchema>;
export const SkillWorkbenchInputSchema = z.object({
  context: z.string().max(120000).default(""),
  productId: z.number().int().positive().nullable().default(null),
});
export type SkillWorkbenchInput = z.infer<typeof SkillWorkbenchInputSchema>;
export type SkillWorkbenchTest = {
  id: string;
  name: string;
  input: SkillWorkbenchInput;
  output: string;
  runId: string;
  promptHash: string;
  inputHash: string;
  approved: boolean;
  durationMs: number;
  costCents: number;
  createdAt: string;
  baseline: boolean;
};
export type SkillWorkbenchDraft = {
  id: string;
  revision: number;
  baseHash: string;
  baseVersion: number;
  skillSlug: string;
  name: string;
  content: SkillDraftContent;
  input: SkillWorkbenchInput;
  tests: SkillWorkbenchTest[];
  feedback: Array<{ instruction: string; response: string }>;
  status: "draft" | "running" | "published" | "failed";
  error?: string;
};
