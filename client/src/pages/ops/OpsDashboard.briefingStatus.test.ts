import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const ui = readFileSync(new URL("./OpsDashboard.tsx", import.meta.url), "utf8");
const upgradeUi = readFileSync(new URL("./OpsDashboardUpgrade.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../../../../server/routers/dashboardUpgrade.ts", import.meta.url), "utf8");

describe("运营简报占位状态", () => {
  it("后端当前返回 import_required，前端不得将它展示为已生成简报", () => {
    expect(api).toContain('status: "import_required"');
    expect(ui).toContain('briefingMutation.data?.status === "import_required"');
    expect(ui).not.toContain('briefingMutation.data.status !== "import_required"');
    expect(ui).not.toContain("briefingMutation.data.salesSummary");
    expect(ui).toContain("尚未生成 AI 简报");
    expect(ui).toContain('setLocation("/ops/data-import")');
    expect(upgradeUi).toContain('briefingMutation.data?.status === "import_required"');
    expect(upgradeUi).not.toContain("briefingMutation.data.salesSummary");
  });
});
