import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { ENV } from "../../_core/env";
import { getDb } from "../dbClient";
import { devProjects, projects } from "../../../drizzle/schema/project";
import { kbImageSets } from "../../../drizzle/schema/image";
import { kbListingCopywriting, kbOperationSkills, kbProductInnovations, kbVideos } from "../../../drizzle/schema/knowledge";
import { productProfiles } from "../../../drizzle/schema/ops";
import { InsertLoginLog, InsertNotification, InsertUser, loginLogs, notifications, organizations, rolePermissions, users, workspaceMemberships, workspaces } from "../../../drizzle/schema/auth";

// --- Review Import Helpers ---

function isMissingTenantSchema(error: unknown) {
  return /doesn't exist|unknown column|no such table|no such column/i.test(String((error as Error).message));
}

async function ensureDefaultWorkspaceForUser(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, user: InsertUser): Promise<void> {
  const identityConditions = [
    user.openId ? eq(users.openId, user.openId) : null,
    user.email ? eq(users.email, user.email) : null,
    user.phone ? eq(users.phone, user.phone) : null,
  ].filter(Boolean) as any[];

  if (identityConditions.length === 0) return;

  try {
    await db.execute(sql`
      INSERT INTO organizations (slug, name, status, metadata)
      VALUES ('default', 'Default Organization', 'active', JSON_OBJECT('createdByRuntime', 'upsertUser'))
      ON DUPLICATE KEY UPDATE updatedAt = updatedAt
    `);
    await db.execute(sql`
      INSERT INTO workspaces (organizationId, slug, name, status, metadata)
      SELECT id, 'default', 'Default Workspace', 'active', JSON_OBJECT('createdByRuntime', 'upsertUser')
      FROM organizations
      WHERE slug = 'default'
      ON DUPLICATE KEY UPDATE updatedAt = updatedAt
    `);

    const userRows = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(or(...identityConditions))
      .limit(1);
    const targetUser = userRows[0];
    if (!targetUser) return;

    const workspaceRows = await db
      .select({ id: workspaces.id, organizationId: workspaces.organizationId })
      .from(workspaces)
      .where(eq(workspaces.slug, "default"))
      .limit(1);
    const defaultWorkspace = workspaceRows[0];
    if (!defaultWorkspace) return;

    await db.update(users).set({
      organizationId: defaultWorkspace.organizationId ?? null,
      defaultWorkspaceId: defaultWorkspace.id,
    }).where(and(eq(users.id, targetUser.id), isNull(users.defaultWorkspaceId)));

    await db.insert(workspaceMemberships).values({
      workspaceId: defaultWorkspace.id,
      userId: targetUser.id,
      role: user.role || targetUser.role,
      status: "active",
      joinedAt: new Date(),
    }).onDuplicateKeyUpdate({
      set: {
        role: user.role || targetUser.role,
        status: "active",
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    if (!isMissingTenantSchema(error)) {
      console.warn("[Database] Failed to ensure default workspace membership:", error);
    }
  }
}

export async function upsertUser(user: InsertUser): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {};
    if (user.openId) values.openId = user.openId;
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod", "phone", "department", "jobTitle"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      (values as any)[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId && user.openId === ENV.ownerOpenId) {
      values.role = 'super_admin';
      updateSet.role = 'super_admin';
    }
    if (user.password !== undefined) {
      values.password = user.password;
      updateSet.password = user.password;
    }
    if (user.status !== undefined) {
      values.status = user.status;
      updateSet.status = user.status;
    }
    if (user.mustChangePassword !== undefined) {
      values.mustChangePassword = user.mustChangePassword;
      updateSet.mustChangePassword = user.mustChangePassword;
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    if (user.openId) {
      await db.insert(users).values(values).onDuplicateKeyUpdate({
        set: updateSet,
      });
    } else {
      // Password-based user without openId
      await db.insert(users).values(values);
    }
    await ensureDefaultWorkspaceForUser(db, { ...user, ...values });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByEmailOrPhone(identifier: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(
    or(eq(users.email, identifier), eq(users.phone, identifier))
  ).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: users.id,
    openId: users.openId,
    name: users.name,
    email: users.email,
    phone: users.phone,
    role: users.role,
    department: users.department,
    jobTitle: users.jobTitle,
    status: users.status,
    mustChangePassword: users.mustChangePassword,
    invitedBy: users.invitedBy,
    createdAt: users.createdAt,
    lastSignedIn: users.lastSignedIn,
  }).from(users).orderBy(users.createdAt);
}

export async function updateUserById(userId: number, data: Partial<InsertUser>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set(data).where(eq(users.id, userId));
}

export async function updateLoginAttempts(userId: number, attempts: number, lockedUntil: Date | null) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({
    failedLoginAttempts: attempts,
    lockedUntil,
  }).where(eq(users.id, userId));
}

export async function insertLoginLog(log: InsertLoginLog) {
  const db = await getDb();
  if (!db) return;
  await db.insert(loginLogs).values(log);
}

