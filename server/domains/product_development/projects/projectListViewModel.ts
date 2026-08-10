import type { ProjectListSourceData } from "./projectListTypes";

function latestByProject<T extends { projectId: number | null; updatedAt: Date }>(rows: T[]) {
  const result = new Map<number, T>();
  for (const row of rows) {
    if (typeof row.projectId !== "number") continue;
    const current = result.get(row.projectId);
    if (!current || row.updatedAt.getTime() > current.updatedAt.getTime()) result.set(row.projectId, row);
  }
  return result;
}

function calculateExpectedLandingDate(createdAt: Date, plans: ProjectListSourceData["timePlans"]) {
  const totalDays = plans.reduce((latest, plan) => {
    const endDay = Math.max(0, plan.startOffset ?? 0) + Math.max(0, plan.estimatedDays ?? 0);
    return Math.max(latest, endDay);
  }, 0);
  if (totalDays === 0) return null;
  const result = new Date(createdAt);
  result.setUTCDate(result.getUTCDate() + totalDays);
  return result.toISOString();
}

function uniqueNames(names: Array<string | null | undefined>) {
  return Array.from(new Set(names.map((name) => name?.trim()).filter(Boolean) as string[]));
}

export function buildProjectListRows(source: ProjectListSourceData) {
  const progressByProject = new Map(source.progress.map((row) => [row.projectId, row]));
  const latestProfitByProject = latestByProject(source.profits);

  return source.projects.map((project) => {
    const progress = progressByProject.get(project.id);
    const projectMembers = source.members.filter((member) => member.projectId === project.id);
    const developerNames = uniqueNames([
      project.ownerName,
      ...projectMembers.filter((member) => member.role === "product_dev").map((member) => member.name),
    ]);
    const operatorNames = uniqueNames(
      projectMembers
        .filter((member) => member.role === "ops_manager" || member.role === "ops_specialist")
        .map((member) => member.name),
    );
    const asin = progress?.primaryCompetitorAsin?.trim().toUpperCase() || null;
    const competitor = asin
      ? source.products.find((product) => product.projectId === project.id && product.asin?.toUpperCase() === asin)
      : undefined;
    const profit = latestProfitByProject.get(project.id);
    const plans = source.timePlans.filter((plan) => plan.projectId === project.id);

    return {
      ...project,
      primaryCompetitorAsin: asin,
      primaryCompetitorImageUrl: competitor?.imageUrl ?? null,
      selectorName: progress?.selectorName ?? null,
      developerNames,
      operatorNames,
      landingProgress: progress?.landingProgress ?? 0,
      expectedLandingDate: calculateExpectedLandingDate(project.createdAt, plans),
      reviewStatus: project.approvedAt ? "approved" as const : progress?.reviewStatus ?? "unreviewed" as const,
      assistantName: progress?.assistantName ?? null,
      sellingPrice: profit?.sellingPrice ?? null,
      profit: profit?.profit ?? null,
      profitMargin: profit?.profitMargin ?? null,
    };
  });
}
