import { bigint, boolean, decimal, int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).unique(),
  organizationId: int("organizationId"),
  defaultWorkspaceId: int("defaultWorkspaceId"),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 20 }),
  password: varchar("password", { length: 256 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", [
    "super_admin", "admin", "ops_manager", "ops_specialist",
    "product_dev", "finance", "purchaser", "designer"
  ]).default("ops_specialist").notNull(),
  department: varchar("department", { length: 100 }),
  jobTitle: varchar("jobTitle", { length: 100 }),
  status: mysqlEnum("status", ["active", "disabled", "pending"]).default("active").notNull(),
  mustChangePassword: int("mustChangePassword").default(1),
  failedLoginAttempts: int("failedLoginAttempts").default(0),
  lockedUntil: timestamp("lockedUntil"),
  invitedBy: int("invitedBy"),
  lastPasswordChangedAt: timestamp("lastPasswordChangedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;

export type InsertUser = typeof users.$inferInsert;

// User role type for type-safe role checks
export type UserRole = "super_admin" | "admin" | "ops_manager" | "ops_specialist" | "product_dev" | "finance" | "purchaser" | "designer";

export const organizations = mysqlTable("organizations", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 128 }).unique().notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["active", "disabled"]).default("active").notNull(),
  ownerUserId: int("ownerUserId"),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Organization = typeof organizations.$inferSelect;

export type InsertOrganization = typeof organizations.$inferInsert;

export const workspaces = mysqlTable("workspaces", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId"),
  slug: varchar("slug", { length: 128 }).unique().notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["active", "archived", "disabled"]).default("active").notNull(),
  ownerUserId: int("ownerUserId"),
  defaultRole: varchar("defaultRole", { length: 64 }).default("ops_specialist"),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Workspace = typeof workspaces.$inferSelect;

export type InsertWorkspace = typeof workspaces.$inferInsert;

