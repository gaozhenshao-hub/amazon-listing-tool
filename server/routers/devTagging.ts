import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as devDb from "../devDb";

export const devTaggingRouter = router({
  startTagging: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const products = await devDb.getDevProductsByProject(input.projectId);
      if (products.length === 0) throw new Error("No products to tag");

      // Get custom tag dimensions
      const customDims = await devDb.getDevTagDimensions(ctx.user.id);
      const customDimText = customDims.length > 0
        ? `\n自定义维度：\n${customDims.map(d => `- ${d.name}: ${d.description || ""}`).join("\n")}`
        : "";

      // Process in batches of 5
      const batchSize = 5;
      let tagged = 0;
      for (let i = 0; i < products.length; i += batchSize) {
        const batch = products.slice(i, i + batchSize);
        const productData = batch.map(p => ({
          id: p.id,
          title: p.title || "",
          bulletPoints: p.bulletPoints || "",
          specs: p.bulletPoints || "",
          price: p.price || "",
          brand: p.brand || "",
        }));

        try {
          const response = await invokeLLM({
            messages: [
              {
                role: "system",
                content: `你是一个亚马逊产品分析专家。请根据产品标题、五点描述和详细参数，为每个产品提取以下维度的标签：
1. 基础属性：产品分类、款式
2. 材质属性：主要材质、次要材质
3. 参数属性：尺寸、重量、功率、容量等关键参数
4. 功能属性：核心功能特性
5. 外观属性：颜色、风格
6. 安装属性：安装方式
7. 认证标准：相关认证（UL、ETL、CE等）
8. 特殊属性：其他显著特征${customDimText}`,
              },
              {
                role: "user",
                content: `请为以下产品打标签：\n${JSON.stringify(productData, null, 2)}`,
              },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "product_tags",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    products: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "number" },
                          tags: {
                            type: "object",
                            properties: {
                              productCategory: { type: "string" },
                              style: { type: "string" },
                              mainMaterial: { type: "string" },
                              secondaryMaterial: { type: "string" },
                              size: { type: "string" },
                              weight: { type: "string" },
                              power: { type: "string" },
                              keyParams: { type: "string" },
                              coreFunctions: { type: "string" },
                              color: { type: "string" },
                              designStyle: { type: "string" },
                              installMethod: { type: "string" },
                              certifications: { type: "string" },
                              specialFeatures: { type: "string" },
                            },
                            required: ["productCategory", "style", "mainMaterial", "secondaryMaterial", "size", "weight", "power", "keyParams", "coreFunctions", "color", "designStyle", "installMethod", "certifications", "specialFeatures"],
                            additionalProperties: false,
                          },
                        },
                        required: ["id", "tags"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["products"],
                  additionalProperties: false,
                },
              },
            },
          });

          const content = response.choices?.[0]?.message?.content;
          if (content) {
            const parsed = JSON.parse(content as string);
            for (const item of parsed.products || []) {
              await devDb.updateDevProduct(item.id, {
                tags: JSON.stringify(item.tags),
                tagStatus: "tagged",
              });
              tagged++;
            }
          }
        } catch (err) {
          console.error(`[DevTagging] Batch error:`, err);
        }
      }

      return { success: true, tagged, total: products.length };
    }),

  getTaggedProducts: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const products = await devDb.getDevProductsByProject(input.projectId);
      return products.map(p => ({
        ...p,
        tags: p.tags ? JSON.parse(p.tags) : null,
      }));
    }),

  // Tag dimensions CRUD
  getTagDimensions: protectedProcedure.query(async ({ ctx }) => {
    return devDb.getDevTagDimensions(ctx.user.id);
  }),

  addTagDimension: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      category: z.string().optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return devDb.createDevTagDimension({
        userId: ctx.user.id,
        name: input.name,
        category: input.category ?? null,
        description: input.description ?? null,
      });
    }),

  deleteTagDimension: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return devDb.deleteDevTagDimension(input.id, ctx.user.id);
    }),
});
