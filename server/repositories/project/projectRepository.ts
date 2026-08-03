import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import type { InsertProject } from "../../../drizzle/schema";
import { competitorAnalyses, listings, projects, users } from "../../../drizzle/schema";
import { requireDb, withDbTransaction, type DbExecutor } from "../dbClient";

export async function createProject(data: InsertProject) {
  const db = await requireDb("Project repository");
  const result = await db.insert(projects).values(data);
  const insertId = result[0].insertId;
  const rows = await db.select().from(projects).where(eq(projects.id, insertId)).limit(1);
  return rows[0];
}

function workspaceCondition(workspaceId?: number | null) {
  if (workspaceId === undefined) return undefined;
  return workspaceId === null
    ? isNull(projects.workspaceId)
    : or(eq(projects.workspaceId, workspaceId), isNull(projects.workspaceId));
}

export async function getProjectsByUser(userId: number, workspaceId?: number | null) {
  const db = await requireDb("Project repository");
  const conditions = [eq(projects.userId, userId), workspaceCondition(workspaceId)].filter(Boolean) as any[];
  return db.select().from(projects).where(and(...conditions)).orderBy(desc(projects.updatedAt));
}

export async function getAllProjects(workspaceId?: number | null) {
  const db = await requireDb("Project repository");
  const scope = workspaceCondition(workspaceId);
  const rows = await db
    .select({
      id: projects.id,
      workspaceId: projects.workspaceId,
      name: projects.name,
      brand: projects.brand,
      productName: projects.productName,
      category: projects.category,
      targetMarket: projects.targetMarket,
      status: projects.status,
      userId: projects.userId,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(scope)
    .orderBy(desc(projects.updatedAt));

  const userIds = Array.from(new Set(rows.map((project) => project.userId)));
  if (userIds.length === 0) {
    return rows.map((project) => ({ ...project, ownerName: "未知用户" }));
  }

  const userRows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, userIds));
  const userMap = Object.fromEntries(userRows.map((user) => [user.id, user.name || "未知"]));

  return rows.map((project) => ({
    ...project,
    ownerName: userMap[project.userId] || "未知用户",
  }));
}

export async function getProjectById(id: number, userId: number, workspaceId?: number | null) {
  const db = await requireDb("Project repository");
  const conditions = [eq(projects.id, id), eq(projects.userId, userId), workspaceCondition(workspaceId)].filter(Boolean) as any[];
  const rows = await db
    .select()
    .from(projects)
    .where(and(...conditions))
    .limit(1);
  return rows[0] ?? null;
}

export async function getProjectByIdAdmin(id: number, workspaceId?: number | null) {
  const db = await requireDb("Project repository");
  const conditions = [eq(projects.id, id), workspaceCondition(workspaceId)].filter(Boolean) as any[];
  const rows = await db.select().from(projects).where(and(...conditions)).limit(1);
  return rows[0] ?? null;
}

export async function updateProject(id: number, userId: number, data: Partial<InsertProject>) {
  const db = await requireDb("Project repository");
  await db.update(projects).set(data).where(and(eq(projects.id, id), eq(projects.userId, userId)));
  return getProjectById(id, userId);
}

export async function deleteProject(id: number, userId: number) {
  return withDbTransaction("Project deletion", async (tx: DbExecutor) => {
    const ownedProject = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, userId)))
      .limit(1);

    if (ownedProject.length === 0) {
      return { success: false, deleted: false, reason: "project_not_found_or_not_owned" } as const;
    }

    await tx.delete(competitorAnalyses).where(eq(competitorAnalyses.projectId, id));
    await tx.delete(listings).where(eq(listings.projectId, id));
    await tx.delete(projects).where(and(eq(projects.id, id), eq(projects.userId, userId)));
    return { success: true, deleted: true } as const;
  });
}
