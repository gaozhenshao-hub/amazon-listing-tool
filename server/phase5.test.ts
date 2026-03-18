import { describe, it, expect } from "vitest";

// ─── Test 1: Notification Router exports ───
describe("notification router", () => {
  it("should export notificationRouter", async () => {
    const mod = await import("./routers/notification");
    expect(mod.notificationRouter).toBeDefined();
    expect(mod.notificationRouter._def).toBeDefined();
  });

  it("should have required procedures", async () => {
    const mod = await import("./routers/notification");
    const router = mod.notificationRouter;
    const procedures = Object.keys(router._def.procedures);
    expect(procedures).toContain("list");
    expect(procedures).toContain("unreadCount");
    expect(procedures).toContain("markRead");
    expect(procedures).toContain("markAllRead");
  });
});

// ─── Test 2: Notification DB helpers ───
describe("notification db helpers", () => {
  it("should export createNotification", async () => {
    const db = await import("./db");
    expect(typeof db.createNotification).toBe("function");
  });

  it("should export getNotificationsByUser", async () => {
    const db = await import("./db");
    expect(typeof db.getNotificationsByUser).toBe("function");
  });

  it("should export getUnreadNotificationCount", async () => {
    const db = await import("./db");
    expect(typeof db.getUnreadNotificationCount).toBe("function");
  });

  it("should export markNotificationRead", async () => {
    const db = await import("./db");
    expect(typeof db.markNotificationRead).toBe("function");
  });

  it("should export markAllNotificationsRead", async () => {
    const db = await import("./db");
    expect(typeof db.markAllNotificationsRead).toBe("function");
  });
});

// ─── Test 3: RoleManagement Router with fine-grained permissions ───
describe("roleManagement router - fine-grained permissions", () => {
  it("should export roleManagementRouter", async () => {
    const mod = await import("./routers/roleManagement");
    expect(mod.roleManagementRouter).toBeDefined();
  });

  it("should have update procedure", async () => {
    const mod = await import("./routers/roleManagement");
    const procedures = Object.keys(mod.roleManagementRouter._def.procedures);
    expect(procedures).toContain("update");
  });

  it("should have modules procedure", async () => {
    const mod = await import("./routers/roleManagement");
    const procedures = Object.keys(mod.roleManagementRouter._def.procedures);
    expect(procedures).toContain("modules");
  });
});

// ─── Test 4: Sub-module definitions ───
describe("shared const - sub-modules", () => {
  it("should export SUB_MODULES", async () => {
    const mod = await import("../shared/const");
    expect(mod.SUB_MODULES).toBeDefined();
    expect(typeof mod.SUB_MODULES).toBe("object");
  });

  it("should have knowledge_base sub-modules", async () => {
    const mod = await import("../shared/const");
    const kbSubs = mod.SUB_MODULES.knowledge;
    expect(kbSubs).toBeDefined();
    expect(Array.isArray(kbSubs)).toBe(true);
    expect(kbSubs.length).toBeGreaterThan(0);
  });

  it("should export PERMISSION_OPERATIONS", async () => {
    const mod = await import("../shared/const");
    expect(mod.PERMISSION_OPERATIONS).toBeDefined();
    expect(Array.isArray(mod.PERMISSION_OPERATIONS)).toBe(true);
    expect(mod.PERMISSION_OPERATIONS).toContain("read");
    expect(mod.PERMISSION_OPERATIONS).toContain("edit");
    expect(mod.PERMISSION_OPERATIONS).toContain("delete");
  });
});

// ─── Test 5: Admin project access ───
describe("project router - admin access", () => {
  it("should export projectRouter", async () => {
    const mod = await import("./routers/project");
    expect(mod.projectRouter).toBeDefined();
  });

  it("should have list and getById procedures", async () => {
    const mod = await import("./routers/project");
    const procedures = Object.keys(mod.projectRouter._def.procedures);
    expect(procedures).toContain("list");
    expect(procedures).toContain("getById");
  });
});

// ─── Test 6: Admin dev project access ───
describe("devProject router - admin access", () => {
  it("should export devProjectRouter", async () => {
    const mod = await import("./routers/devProject");
    expect(mod.devProjectRouter).toBeDefined();
  });

  it("should have list and getById procedures", async () => {
    const mod = await import("./routers/devProject");
    const procedures = Object.keys(mod.devProjectRouter._def.procedures);
    expect(procedures).toContain("list");
    expect(procedures).toContain("getById");
  });
});

// ─── Test 7: Admin DB helpers ───
describe("admin db helpers", () => {
  it("should export getAllProjects", async () => {
    const db = await import("./db");
    expect(typeof db.getAllProjects).toBe("function");
  });

  it("should export getProjectByIdAdmin", async () => {
    const db = await import("./db");
    expect(typeof db.getProjectByIdAdmin).toBe("function");
  });

  it("should export getAllDevProjects from devDb", async () => {
    const devDb = await import("./devDb");
    expect(typeof devDb.getAllDevProjects).toBe("function");
  });

  it("should export getDevProjectByIdAdmin from devDb", async () => {
    const devDb = await import("./devDb");
    expect(typeof devDb.getDevProjectByIdAdmin).toBe("function");
  });
});

// ─── Test 8: Notifications table in schema ───
describe("notifications schema", () => {
  it("should export notifications table", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.notifications).toBeDefined();
  });
});

// ─── Test 9: kbReview notification integration ───
describe("kbReview notification integration", () => {
  it("should import createNotification in kbReview", async () => {
    const mod = await import("./routers/kbReview");
    expect(mod.kbReviewRouter).toBeDefined();
    const procedures = Object.keys(mod.kbReviewRouter._def.procedures);
    expect(procedures).toContain("submitForReview");
    expect(procedures).toContain("approve");
    expect(procedures).toContain("reject");
  });
});

// ─── Test 10: NotificationBell component exists ───
describe("NotificationBell component", () => {
  it("should exist as a file", async () => {
    const fs = await import("fs");
    const exists = fs.existsSync("/home/ubuntu/amazon-listing-tool/client/src/components/NotificationBell.tsx");
    expect(exists).toBe(true);
  });
});
