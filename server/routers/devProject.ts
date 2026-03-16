import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as devDb from "../devDb";
import { storagePut } from "../storage";

export const devProjectRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return devDb.getDevProjectsByUser(ctx.user.id);
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await devDb.getDevProjectById(input.id, ctx.user.id);
      if (!project) throw new Error("Project not found");
      // Load related data
      const [files, products, reviews, reports, score] = await Promise.all([
        devDb.getDevFilesByProject(input.id),
        devDb.getDevProductsByProject(input.id),
        devDb.getDevReviewStats(input.id),
        devDb.getDevReports(input.id),
        devDb.getDevProjectScore(input.id),
      ]);
      return { ...project, files, products, reviewStats: reviews, reports, score };
    }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      targetMarket: z.string().max(100).optional(),
      platform: z.string().max(50).optional(),
      keywords: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return devDb.createDevProject({
        userId: ctx.user.id,
        name: input.name,
        description: input.description ?? null,
        targetMarket: input.targetMarket ?? "US",
        platform: input.platform ?? "amazon",
        keywords: input.keywords ?? null,
      });
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      targetMarket: z.string().max(100).optional(),
      platform: z.string().max(50).optional(),
      keywords: z.string().optional(),
      status: z.enum(["draft", "data_collection", "analyzing", "scoring", "completed", "archived"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      return devDb.updateDevProject(id, ctx.user.id, data as any);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return devDb.deleteDevProject(input.id, ctx.user.id);
    }),

  stats: protectedProcedure.query(async ({ ctx }) => {
    return devDb.getDevProjectStats(ctx.user.id);
  }),

  // File upload - accepts base64 encoded file data
  uploadFile: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      fileName: z.string(),
      fileType: z.enum(["sales", "bullet_points", "reviews", "history_sales"]),
      fileData: z.string(), // base64
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify project ownership
      const project = await devDb.getDevProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      // Delete old files with same name in same project & type
      const deletedCount = await devDb.deleteOldFilesByName(
        input.projectId,
        input.fileType,
        input.fileName
      );

      // Upload to S3
      const buffer = Buffer.from(input.fileData, "base64");
      const suffix = Math.random().toString(36).substring(2, 8);
      const fileKey = `dev-files/${ctx.user.id}/${input.projectId}/${input.fileName}-${suffix}`;
      const { url } = await storagePut(fileKey, buffer, "application/octet-stream");

      // Create file record
      const result = await devDb.createDevUploadedFile({
        projectId: input.projectId,
        userId: ctx.user.id,
        filename: input.fileName,
        fileUrl: url,
        fileType: input.fileType,
      });

      return { id: result.id, url, replacedFiles: deletedCount };
    }),

  getFiles: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevFilesByProject(input.projectId);
    }),

  // Parse uploaded file data and save to products/reviews
  parseFile: protectedProcedure
    .input(z.object({
      fileId: z.number(),
      projectId: z.number(),
      parsedData: z.string(), // JSON string of parsed data
    }))
    .mutation(async ({ ctx, input }) => {
      await devDb.updateDevFile(input.fileId, {
        parsedData: input.parsedData,
        status: "parsed",
      });
      return { success: true };
    }),

  // Save products from parsed file (enhanced with full field mapping)
  saveProducts: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      products: z.array(z.object({
        asin: z.string(),
        title: z.string().optional(),
        brand: z.string().optional(),
        price: z.string().optional(),
        rating: z.string().optional(),
        reviewCount: z.number().optional(),
        monthlySales: z.number().optional(),
        bsr: z.number().optional(),
        bulletPoints: z.string().optional(),
        description: z.string().optional(),
        // Extended fields
        monthlyRevenue: z.number().optional(),
        listingDate: z.string().optional(),
        fulfillment: z.string().optional(),
        sellerName: z.string().optional(),
        sellerLocation: z.string().optional(),
        variantCount: z.number().optional(),
        category: z.string().optional(),
        subcategory: z.string().optional(),
        monthlySalesHistory: z.string().optional(),
        monthlyRevenueHistory: z.string().optional(),
        specifications: z.string().optional(),
        imageUrl: z.string().optional(),
        searchRank: z.number().optional(),
        // Panorama extended fields
        parentAsin: z.string().optional(),
        sku: z.string().optional(),
        productLink: z.string().optional(),
        categoryPath: z.string().optional(),
        bsrLarge: z.number().optional(),
        bsrSmall: z.number().optional(),
        bsrGrowthRate: z.string().optional(),
        fbaFee: z.string().optional(),
        grossMargin: z.string().optional(),
        monthlySalesGrowth: z.string().optional(),
        childSales: z.number().optional(),
        childRevenue: z.number().optional(),
        monthlyNewReviews: z.number().optional(),
        reviewRate: z.string().optional(),
        lqs: z.number().optional(),
        sellerCount: z.number().optional(),
        listingDays: z.number().optional(),
        buyboxSeller: z.string().optional(),
        buyboxType: z.string().optional(),
        hasAPlus: z.number().optional(),
        hasVideo: z.number().optional(),
        hasBrandStory: z.number().optional(),
        hasAmazonChoice: z.number().optional(),
        productWeight: z.string().optional(),
        productSize: z.string().optional(),
        packageWeight: z.string().optional(),
        packageSize: z.string().optional(),
        packageSizeTier: z.string().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      await devDb.upsertDevProducts(input.projectId, input.products.map(p => ({
        projectId: input.projectId,
        asin: p.asin,
        title: p.title ?? null,
        brand: p.brand ?? null,
        price: p.price ?? null,
        rating: p.rating ?? null,
        reviewCount: p.reviewCount?.toString() ?? null,
        monthlySales: p.monthlySales ?? null,
        bsr: p.bsr ?? null,
        bulletPoints: p.bulletPoints ?? null,
        description: p.description ?? null,
        monthlyRevenue: p.monthlyRevenue?.toString() ?? null,
        listingDate: p.listingDate ?? null,
        fulfillment: p.fulfillment ?? null,
        sellerName: p.sellerName ?? null,
        sellerLocation: p.sellerLocation ?? null,
        variantCount: p.variantCount ?? null,
        category: p.category ?? null,
        subcategory: p.subcategory ?? null,
        monthlySalesHistory: p.monthlySalesHistory ?? null,
        monthlyRevenueHistory: p.monthlyRevenueHistory ?? null,
        specifications: p.specifications ?? null,
        imageUrl: p.imageUrl ?? null,
        searchRank: p.searchRank ?? null,
        // Panorama extended fields
        parentAsin: p.parentAsin ?? null,
        sku: p.sku ?? null,
        productLink: p.productLink ?? null,
        categoryPath: p.categoryPath ?? null,
        bsrLarge: p.bsrLarge ?? null,
        bsrSmall: p.bsrSmall ?? null,
        bsrGrowthRate: p.bsrGrowthRate ?? null,
        fbaFee: p.fbaFee ?? null,
        grossMargin: p.grossMargin ?? null,
        monthlySalesGrowth: p.monthlySalesGrowth ?? null,
        childSales: p.childSales ?? null,
        childRevenue: p.childRevenue?.toString() ?? null,
        monthlyNewReviews: p.monthlyNewReviews ?? null,
        reviewRate: p.reviewRate ?? null,
        lqs: p.lqs ?? null,
        sellerCount: p.sellerCount ?? null,
        listingDays: p.listingDays ?? null,
        buyboxSeller: p.buyboxSeller ?? null,
        buyboxType: p.buyboxType ?? null,
        hasAPlus: p.hasAPlus ?? null,
        hasVideo: p.hasVideo ?? null,
        hasBrandStory: p.hasBrandStory ?? null,
        hasAmazonChoice: p.hasAmazonChoice ?? null,
        productWeight: p.productWeight ?? null,
        productSize: p.productSize ?? null,
        packageWeight: p.packageWeight ?? null,
        packageSize: p.packageSize ?? null,
        packageSizeTier: p.packageSizeTier ?? null,
      })));
      return { success: true, count: input.products.length };
    }),

  getProducts: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevProductsByProject(input.projectId);
    }),

  // Save reviews from parsed file
  saveReviews: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      reviews: z.array(z.object({
        asin: z.string().optional(),
        title: z.string().optional(),
        content: z.string().optional(),
        rating: z.number().optional(),
        reviewDate: z.string().optional(),
        isVP: z.boolean().optional(),
        variant: z.string().optional(),
        helpfulCount: z.number().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      await devDb.insertDevReviews(input.reviews.map(r => ({
        projectId: input.projectId,
        asin: r.asin ?? null,
        title: r.title ?? null,
        content: r.content ?? null,
        rating: r.rating ?? null,
        reviewDate: r.reviewDate ?? null,
        isVP: r.isVP ? 1 : 0,
        variant: r.variant ?? null,
        helpfulCount: r.helpfulCount ?? null,
      })));
      return { success: true, count: input.reviews.length };
    }),

  getReviewStats: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevReviewStats(input.projectId);
    }),

  // ─── Data Confirmation ──────────────────────────────────────────
  getDataStatus: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDataConfirmationStatus(input.projectId);
    }),

  confirmData: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      fileType: z.enum(["sales", "bullet_points", "reviews", "history_sales"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await devDb.getDevProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");
      await devDb.confirmDevFilesByType(input.projectId, input.fileType);
      return { success: true };
    }),

  unconfirmData: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      fileType: z.enum(["sales", "bullet_points", "reviews", "history_sales"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await devDb.getDevProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");
      await devDb.unconfirmDevFilesByType(input.projectId, input.fileType);
      return { success: true };
    }),

  // Update file record with totalRows after parsing
  updateFileRows: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      fileType: z.enum(["sales", "bullet_points", "reviews", "history_sales"]),
      totalRows: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await devDb.getDevProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");
      await devDb.updateDevFileRowsByType(input.projectId, input.fileType, input.totalRows);
      return { success: true };
    }),
});
