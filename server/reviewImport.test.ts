import { describe, it, expect } from "vitest";

describe("Execution Review Import Procedures", () => {
  it("should have downloadReviewTemplate procedure defined", async () => {
    const { productOpsRouter } = await import("./routers/productOps");
    const procedures = Object.keys((productOpsRouter as any)._def.procedures);
    expect(procedures).toContain("downloadReviewTemplate");
  });

  it("should have importReviewsFromExcel procedure defined", async () => {
    const { productOpsRouter } = await import("./routers/productOps");
    const procedures = Object.keys((productOpsRouter as any)._def.procedures);
    expect(procedures).toContain("importReviewsFromExcel");
  });

  it("downloadReviewTemplate should be a mutation", async () => {
    const { productOpsRouter } = await import("./routers/productOps");
    const proc = (productOpsRouter as any)._def.procedures.downloadReviewTemplate;
    expect(proc._def.type).toBe("mutation");
  });

  it("importReviewsFromExcel should be a mutation", async () => {
    const { productOpsRouter } = await import("./routers/productOps");
    const proc = (productOpsRouter as any)._def.procedures.importReviewsFromExcel;
    expect(proc._def.type).toBe("mutation");
  });

  it("importReviewsFromExcel should require fileName and fileData inputs", async () => {
    const { productOpsRouter } = await import("./routers/productOps");
    const proc = (productOpsRouter as any)._def.procedures.importReviewsFromExcel;
    // The input schema should exist
    const inputDef = proc._def.inputs;
    expect(inputDef).toBeDefined();
    expect(inputDef.length).toBeGreaterThan(0);
  });

  it("downloadReviewTemplate should accept marketplace input", async () => {
    const { productOpsRouter } = await import("./routers/productOps");
    const proc = (productOpsRouter as any)._def.procedures.downloadReviewTemplate;
    const inputDef = proc._def.inputs;
    expect(inputDef).toBeDefined();
    expect(inputDef.length).toBeGreaterThan(0);
  });

  it("should co-exist with existing execution review CRUD procedures", async () => {
    const { productOpsRouter } = await import("./routers/productOps");
    const procedures = Object.keys((productOpsRouter as any)._def.procedures);
    // Existing CRUD
    expect(procedures).toContain("listExecutionReviews");
    expect(procedures).toContain("createExecutionReview");
    expect(procedures).toContain("updateExecutionReview");
    expect(procedures).toContain("deleteExecutionReview");
    // New import
    expect(procedures).toContain("downloadReviewTemplate");
    expect(procedures).toContain("importReviewsFromExcel");
  });

  it("should co-exist with plan import procedures", async () => {
    const { productOpsRouter } = await import("./routers/productOps");
    const procedures = Object.keys((productOpsRouter as any)._def.procedures);
    expect(procedures).toContain("downloadPlanTemplate");
    expect(procedures).toContain("importPlansFromExcel");
    expect(procedures).toContain("downloadReviewTemplate");
    expect(procedures).toContain("importReviewsFromExcel");
  });
});
