import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";

describe("KB Images - Re-crawl, Upload, ReAnalyze, DeleteImage endpoints", () => {
  it("reCrawlByPosition should be registered in kbImages router", () => {
    const procedures = Object.keys((appRouter as any)._def.procedures);
    expect(procedures).toContain("kbImages.reCrawlByPosition");
  });

  it("uploadImages should be registered in kbImages router", () => {
    const procedures = Object.keys((appRouter as any)._def.procedures);
    expect(procedures).toContain("kbImages.uploadImages");
  });

  it("reAnalyze should be registered in kbImages router", () => {
    const procedures = Object.keys((appRouter as any)._def.procedures);
    expect(procedures).toContain("kbImages.reAnalyze");
  });

  it("deleteImage should be registered in kbImages router", () => {
    const procedures = Object.keys((appRouter as any)._def.procedures);
    expect(procedures).toContain("kbImages.deleteImage");
  });

  it("reCrawlByPosition should be a mutation", () => {
    const proc = (appRouter as any)._def.procedures["kbImages.reCrawlByPosition"];
    expect(proc).toBeDefined();
    expect(proc._def.type === "mutation" || proc._def.mutation === true).toBe(true);
  });

  it("uploadImages should be a mutation", () => {
    const proc = (appRouter as any)._def.procedures["kbImages.uploadImages"];
    expect(proc).toBeDefined();
    expect(proc._def.type === "mutation" || proc._def.mutation === true).toBe(true);
  });

  it("reAnalyze should be a mutation", () => {
    const proc = (appRouter as any)._def.procedures["kbImages.reAnalyze"];
    expect(proc).toBeDefined();
    expect(proc._def.type === "mutation" || proc._def.mutation === true).toBe(true);
  });

  it("deleteImage should be a mutation", () => {
    const proc = (appRouter as any)._def.procedures["kbImages.deleteImage"];
    expect(proc).toBeDefined();
    expect(proc._def.type === "mutation" || proc._def.mutation === true).toBe(true);
  });

  it("existing endpoints should still be registered", () => {
    const procedures = Object.keys((appRouter as any)._def.procedures);
    expect(procedures).toContain("kbImages.listSets");
    expect(procedures).toContain("kbImages.getSet");
    expect(procedures).toContain("kbImages.importByAsin");
    expect(procedures).toContain("kbImages.confirmImageTags");
    expect(procedures).toContain("kbImages.confirmSetAnalysis");
    expect(procedures).toContain("kbImages.deleteSet");
  });
});
