import { describe, it, expect } from "vitest";

// Test afterSales router module structure
describe("AfterSales Router Module", () => {
  it("should export afterSalesRouter from afterSales.ts", async () => {
    const mod = await import("./routers/afterSales");
    expect(mod.afterSalesRouter).toBeDefined();
    expect(typeof mod.afterSalesRouter).toBe("object");
  });

  it("should have getDashboardStats procedure", async () => {
    const mod = await import("./routers/afterSales");
    expect(mod.afterSalesRouter.getDashboardStats).toBeDefined();
  });

  it("should have getReviews procedure", async () => {
    const mod = await import("./routers/afterSales");
    expect(mod.afterSalesRouter.getReviews).toBeDefined();
  });

  it("should have getReviewStats procedure", async () => {
    const mod = await import("./routers/afterSales");
    expect(mod.afterSalesRouter.getReviewStats).toBeDefined();
  });

  it("should have aiReviewAnalysis procedure", async () => {
    const mod = await import("./routers/afterSales");
    expect(mod.afterSalesRouter.aiReviewAnalysis).toBeDefined();
  });

  it("should have saveReviewReply procedure", async () => {
    const mod = await import("./routers/afterSales");
    expect(mod.afterSalesRouter.saveReviewReply).toBeDefined();
  });

  it("should have getReturnAnalysis procedure", async () => {
    const mod = await import("./routers/afterSales");
    expect(mod.afterSalesRouter.getReturnAnalysis).toBeDefined();
  });

  it("should have getRmaList procedure", async () => {
    const mod = await import("./routers/afterSales");
    expect(mod.afterSalesRouter.getRmaList).toBeDefined();
  });

  it("should have aiReturnDiagnosis procedure", async () => {
    const mod = await import("./routers/afterSales");
    expect(mod.afterSalesRouter.aiReturnDiagnosis).toBeDefined();
  });

  it("should have getEmails procedure", async () => {
    const mod = await import("./routers/afterSales");
    expect(mod.afterSalesRouter.getEmails).toBeDefined();
  });

  it("should have aiEmailReply procedure", async () => {
    const mod = await import("./routers/afterSales");
    expect(mod.afterSalesRouter.aiEmailReply).toBeDefined();
  });

  it("should have listTemplates procedure", async () => {
    const mod = await import("./routers/afterSales");
    expect(mod.afterSalesRouter.listTemplates).toBeDefined();
  });

  it("should have createTemplate procedure", async () => {
    const mod = await import("./routers/afterSales");
    expect(mod.afterSalesRouter.createTemplate).toBeDefined();
  });

  it("should have updateTemplate procedure", async () => {
    const mod = await import("./routers/afterSales");
    expect(mod.afterSalesRouter.updateTemplate).toBeDefined();
  });

  it("should have deleteTemplate procedure", async () => {
    const mod = await import("./routers/afterSales");
    expect(mod.afterSalesRouter.deleteTemplate).toBeDefined();
  });

  it("should have aiGenerateTemplate procedure", async () => {
    const mod = await import("./routers/afterSales");
    expect(mod.afterSalesRouter.aiGenerateTemplate).toBeDefined();
  });

  it("should have listServiceTasks procedure", async () => {
    const mod = await import("./routers/afterSales");
    expect(mod.afterSalesRouter.listServiceTasks).toBeDefined();
  });

  it("should have createServiceTask procedure", async () => {
    const mod = await import("./routers/afterSales");
    expect(mod.afterSalesRouter.createServiceTask).toBeDefined();
  });

  it("should have updateServiceTask procedure", async () => {
    const mod = await import("./routers/afterSales");
    expect(mod.afterSalesRouter.updateServiceTask).toBeDefined();
  });

  it("should have aiServiceBriefing procedure", async () => {
    const mod = await import("./routers/afterSales");
    expect(mod.afterSalesRouter.aiServiceBriefing).toBeDefined();
  });

  it("should have getProcessedReviews procedure", async () => {
    const mod = await import("./routers/afterSales");
    expect(mod.afterSalesRouter.getProcessedReviews).toBeDefined();
  });

  it("should have getVoiceOfBuyer procedure", async () => {
    const mod = await import("./routers/afterSales");
    expect(mod.afterSalesRouter.getVoiceOfBuyer).toBeDefined();
  });

  it("should have getFeedbackList procedure", async () => {
    const mod = await import("./routers/afterSales");
    expect(mod.afterSalesRouter.getFeedbackList).toBeDefined();
  });

  it("should have getPerformanceNotices procedure", async () => {
    const mod = await import("./routers/afterSales");
    expect(mod.afterSalesRouter.getPerformanceNotices).toBeDefined();
  });
});

// Test router registration in main routers
describe("AfterSales Router Registration", () => {
  it("should be registered in main appRouter", async () => {
    const mod = await import("./routers");
    expect(mod.appRouter).toBeDefined();
    // afterSales should be a key in appRouter
    expect((mod.appRouter as any)._def?.procedures?.["afterSales.getDashboardStats"] || 
           (mod.appRouter as any).afterSales).toBeDefined();
  });
});

// Test schema tables
describe("AfterSales Schema Tables", () => {
  it("should export reviewRecords table", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.reviewRecords).toBeDefined();
  });

  it("should export reviewReplies table", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.reviewReplies).toBeDefined();
  });

  it("should export emailTemplates table", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.emailTemplates).toBeDefined();
  });

  it("should export emailReplies table", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.emailReplies).toBeDefined();
  });

  it("should export returnAnalysisCache table", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.returnAnalysisCache).toBeDefined();
  });

  it("should export serviceTasks table", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.serviceTasks).toBeDefined();
  });
});
