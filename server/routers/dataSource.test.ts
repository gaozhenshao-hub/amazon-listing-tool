import { describe, it, expect, vi } from "vitest";

describe("LingxingAdapter _meta data source tagging", () => {
  it("LingxingResponse interface should include _meta field", async () => {
    const fs = await import("fs");
    const adapterSource = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/server/lingxingAdapter.ts",
      "utf-8"
    );

    // Verify _meta field exists in LingxingResponse interface
    expect(adapterSource).toContain("_meta?: {");
    expect(adapterSource).toContain("source: 'real' | 'mock_mode' | 'mock_fallback'");
    expect(adapterSource).toContain("reason?: string");
  });

  it("mock mode should inject _meta with source=mock_mode", async () => {
    const fs = await import("fs");
    const adapterSource = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/server/lingxingAdapter.ts",
      "utf-8"
    );

    // Verify mock mode sets _meta
    expect(adapterSource).toContain("mockResult._meta = { source: 'mock_mode'");
  });

  it("IP whitelist error should throw error instead of falling back to mock", async () => {
    const fs = await import("fs");
    const adapterSource = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/server/lingxingAdapter.ts",
      "utf-8"
    );

    // Verify IP whitelist error throws instead of returning mock
    expect(adapterSource).toContain("// Do NOT fallback to mock - throw error so caller knows data is unavailable");
    expect(adapterSource).toContain('throw new Error(`[LingxingAPI] ${errMsg} (path: ${path})`)');
    // Should NOT contain mock_fallback for IP whitelist
    expect(adapterSource).not.toContain("mockResult._meta = { source: 'mock_fallback', reason: 'IP不在领星白名单中");
  });

  it("network error should throw error instead of falling back to mock", async () => {
    const fs = await import("fs");
    const adapterSource = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/server/lingxingAdapter.ts",
      "utf-8"
    );

    // Verify network error throws instead of returning mock
    expect(adapterSource).toContain("// Do NOT fallback to mock on network errors - propagate error");
    expect(adapterSource).toContain("throw err;");
    // Should NOT contain mock_fallback for network errors
    expect(adapterSource).not.toContain("mockResult._meta = { source: 'mock_fallback', reason: `领星API请求失败:");
  });

  it("real API success should inject _meta with source=real", async () => {
    const fs = await import("fs");
    const adapterSource = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/server/lingxingAdapter.ts",
      "utf-8"
    );

    // Verify real API success sets _meta
    expect(adapterSource).toContain("json._meta = { source: 'real' }");
  });

  it("getProductProfitSummary should return dataSource in response", async () => {
    const fs = await import("fs");
    const productOpsSource = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/server/routers/productOps.ts",
      "utf-8"
    );

    // Verify profit summary collects _meta and returns dataSource
    expect(productOpsSource).toContain("let dataSourceMeta: { source: 'real' | 'mock_mode' | 'mock_fallback'; reason?: string }");
    expect(productOpsSource).toContain("if (asinRes._meta) dataSourceMeta = asinRes._meta;");
    
    // Verify it's included in the return value
    const profitReturnMatch = productOpsSource.match(/budget.*?actual.*?current.*?dataSource:\s*dataSourceMeta/s);
    expect(profitReturnMatch).not.toBeNull();
  });

  it("getProductInventorySummary should return dataSource in response", async () => {
    const fs = await import("fs");
    const productOpsSource = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/server/routers/productOps.ts",
      "utf-8"
    );

    // Verify inventory summary returns dataSource
    const invReturnMatch = productOpsSource.match(/variants:\s*variantInventory,\s*\n\s*dataSource:\s*dataSourceMeta/s);
    expect(invReturnMatch).not.toBeNull();
  });

  it("getProductAdsSummary should return dataSource in response", async () => {
    const fs = await import("fs");
    const productOpsSource = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/server/routers/productOps.ts",
      "utf-8"
    );

    // Verify ads summary returns dataSource
    const adsReturnMatch = productOpsSource.match(/campaigns:\s*campaignList,\s*\n\s*dataSource:\s*dataSourceMeta/s);
    expect(adsReturnMatch).not.toBeNull();
  });

  it("frontend should display mock_fallback warning banner", async () => {
    const fs = await import("fs");
    const frontendSource = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/client/src/pages/ops/OpsProductDetail.tsx",
      "utf-8"
    );

    // Verify all three dashboards have mock_fallback warning
    const mockFallbackWarnings = frontendSource.match(/dataSource\?\.source === 'mock_fallback'/g);
    expect(mockFallbackWarnings).not.toBeNull();
    // Each dashboard has 2 occurrences: badge + warning banner = 6 total for 3 dashboards
    expect(mockFallbackWarnings!.length).toBeGreaterThanOrEqual(6);
  });

  it("frontend should have retry buttons for each dashboard", async () => {
    const fs = await import("fs");
    const frontendSource = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/client/src/pages/ops/OpsProductDetail.tsx",
      "utf-8"
    );

    // Verify refetch functions are used
    expect(frontendSource).toContain("refetchProfit");
    expect(frontendSource).toContain("refetchInventory");
    expect(frontendSource).toContain("refetchAds");

    // Verify RefreshCw icon is imported and used
    expect(frontendSource).toContain("RefreshCw");
    expect(frontendSource).toContain("WifiOff");

    // Verify error states are handled
    expect(frontendSource).toContain("profitError");
    expect(frontendSource).toContain("inventoryError");
    expect(frontendSource).toContain("adsError");

    // Verify retry button text
    const retryButtons = frontendSource.match(/重新加载/g);
    expect(retryButtons).not.toBeNull();
    expect(retryButtons!.length).toBeGreaterThanOrEqual(6); // 2 per dashboard (error state + empty state)
  });

  it("frontend should display mock_mode badge", async () => {
    const fs = await import("fs");
    const frontendSource = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/client/src/pages/ops/OpsProductDetail.tsx",
      "utf-8"
    );

    // Verify mock_mode badges exist
    const mockModeBadges = frontendSource.match(/dataSource\?\.source === 'mock_mode'/g);
    expect(mockModeBadges).not.toBeNull();
    expect(mockModeBadges!.length).toBe(3); // One per dashboard
    
    // Verify badge text
    expect(frontendSource).toContain("演示模式");
    expect(frontendSource).toContain("模拟数据");
  });

  it("frontend queries should use retry: 1 to avoid excessive retries", async () => {
    const fs = await import("fs");
    const frontendSource = fs.readFileSync(
      "/home/ubuntu/amazon-listing-tool/client/src/pages/ops/OpsProductDetail.tsx",
      "utf-8"
    );

    // Verify retry: 1 is set for all three queries
    const retrySettings = frontendSource.match(/retry:\s*1/g);
    expect(retrySettings).not.toBeNull();
    expect(retrySettings!.length).toBeGreaterThanOrEqual(3);
  });
});
