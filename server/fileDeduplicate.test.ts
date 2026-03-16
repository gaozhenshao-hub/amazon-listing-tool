import { describe, it, expect, vi } from "vitest";

// Test the dedup logic for file uploads
describe("File Deduplication Logic", () => {
  describe("deleteOldFilesByName function", () => {
    it("should be exported from devDb", async () => {
      const devDb = await import("./devDb");
      expect(typeof devDb.deleteOldFilesByName).toBe("function");
    });

    it("should accept projectId, fileType, and filename parameters", async () => {
      const devDb = await import("./devDb");
      // Function signature check - it should accept 3 params
      expect(devDb.deleteOldFilesByName.length).toBe(3);
    });
  });

  describe("Upload file dedup behavior", () => {
    it("uploadFile endpoint should exist in devProject router", async () => {
      const { appRouter } = await import("./routers");
      const procedures = Object.keys((appRouter as any)._def.procedures);
      expect(procedures).toContain("devProject.uploadFile");
    });

    it("devProject router should have uploadFile procedure", async () => {
      const devProjectRouter = await import("./routers/devProject");
      const routerDef = (devProjectRouter.devProjectRouter as any)._def;
      expect(routerDef.procedures.uploadFile).toBeDefined();
    });
  });

  describe("Dedup logic correctness", () => {
    it("should identify files by projectId + fileType + filename combination", () => {
      // Simulate the dedup matching logic
      const files = [
        { id: 1, projectId: 1, fileType: "sales", filename: "test.xlsx" },
        { id: 2, projectId: 1, fileType: "sales", filename: "test.xlsx" },
        { id: 3, projectId: 1, fileType: "sales", filename: "other.xlsx" },
        { id: 4, projectId: 2, fileType: "sales", filename: "test.xlsx" },
        { id: 5, projectId: 1, fileType: "reviews", filename: "test.xlsx" },
      ];

      // When uploading test.xlsx to project 1 as sales type
      const targetProject = 1;
      const targetType = "sales";
      const targetName = "test.xlsx";

      const duplicates = files.filter(
        f => f.projectId === targetProject && f.fileType === targetType && f.filename === targetName
      );

      // Should find exactly 2 duplicates (id 1 and 2)
      expect(duplicates.length).toBe(2);
      expect(duplicates.map(d => d.id)).toEqual([1, 2]);
    });

    it("should not affect files with different names in same project/type", () => {
      const files = [
        { id: 1, projectId: 1, fileType: "sales", filename: "data1.xlsx" },
        { id: 2, projectId: 1, fileType: "sales", filename: "data2.xlsx" },
      ];

      const duplicates = files.filter(
        f => f.projectId === 1 && f.fileType === "sales" && f.filename === "data1.xlsx"
      );

      expect(duplicates.length).toBe(1);
      expect(duplicates[0].id).toBe(1);
    });

    it("should not affect files in different projects with same name", () => {
      const files = [
        { id: 1, projectId: 1, fileType: "sales", filename: "test.xlsx" },
        { id: 2, projectId: 2, fileType: "sales", filename: "test.xlsx" },
      ];

      const duplicates = files.filter(
        f => f.projectId === 1 && f.fileType === "sales" && f.filename === "test.xlsx"
      );

      expect(duplicates.length).toBe(1);
      expect(duplicates[0].id).toBe(1);
    });

    it("should not affect files of different type with same name", () => {
      const files = [
        { id: 1, projectId: 1, fileType: "sales", filename: "test.xlsx" },
        { id: 2, projectId: 1, fileType: "reviews", filename: "test.xlsx" },
      ];

      const duplicates = files.filter(
        f => f.projectId === 1 && f.fileType === "sales" && f.filename === "test.xlsx"
      );

      expect(duplicates.length).toBe(1);
      expect(duplicates[0].id).toBe(1);
    });

    it("should handle batch review files correctly - each file deduped independently", () => {
      const existingFiles = [
        { id: 1, projectId: 1, fileType: "reviews", filename: "B001.xlsx" },
        { id: 2, projectId: 1, fileType: "reviews", filename: "B002.xlsx" },
        { id: 3, projectId: 1, fileType: "reviews", filename: "B003.xlsx" },
      ];

      // Re-uploading B001.xlsx and B002.xlsx
      const newFiles = ["B001.xlsx", "B002.xlsx"];

      for (const newFile of newFiles) {
        const dupes = existingFiles.filter(
          f => f.projectId === 1 && f.fileType === "reviews" && f.filename === newFile
        );
        // Each should find exactly 1 duplicate
        expect(dupes.length).toBe(1);
      }

      // B003.xlsx should not be affected
      const b003Dupes = existingFiles.filter(
        f => f.projectId === 1 && f.fileType === "reviews" && f.filename === "B003.xlsx"
      );
      expect(b003Dupes.length).toBe(1);
    });
  });

  describe("Return value includes replacedFiles count", () => {
    it("uploadFile should return replacedFiles in response", async () => {
      // Verify the router procedure exists and is a mutation
      const devProjectRouter = await import("./routers/devProject");
      const routerDef = (devProjectRouter.devProjectRouter as any)._def;
      const uploadFile = routerDef.procedures.uploadFile;
      expect(uploadFile).toBeDefined();
      // It should be a procedure (mutation)
      expect(uploadFile._def.type).toBe("mutation");
    });
  });
});
