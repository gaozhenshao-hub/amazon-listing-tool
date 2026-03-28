import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("All route files use requestWithMockFallback", () => {
  const routersDir = path.join(__dirname, "routers");
  const routeFiles = fs.readdirSync(routersDir).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  // Files that are allowed to use adapter.request directly (for basic data like seller/lists)
  // Files allowed to use adapter.request directly for specific patterns
  const allowedDirectRequest: Record<string, string[]> = {
    "operations.ts": ["seller/lists"],
    "productOps.ts": ["seller/lists"],
    "adAnalysis.ts": ["seller/lists"],
    "systemSettings.ts": ["seller/lists", "test.path", "skipCache"],
  };

  for (const file of routeFiles) {
    it(`${file} should use requestWithMockFallback for API calls`, () => {
      const content = fs.readFileSync(path.join(routersDir, file), "utf-8");
      
      // Find all adapter.request( calls (not requestWithMockFallback)
      const directCalls = content.match(/adapter\.request\(/g) || [];
      const fallbackCalls = content.match(/adapter\.requestWithMockFallback\(/g) || [];
      
      if (directCalls.length > 0) {
        // Check if the file is in the allowed list
        const allowed = allowedDirectRequest[file];
        if (allowed) {
          // Count how many direct calls match allowed patterns
          const lines = content.split("\n");
          let allowedCount = 0;
          for (const line of lines) {
            if (line.includes("adapter.request(") && !line.includes("requestWithMockFallback")) {
              const isAllowed = allowed.some(pattern => {
                // Check if the nearby context contains the allowed pattern
                const lineIdx = lines.indexOf(line);
                const context = lines.slice(Math.max(0, lineIdx - 3), lineIdx + 3).join("\n");
                return context.includes(pattern);
              });
              if (!isAllowed) {
                // This is a non-allowed direct call
                expect.fail(`${file} has non-allowed adapter.request() call near: ${line.trim()}`);
              } else {
                allowedCount++;
              }
            }
          }
          // All direct calls should be in the allowed list
          expect(allowedCount).toBeLessThanOrEqual(directCalls.length);
        } else {
          // No direct calls allowed
          expect(directCalls.length).toBe(0);
        }
      }
      
      // If file has any API calls, it should have at least some fallback calls
      // (unless it only uses allowed direct calls)
      if (content.includes("adapter.") && !allowedDirectRequest[file]) {
        expect(fallbackCalls.length).toBeGreaterThan(0);
      }
    });
  }

  it("lingxingAdapter should have requestWithMockFallback method", () => {
    const adapterContent = fs.readFileSync(
      path.join(__dirname, "lingxingAdapter.ts"),
      "utf-8"
    );
    expect(adapterContent).toContain("requestWithMockFallback");
    expect(adapterContent).toContain("getMockData");
  });

  it("mock competitor data should include history fields", () => {
    const adapterContent = fs.readFileSync(
      path.join(__dirname, "lingxingAdapter.ts"),
      "utf-8"
    );
    expect(adapterContent).toContain("price_history");
    expect(adapterContent).toContain("review_history");
    expect(adapterContent).toContain("bsr_history");
  });
});