export async function getLoginLogs(limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(loginLogs).orderBy(desc(loginLogs.createdAt)).limit(limit);
}

// --- Role Permissions Helpers --------------------------------------

export async function getAllRolePermissions() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(rolePermissions).orderBy(rolePermissions.role);
}

export async function getRolePermission(role: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(rolePermissions).where(eq(rolePermissions.role, role)).limit(1);
  return rows[0] || null;
}

export async function upsertRolePermission(
  role: string,
  modules: string[],
  description: string | null,
  updatedBy: number | null,
  detailedPerms?: any[] | null
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await getRolePermission(role);
  const setData: any = {
    modules: JSON.stringify(modules),
    description,
    updatedBy,
  };
  if (detailedPerms !== undefined) {
    setData.detailedPermissions = detailedPerms ? JSON.stringify(detailedPerms) : null;
  }
  if (existing) {
    await db.update(rolePermissions).set(setData).where(eq(rolePermissions.role, role));
  } else {
    await db.insert(rolePermissions).values({
      role,
      modules: JSON.stringify(modules),
      detailedPermissions: detailedPerms ? JSON.stringify(detailedPerms) : null,
      description,
      updatedBy,
    });
  }
}

// --- Notifications ---
export async function createNotification(data: InsertNotification) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(notifications).values(data);
  return { id: result[0].insertId };
}

export async function createBulkNotifications(items: InsertNotification[]) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  if (items.length === 0) return;
  await db.insert(notifications).values(items);
}

export async function getNotificationsByUser(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function getUnreadNotificationCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select().from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, 0)));
  return rows.length;
}

export async function markNotificationRead(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(notifications).set({ isRead: 1 })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
}

export async function markAllNotificationsRead(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(notifications).set({ isRead: 1 })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, 0)));
}

// Get admin/manager users for notification targeting
export async function getAdminUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(
      or(
        eq(users.role, "super_admin"),
        eq(users.role, "admin"),
        eq(users.role, "ops_manager")
      ),
      eq(users.status, "active")
    ));
}

export async function getUserDataCounts(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [projectCount] = await db.select({ count: sql<number>`count(*)` }).from(projects).where(eq(projects.userId, userId));
  const [devProjectCount] = await db.select({ count: sql<number>`count(*)` }).from(devProjects).where(eq(devProjects.userId, userId));
  const [kbImageSetCount] = await db.select({ count: sql<number>`count(*)` }).from(kbImageSets).where(eq(kbImageSets.userId, userId));
  const [kbCopywritingCount] = await db.select({ count: sql<number>`count(*)` }).from(kbListingCopywriting).where(eq(kbListingCopywriting.userId, userId));
  const [kbInnovationCount] = await db.select({ count: sql<number>`count(*)` }).from(kbProductInnovations).where(eq(kbProductInnovations.userId, userId));
  const [kbSkillCount] = await db.select({ count: sql<number>`count(*)` }).from(kbOperationSkills).where(eq(kbOperationSkills.userId, userId));
  const [kbVideoCount] = await db.select({ count: sql<number>`count(*)` }).from(kbVideos).where(eq(kbVideos.userId, userId));
  const [productCount] = await db.select({ count: sql<number>`count(*)` }).from(productProfiles).where(eq(productProfiles.userId, userId));

  return {
    projects: Number(projectCount.count),
    devProjects: Number(devProjectCount.count),
    kbImageSets: Number(kbImageSetCount.count),
    kbCopywriting: Number(kbCopywritingCount.count),
    kbInnovations: Number(kbInnovationCount.count),
    kbSkills: Number(kbSkillCount.count),
    kbVideos: Number(kbVideoCount.count),
    products: Number(productCount.count),
  };
}

export async function transferUserData(fromUserId: number, toUserId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(projects).set({ userId: toUserId }).where(eq(projects.userId, fromUserId));
  await db.update(devProjects).set({ userId: toUserId }).where(eq(devProjects.userId, fromUserId));
  await db.update(kbImageSets).set({ userId: toUserId }).where(eq(kbImageSets.userId, fromUserId));
  await db.update(kbListingCopywriting).set({ userId: toUserId }).where(eq(kbListingCopywriting.userId, fromUserId));
  await db.update(kbProductInnovations).set({ userId: toUserId }).where(eq(kbProductInnovations.userId, fromUserId));
  await db.update(kbOperationSkills).set({ userId: toUserId }).where(eq(kbOperationSkills.userId, fromUserId));
  await db.update(kbVideos).set({ userId: toUserId }).where(eq(kbVideos.userId, fromUserId));
  await db.update(productProfiles).set({ userId: toUserId }).where(eq(productProfiles.userId, fromUserId));
}

export async function deleteUserById(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Delete login logs
  await db.delete(loginLogs).where(eq(loginLogs.userId, userId));
  // Delete notifications
  await db.delete(notifications).where(eq(notifications.userId, userId));
  // Delete user
  await db.delete(users).where(eq(users.id, userId));
}