export const workspaceMemberships = mysqlTable("workspace_memberships", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId").notNull(),
  userId: int("userId").notNull(),
  role: varchar("role", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["active", "disabled", "invited"]).default("active").notNull(),
  permissions: json("permissions"),
  invitedBy: int("invitedBy"),
  joinedAt: timestamp("joinedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type WorkspaceMembership = typeof workspaceMemberships.$inferSelect;

export type InsertWorkspaceMembership = typeof workspaceMemberships.$inferInsert;

export const securityAccessPolicies = mysqlTable("security_access_policies", {
  id: int("id").autoincrement().primaryKey(),
  policyId: varchar("policyId", { length: 80 }).unique().notNull(),
  workspaceId: int("workspaceId"),
  resourceType: varchar("resourceType", { length: 64 }).notNull(),
  resourceId: varchar("resourceId", { length: 128 }),
  action: varchar("action", { length: 64 }).notNull(),
  effect: mysqlEnum("effect", ["allow", "deny"]).default("allow").notNull(),
  principalType: mysqlEnum("principalType", ["role", "user", "workspace_member"]).notNull(),
  principalId: varchar("principalId", { length: 128 }).notNull(),
  conditions: json("conditions"),
  status: mysqlEnum("status", ["active", "disabled"]).default("active").notNull(),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SecurityAccessPolicy = typeof securityAccessPolicies.$inferSelect;

export type InsertSecurityAccessPolicy = typeof securityAccessPolicies.$inferInsert;

export const securityAuditLogs = mysqlTable("security_audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  auditId: varchar("auditId", { length: 80 }).unique().notNull(),
  workspaceId: int("workspaceId"),
  actorUserId: int("actorUserId"),
  actorRole: varchar("actorRole", { length: 64 }),
  action: varchar("action", { length: 80 }).notNull(),
  resourceType: varchar("resourceType", { length: 64 }).notNull(),
  resourceId: varchar("resourceId", { length: 128 }),
  resourceName: varchar("resourceName", { length: 255 }),
  projectId: int("projectId"),
  agentRunId: varchar("agentRunId", { length: 80 }),
  toolSlug: varchar("toolSlug", { length: 128 }),
  status: mysqlEnum("status", ["success", "denied", "failed"]).default("success").notNull(),
  riskLevel: mysqlEnum("riskLevel", ["low", "medium", "high", "critical"]).default("medium").notNull(),
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: varchar("userAgent", { length: 512 }),
  requestId: varchar("requestId", { length: 128 }),
  reason: text("reason"),
  beforeSnapshot: json("beforeSnapshot"),
  afterSnapshot: json("afterSnapshot"),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SecurityAuditLog = typeof securityAuditLogs.$inferSelect;

export type InsertSecurityAuditLog = typeof securityAuditLogs.$inferInsert;

// Login logs table
export const loginLogs = mysqlTable("login_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  loginMethod: mysqlEnum("loginMethod", ["password", "oauth"]).notNull(),
  loginIdentifier: varchar("loginIdentifier", { length: 320 }),
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: varchar("userAgent", { length: 512 }),
  success: int("success").notNull(),
  failReason: varchar("failReason", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LoginLog = typeof loginLogs.$inferSelect;

export type InsertLoginLog = typeof loginLogs.$inferInsert;

// Usage statistics table (daily per-user aggregation)
export const usageStats = mysqlTable("usage_stats", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  statDate: varchar("statDate", { length: 10 }).notNull(),
  aiCallCount: int("aiCallCount").default(0),
  aiTokensUsed: bigint("aiTokensUsed", { mode: "number" }).default(0),
  scraperCallCount: int("scraperCallCount").default(0),
  storageUsedBytes: bigint("storageUsedBytes", { mode: "number" }).default(0),
  apiCallCount: int("apiCallCount").default(0),
  loginCount: int("loginCount").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UsageStat = typeof usageStats.$inferSelect;

export type InsertUsageStat = typeof usageStats.$inferInsert;

// Role permissions configuration (dynamic, stored in DB)
export const rolePermissions = mysqlTable("role_permissions", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  role: varchar("role", { length: 50 }).notNull().unique(),
  modules: text("modules").notNull(), // JSON array of module IDs
  detailedPermissions: text("detailedPermissions"), // JSON: ModulePermission[] with operations & sub-modules
  description: varchar("description", { length: 200 }),
  updatedBy: int("updatedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type RolePermission = typeof rolePermissions.$inferSelect;

export type InsertRolePermission = typeof rolePermissions.$inferInsert;

// Project assignments (admin assigns projects to team members)
export const projectAssignments = mysqlTable("project_assignments", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  projectId: int("projectId").notNull(),
  projectType: mysqlEnum("projectType", ["dev_project", "listing_project"]).default("dev_project").notNull(),
  assignedUserId: int("assignedUserId").notNull(),
  assignedBy: int("assignedBy").notNull(),
  permission: mysqlEnum("permission", ["read", "write"]).default("read").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ProjectAssignment = typeof projectAssignments.$inferSelect;

export type InsertProjectAssignment = typeof projectAssignments.$inferInsert;

// SOP access grants
export const sopAccessGrants = mysqlTable("sop_access_grants", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  skillLevel: mysqlEnum("skillLevel", ["intermediate", "advanced"]).notNull(),
  grantedBy: int("grantedBy").notNull(),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SopAccessGrant = typeof sopAccessGrants.$inferSelect;

export type InsertSopAccessGrant = typeof sopAccessGrants.$inferInsert;

// In-app notifications for review workflow
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // recipient
  type: mysqlEnum("type", [
    "review_submitted", "review_approved", "review_rejected",
    "project_assigned", "system_alert", "todo_due_soon", "todo_overdue"
  ]).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  content: text("content"),
  relatedType: varchar("relatedType", { length: 50 }), // e.g., "kb_product", "kb_listing"
  relatedId: int("relatedId"), // ID of the related item
  isRead: int("isRead").default(0).notNull(), // 0=unread, 1=read
  createdBy: int("createdBy"), // who triggered the notification
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;

export type InsertNotification = typeof notifications.$inferInsert;

// ============== User Settings (Global Preferences) ==============
export const userSettings = mysqlTable("user_settings", {
  workspaceId: int("workspaceId"),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  settingKey: varchar("setting_key", { length: 100 }).notNull(),
  settingValue: text("setting_value"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export type UserSetting = typeof userSettings.$inferSelect;

export type InsertUserSetting = typeof userSettings.$inferInsert;
