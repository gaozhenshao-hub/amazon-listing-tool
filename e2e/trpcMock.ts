import type { Page, Route } from "@playwright/test";

const USER = {
  id: 1,
  name: "E2E 管理员",
  email: "e2e@example.com",
  role: "super_admin",
};

function fixtureFor(procedure: string): unknown {
  const fixtures: Record<string, unknown> = {
    "auth.me": USER,
    "roleManagement.myPermissions": { modules: [], detailedPermissions: [] },
    "operations.getMarketplaces": [{ code: "US", name: "美国", region: "NA", sids: [], storeNames: [] }],
    "operations.getUserSettings": { default_marketplace: "US" },
    "project.getById": { id: 1, name: "E2E 空气套件", brand: "E2E Brand", marketplace: "US" },
    "devProject.getById": { id: 1, name: "E2E 空气套件", status: "analyzing" },
    "devProject.getProducts": [],
    "devAnalysis.getStages": [],
    "devAnalysis.getStageGating": {},
    "devAnalysis.getConfirmedProjectTags": [],
    "projectFile.getAnalysisSummary": null,
    "reviewAggregation.get": null,
    "keyword.stats": { total: 0 },
    "buyerQuestions.getReadiness": null,
    "imageWorkflow.getSession": null,
    "adStructure.getByProject": [],
    "adStructure.estimateTargeting": null,
    "videoScript.list": [],
    "aiJobs.list": [],
    "emperor.agents.listProjectRuns": [],
    "emperor.agents.listRuns": [],
  };
  if (procedure in fixtures) return fixtures[procedure];
  if (
    procedure.endsWith(".list")
    || procedure.includes("listByProject")
    || procedure.includes("getVersions")
    || procedure.includes("getSections")
    || procedure.includes("getShots")
    || procedure.includes("getSubtopics")
    || procedure.includes("getCompetitorScripts")
  ) return [];
  return null;
}

async function fulfillTrpc(route: Route) {
  const requestUrl = new URL(route.request().url());
  const encodedPath = requestUrl.pathname.split("/api/trpc/")[1] || "";
  const procedures = decodeURIComponent(encodedPath).split(",").filter(Boolean);
  const payload = procedures.map((procedure) => ({
    result: { data: { json: fixtureFor(procedure) } },
  }));
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

export async function installRealPageFixtures(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("selectedProjectId", "1");
  });
  await page.route("**/api/trpc/**", fulfillTrpc);
}
