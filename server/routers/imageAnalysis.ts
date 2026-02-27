import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import { storagePut } from "../storage";
import * as db from "../db";
import { IMAGE_RECOGNITION_PROMPT } from "../prompts";
import { nanoid } from "nanoid";

export const imageAnalysisRouter = router({
  // Get all image analyses for a project
  listByProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");
      return db.getImageAnalysesByProject(input.projectId);
    }),

  // Upload and analyze an image
  analyze: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      imageBase64: z.string(), // base64 encoded image
      fileName: z.string().optional(),
      mimeType: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      // Upload image to S3
      const fileExt = input.fileName?.split(".").pop() || "jpg";
      const fileKey = `image-analysis/${ctx.user.id}/${nanoid()}.${fileExt}`;
      const imageBuffer = Buffer.from(input.imageBase64, "base64");
      const mimeType = input.mimeType || "image/jpeg";

      const { url: imageUrl } = await storagePut(fileKey, imageBuffer, mimeType);

      // Analyze image with Vision
      const response = await invokeLLM({
        messages: [
          { role: "system", content: IMAGE_RECOGNITION_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Analyze this Amazon product image and extract all relevant information for listing creation:" },
              { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      });

      const content = typeof response.choices[0].message.content === "string"
        ? response.choices[0].message.content
        : JSON.stringify(response.choices[0].message.content);

      let analysisResult: any;
      try {
        analysisResult = JSON.parse(content);
      } catch {
        analysisResult = { raw: content };
      }

      // Save to database
      const saved = await db.createImageAnalysis({
        projectId: input.projectId,
        imageUrl,
        analysisResult: JSON.stringify(analysisResult),
      });

      return {
        ...saved,
        parsedResult: analysisResult,
      };
    }),
});
