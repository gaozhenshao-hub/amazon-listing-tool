import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import {
  devProducts,
  devProfitCalculations,
  devProjectProgress,
  devProjects,
  devTimePlans,
  projectAssignments,
  users,
} from "../../../../drizzle/schema";
import { databaseUnavailableError } from "../../../_core/domainError";
import { getDb } from "../../../repositories/dbClient";
import type { ProjectProgressPatch } from "./projectListTypes";

export async function listProjectSources(
  workspaceId: number | null,
  actorUserId: number,
  includeWorkspaceProjects: boolean,
) {
  const db = await getDb();
  if (!db) throw databaseUnavailableError("product_development");
  const workspaceCondition = workspaceId === null
    ? and(isNull(devProjects.workspaceId), eq(devProjects.userId, actorUserId))
    : includeWorkspaceProjects
      ? or(
          eq(devProjects.workspaceId, workspaceId),
          and(isNull(devProjects.workspaceId), eq(devProjects.userId, actorUserId)),
        )
      : and(
          eq(devProjects.userId, actorUserId),
          or(eq(devProjects.workspaceId, workspaceId), isNull(devProjects.workspaceId)),
        );
  const projects = await db.select().from(devProjects)
    .where(workspaceCondition)
    .orderBy(desc(devProjects.updatedAt));
  if (projects.length === 0) {
    return { projects: [], progress: [], products: [], timePlans: [], profits: [], members: [] };
  }

  const projectIds = projects.map((project) => project.id);
  const ownerIds = Array.from(new Set(projects.map((project) => project.userId)));
  const [progress, products, timePlans, profits, assignments] = await Promise.all([
    db.select().from(devProjectProgress).where(inArray(devProjectProgress.projectId, projectIds)),
    db.select().from(devProducts).where(inArray(devProducts.projectId, projectIds)),
    db.select().from(devTimePlans).where(inArray(devTimePlans.projectId, projectIds)),
    db.select().from(devProfitCalculations)
      .where(inArray(devProfitCalculations.projectId, projectIds))
      .orderBy(desc(devProfitCalculations.updatedAt)),
    db.select().from(projectAssignments).where(and(
      eq(projectAssignments.projectType, "dev_project"),
      inArray(projectAssignments.projectId, projectIds),
    )),
  ]);
  const userIds = Array.from(new Set([
    ...ownerIds,
    ...assignments.map((assignment) => assignment.assignedUserId),
  ]));
  const userRows = userIds.length > 0
    ? await db.select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(inArray(users.id, userIds))
    : [];
  const userMap = new Map(userRows.map((user) => [user.id, user]));
  const members = assignments.flatMap((assignment) => {
    const user = userMap.get(assignment.assignedUserId);
    return user ? [{
      projectId: assignment.projectId,
      userId: user.id,
      name: user.name || `用户 ${user.id}`,
      role: user.role,
    }] : [];
  });

  return {
    projects: projects.map((project) => ({
      ...project,
      ownerName: userMap.get(project.userId)?.name || `用户 ${project.userId}`,
    })),
    progress,
    products,
    timePlans,
    profits,
    members,
  };
}

export async function upsertProjectProgress(args: {
  projectId: number;
  workspaceId: number | null;
  updatedBy: number;
  patch: ProjectProgressPatch;
}) {
  const db = await getDb();
  if (!db) throw databaseUnavailableError("product_development");
  await db.insert(devProjectProgress).values({
    projectId: args.projectId,
    workspaceId: args.workspaceId,
    updatedBy: args.updatedBy,
    ...args.patch,
  }).onDuplicateKeyUpdate({ set: {
    workspaceId: args.workspaceId,
    updatedBy: args.updatedBy,
    ...args.patch,
  }});
  const rows = await db.select().from(devProjectProgress)
    .where(eq(devProjectProgress.projectId, args.projectId))
    .limit(1);
  return rows[0];
}
