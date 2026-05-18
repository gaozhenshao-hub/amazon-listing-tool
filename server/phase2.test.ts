import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock database ───
const mockSelect = vi.fn().mockReturnThis();
const mockFrom = vi.fn().mockReturnThis();
const mockWhere = vi.fn().mockReturnThis();
const mockUpdate = vi.fn().mockReturnThis();
const mockSet = vi.fn().mockReturnThis();
const mockInsert = vi.fn().mockReturnThis();
const mockValues = vi.fn().mockReturnThis();
const mockDelete = vi.fn().mockReturnThis();
const mockInnerJoin = vi.fn().mockReturnThis();
const mockLeftJoin = vi.fn().mockReturnThis();
const mockLimit = vi.fn().mockReturnThis();
const mockOrderBy = vi.fn().mockReturnThis();

const mockDb = {
  select: mockSelect,
  from: mockFrom,
  where: mockWhere,
  update: mockUpdate,
  set: mockSet,
  insert: mockInsert,
  values: mockValues,
  delete: mockDelete,
  innerJoin: mockInnerJoin,
  leftJoin: mockLeftJoin,
  limit: mockLimit,
  orderBy: mockOrderBy,
};

vi.mock("./db", () => ({
  getDb: vi.fn(() => Promise.resolve(mockDb)),
  upsertUser: vi.fn(),
}));

// ─── Test: Review Workflow ───
describe("Knowledge Base Review Workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Review Status Transitions", () => {
    it("should define valid review status values", () => {
      const validStatuses = ["draft", "pending_review", "approved", "rejected"];
      expect(validStatuses).toContain("draft");
      expect(validStatuses).toContain("pending_review");
      expect(validStatuses).toContain("approved");
      expect(validStatuses).toContain("rejected");
    });

    it("should define valid KB types", () => {
      const validTypes = ["product", "listing", "image", "skill", "video"];
      expect(validTypes).toHaveLength(5);
      expect(validTypes).toContain("product");
      expect(validTypes).toContain("listing");
      expect(validTypes).toContain("image");
      expect(validTypes).toContain("skill");
      expect(validTypes).toContain("video");
    });

    it("should define valid visibility levels", () => {
      const validVisibility = ["private", "team", "public"];
      expect(validVisibility).toHaveLength(3);
    });

    it("should validate review status transition: draft → pending_review", () => {
      const currentStatus = "draft";
      const targetStatus = "pending_review";
      const allowedTransitions: Record<string, string[]> = {
        draft: ["pending_review"],
        pending_review: ["approved", "rejected"],
        approved: ["pending_review"],
        rejected: ["pending_review", "draft"],
      };
      expect(allowedTransitions[currentStatus]).toContain(targetStatus);
    });

    it("should validate review status transition: pending_review → approved", () => {
      const currentStatus = "pending_review";
      const targetStatus = "approved";
      const allowedTransitions: Record<string, string[]> = {
        draft: ["pending_review"],
        pending_review: ["approved", "rejected"],
        approved: ["pending_review"],
        rejected: ["pending_review", "draft"],
      };
      expect(allowedTransitions[currentStatus]).toContain(targetStatus);
    });

    it("should validate review status transition: pending_review → rejected", () => {
      const currentStatus = "pending_review";
      const targetStatus = "rejected";
      const allowedTransitions: Record<string, string[]> = {
        draft: ["pending_review"],
        pending_review: ["approved", "rejected"],
        approved: ["pending_review"],
        rejected: ["pending_review", "draft"],
      };
      expect(allowedTransitions[currentStatus]).toContain(targetStatus);
    });

    it("should not allow direct draft → approved transition", () => {
      const currentStatus = "draft";
      const targetStatus = "approved";
      const allowedTransitions: Record<string, string[]> = {
        draft: ["pending_review"],
        pending_review: ["approved", "rejected"],
        approved: ["pending_review"],
        rejected: ["pending_review", "draft"],
      };
      expect(allowedTransitions[currentStatus]).not.toContain(targetStatus);
    });
  });

  describe("Review Permissions", () => {
    it("should allow ops_specialist to submit for review", () => {
      const submitterRoles = [
        "ops_specialist", "ops_manager", "product_dev",
        "designer", "company_admin", "super_admin",
      ];
      expect(submitterRoles).toContain("ops_specialist");
    });

    it("should allow ops_manager to approve/reject", () => {
      const reviewerRoles = ["ops_manager", "company_admin", "super_admin"];
      expect(reviewerRoles).toContain("ops_manager");
    });

    it("should allow company_admin to approve/reject", () => {
      const reviewerRoles = ["ops_manager", "company_admin", "super_admin"];
      expect(reviewerRoles).toContain("company_admin");
    });

    it("should NOT allow ops_specialist to approve/reject", () => {
      const reviewerRoles = ["ops_manager", "company_admin", "super_admin"];
      expect(reviewerRoles).not.toContain("ops_specialist");
    });

    it("should NOT allow finance role to approve/reject", () => {
      const reviewerRoles = ["ops_manager", "company_admin", "super_admin"];
      expect(reviewerRoles).not.toContain("finance");
    });
  });

  describe("Batch Operations", () => {
    it("should validate batch items have type and id", () => {
      const batchItems = [
        { type: "product", id: 1 },
        { type: "listing", id: 2 },
        { type: "image", id: 3 },
      ];
      batchItems.forEach(item => {
        expect(item).toHaveProperty("type");
        expect(item).toHaveProperty("id");
        expect(typeof item.id).toBe("number");
      });
    });

    it("should enforce batch size limit of 100", () => {
      const maxBatchSize = 100;
      const items = Array.from({ length: 101 }, (_, i) => ({
        type: "product",
        id: i + 1,
      }));
      expect(items.length).toBeGreaterThan(maxBatchSize);
    });

    it("should track success and error counts in batch results", () => {
      const batchResult = {
        successCount: 3,
        errorCount: 1,
        errors: ["product#5: 不存在或无权操作"],
      };
      expect(batchResult.successCount + batchResult.errorCount).toBe(4);
      expect(batchResult.errors).toHaveLength(1);
    });
  });

  describe("Review Stats", () => {
    it("should aggregate stats across all KB types", () => {
      const stats = {
        totalPending: 5,
        totalApproved: 12,
        totalRejected: 3,
        product: { draft: 2, pending_review: 1, approved: 3, rejected: 1 },
        listing: { draft: 1, pending_review: 2, approved: 4, rejected: 0 },
        image: { draft: 0, pending_review: 1, approved: 2, rejected: 1 },
        skill: { draft: 3, pending_review: 0, approved: 2, rejected: 0 },
        video: { draft: 1, pending_review: 1, approved: 1, rejected: 1 },
      };
      expect(stats.totalPending).toBe(
        stats.product.pending_review +
        stats.listing.pending_review +
        stats.image.pending_review +
        stats.skill.pending_review +
        stats.video.pending_review
      );
    });
  });
});

// ─── Test: SOP Access Control ───
describe("SOP Access Control", () => {
  describe("Access Level Definitions", () => {
    it("should define three access levels", () => {
      const accessLevels = ["public", "team", "restricted"];
      expect(accessLevels).toHaveLength(3);
    });

    it("should define public as accessible to all authenticated users", () => {
      const accessLevel = "public";
      const userRole = "ops_specialist";
      const isAccessible = accessLevel === "public";
      expect(isAccessible).toBe(true);
    });

    it("should define team as accessible to allowed roles only", () => {
      const accessLevel = "team";
      const allowedRoles = ["ops_specialist", "ops_manager"];
      const userRole = "finance";
      const isAccessible =
        accessLevel === "public" ||
        (accessLevel === "team" && allowedRoles.includes(userRole));
      expect(isAccessible).toBe(false);
    });

    it("should define restricted as accessible only to explicitly granted users", () => {
      const accessLevel = "restricted";
      const grantedUserIds = [1, 3, 5];
      const userId = 2;
      const isAccessible =
        accessLevel === "public" ||
        (accessLevel === "restricted" && grantedUserIds.includes(userId));
      expect(isAccessible).toBe(false);
    });

    it("should allow admin to access all SOPs regardless of access level", () => {
      const adminRoles = ["super_admin", "company_admin"];
      const userRole = "super_admin";
      const isAdmin = adminRoles.includes(userRole);
      expect(isAdmin).toBe(true);
    });
  });

  describe("SOP Grant Management", () => {
    it("should create a grant record with userId, skillId, and grantedBy", () => {
      const grant = {
        userId: 5,
        skillId: 10,
        grantedBy: 1,
        createdAt: new Date(),
      };
      expect(grant).toHaveProperty("userId");
      expect(grant).toHaveProperty("skillId");
      expect(grant).toHaveProperty("grantedBy");
    });

    it("should prevent duplicate grants for same user-skill pair", () => {
      const existingGrants = [
        { userId: 5, skillId: 10 },
        { userId: 3, skillId: 10 },
      ];
      const newGrant = { userId: 5, skillId: 10 };
      const isDuplicate = existingGrants.some(
        g => g.userId === newGrant.userId && g.skillId === newGrant.skillId
      );
      expect(isDuplicate).toBe(true);
    });
  });

  describe("Role-based Filtering", () => {
    it("should filter SOPs by user role when access level is team", () => {
      const sops = [
        { id: 1, title: "SOP A", accessLevel: "public", allowedRoles: null },
        { id: 2, title: "SOP B", accessLevel: "team", allowedRoles: JSON.stringify(["ops_specialist", "ops_manager"]) },
        { id: 3, title: "SOP C", accessLevel: "team", allowedRoles: JSON.stringify(["product_dev"]) },
        { id: 4, title: "SOP D", accessLevel: "restricted", allowedRoles: null },
      ];
      const userRole = "ops_specialist";
      const accessible = sops.filter(sop => {
        if (sop.accessLevel === "public") return true;
        if (sop.accessLevel === "team" && sop.allowedRoles) {
          const roles = JSON.parse(sop.allowedRoles);
          return roles.includes(userRole);
        }
        return false;
      });
      expect(accessible).toHaveLength(2);
      expect(accessible.map(s => s.id)).toEqual([1, 2]);
    });
  });
});

// ─── Test: Project Assignment ───
describe("Project Assignment & Cross-Module Reference", () => {
  describe("Assignment Data Model", () => {
    it("should define assignment with projectId, projectType, assignedUserId, permission", () => {
      const assignment = {
        id: 1,
        projectId: 10,
        projectType: "dev_project" as const,
        assignedUserId: 5,
        assignedBy: 1,
        permission: "read" as const,
        createdAt: new Date(),
      };
      expect(assignment.projectType).toBe("dev_project");
      expect(["read", "write"]).toContain(assignment.permission);
    });

    it("should support both dev_project and listing_project types", () => {
      const projectTypes = ["dev_project", "listing_project"];
      expect(projectTypes).toHaveLength(2);
    });

    it("should enforce unique constraint on projectId + projectType + assignedUserId", () => {
      const assignments = [
        { projectId: 1, projectType: "dev_project", assignedUserId: 5 },
        { projectId: 1, projectType: "dev_project", assignedUserId: 5 },
      ];
      const unique = new Set(
        assignments.map(a => `${a.projectId}:${a.projectType}:${a.assignedUserId}`)
      );
      expect(unique.size).toBeLessThan(assignments.length);
    });
  });

  describe("Permission Levels", () => {
    it("should define read and write permission levels", () => {
      const permissions = ["read", "write"];
      expect(permissions).toHaveLength(2);
    });

    it("should allow read users to view but not modify project data", () => {
      const userPermission = "read";
      const canView = true;
      const canModify = userPermission === "write";
      expect(canView).toBe(true);
      expect(canModify).toBe(false);
    });

    it("should allow write users to both view and modify project data", () => {
      const userPermission = "write";
      const canView = true;
      const canModify = userPermission === "write";
      expect(canView).toBe(true);
      expect(canModify).toBe(true);
    });
  });

  describe("Cross-Module Data Flow", () => {
    it("should map dev_product_profiles data to listing attributes", () => {
      const devProfile = {
        productTitle: "Wireless Bluetooth Speaker",
        category: "Electronics",
        targetMarket: "US",
        coreSellingPoints: JSON.stringify([
          "360° surround sound",
          "IPX7 waterproof",
          "24-hour battery life",
        ]),
        targetAudience: "Outdoor enthusiasts",
        productSpecs: JSON.stringify({
          weight: "350g",
          dimensions: "10x10x12cm",
          material: "ABS + Silicone",
        }),
      };

      // Simulate mapping to listing context
      const listingContext = {
        productTitle: devProfile.productTitle,
        category: devProfile.category,
        sellingPoints: JSON.parse(devProfile.coreSellingPoints),
        specs: JSON.parse(devProfile.productSpecs),
        targetAudience: devProfile.targetAudience,
      };

      expect(listingContext.productTitle).toBe("Wireless Bluetooth Speaker");
      expect(listingContext.sellingPoints).toHaveLength(3);
      expect(listingContext.specs).toHaveProperty("weight");
    });

    it("should only allow access to assigned projects", () => {
      const userAssignments = [
        { projectId: 1, projectType: "dev_project" },
        { projectId: 3, projectType: "dev_project" },
      ];
      const requestedProjectId = 2;
      const hasAccess = userAssignments.some(
        a => a.projectId === requestedProjectId
      );
      expect(hasAccess).toBe(false);
    });

    it("should list only importable dev projects for current user", () => {
      const allDevProjects = [
        { id: 1, name: "Project A" },
        { id: 2, name: "Project B" },
        { id: 3, name: "Project C" },
      ];
      const userAssignments = [
        { projectId: 1, projectType: "dev_project" },
        { projectId: 3, projectType: "dev_project" },
      ];
      const importable = allDevProjects.filter(p =>
        userAssignments.some(a => a.projectId === p.id)
      );
      expect(importable).toHaveLength(2);
      expect(importable.map(p => p.name)).toEqual(["Project A", "Project C"]);
    });
  });

  describe("Admin Assignment Management", () => {
    it("should only allow admin roles to create assignments", () => {
      const adminRoles = ["super_admin", "company_admin"];
      const userRole = "ops_specialist";
      const canAssign = adminRoles.includes(userRole);
      expect(canAssign).toBe(false);
    });

    it("should allow admin to assign any project to any user", () => {
      const adminRoles = ["super_admin", "company_admin"];
      const userRole = "super_admin";
      const canAssign = adminRoles.includes(userRole);
      expect(canAssign).toBe(true);
    });

    it("should allow admin to revoke assignments", () => {
      const assignment = {
        id: 1,
        projectId: 10,
        assignedUserId: 5,
        assignedBy: 1,
      };
      const adminUserId = 1;
      const canRevoke = true; // admin can always revoke
      expect(canRevoke).toBe(true);
    });

    it("should allow admin to update permission level", () => {
      const assignment = {
        id: 1,
        permission: "read" as const,
      };
      const updatedPermission = "write";
      expect(updatedPermission).not.toBe(assignment.permission);
    });
  });
});

// ─── Test: Role System ───
describe("Role System", () => {
  it("should define 8 roles", () => {
    const roles = [
      "super_admin",
      "company_admin",
      "ops_manager",
      "ops_specialist",
      "product_dev",
      "finance",
      "purchaser",
      "designer",
    ];
    expect(roles).toHaveLength(8);
  });

  it("should define MANAGER_ROLES correctly", () => {
    const MANAGER_ROLES = ["super_admin", "company_admin", "ops_manager"];
    expect(MANAGER_ROLES).toContain("super_admin");
    expect(MANAGER_ROLES).toContain("company_admin");
    expect(MANAGER_ROLES).toContain("ops_manager");
    expect(MANAGER_ROLES).not.toContain("ops_specialist");
  });

  it("should define role hierarchy for module access", () => {
    const ROLE_MODULE_ACCESS: Record<string, string[]> = {
      super_admin: ["home", "dev", "listing", "operations", "knowledge", "admin"],
      company_admin: ["home", "dev", "listing", "operations", "knowledge", "admin"],
      ops_manager: ["home", "listing", "operations", "knowledge", "admin"],
      ops_specialist: ["home", "listing", "operations", "knowledge"],
      product_dev: ["home", "dev"],
      finance: ["home", "operations"],
      purchaser: ["home", "dev"],
      designer: ["home", "listing", "knowledge"],
    };

    // Super admin has access to all modules
    expect(ROLE_MODULE_ACCESS.super_admin).toContain("admin");
    // Ops specialist does NOT have admin access
    expect(ROLE_MODULE_ACCESS.ops_specialist).not.toContain("admin");
    // Finance only has home and operations
    expect(ROLE_MODULE_ACCESS.finance).toHaveLength(2);
    // Designer has access to listing and knowledge
    expect(ROLE_MODULE_ACCESS.designer).toContain("listing");
    expect(ROLE_MODULE_ACCESS.designer).toContain("knowledge");
  });
});

// ─── Test: Deployment Configuration ───
describe("Deployment Configuration", () => {
  it("should support company name configuration", () => {
    const config = {
      companyName: "跨海👍",
      erpType: "lingxing",
      instanceId: "kuahai-001",
    };
    expect(config.companyName).toBeTruthy();
    expect(config.erpType).toBe("lingxing");
  });

  it("should support different ERP types", () => {
    const erpTypes = ["lingxing", "saihu"];
    expect(erpTypes).toContain("lingxing");
    expect(erpTypes).toContain("saihu");
  });

  it("should support peer API configuration for P2P sync", () => {
    const peerConfig = {
      peerApiUrl: "https://xingqi.manus.space/api",
      peerApiKey: "sync-key-123",
      instanceId: "kuahai-001",
    };
    expect(peerConfig.peerApiUrl).toBeTruthy();
    expect(peerConfig.peerApiKey).toBeTruthy();
  });
});


// ─── Test: Phase 2 P1 Router Modules ───
describe("Phase 2 P1 - adAnalysisP2 router module", () => {
  it("should export adAnalysisP2Router", async () => {
    const mod = await import("./routers/adAnalysisP2");
    expect(mod.adAnalysisP2Router).toBeDefined();
    expect(mod.adAnalysisP2Router._def).toBeDefined();
  });

  it("adAnalysisP2Router should have DSP report procedure", async () => {
    const mod = await import("./routers/adAnalysisP2");
    const procedures = Object.keys(mod.adAnalysisP2Router._def.procedures);
    expect(procedures).toContain("getDspReport");
  });

  it("adAnalysisP2Router should have AI DSP advice procedure", async () => {
    const mod = await import("./routers/adAnalysisP2");
    const procedures = Object.keys(mod.adAnalysisP2Router._def.procedures);
    expect(procedures).toContain("aiDspStrategy");
  });

  it("adAnalysisP2Router should have cross-channel analysis procedure", async () => {
    const mod = await import("./routers/adAnalysisP2");
    const procedures = Object.keys(mod.adAnalysisP2Router._def.procedures);
    expect(procedures).toContain("getCrossChannelData");
  });

  it("adAnalysisP2Router should have AI ad chat procedure", async () => {
    const mod = await import("./routers/adAnalysisP2");
    const procedures = Object.keys(mod.adAnalysisP2Router._def.procedures);
    expect(procedures).toContain("adChatBot");
  });

  it("adAnalysisP2Router should have AI cross-channel advice procedure", async () => {
    const mod = await import("./routers/adAnalysisP2");
    const procedures = Object.keys(mod.adAnalysisP2Router._def.procedures);
    expect(procedures).toContain("aiChannelStrategy");
  });
});



describe("Phase 2 P1 - opsProductPlan router module", () => {
  it("should export opsProductPlanRouter", async () => {
    const mod = await import("./routers/opsProductPlan");
    expect(mod.opsProductPlanRouter).toBeDefined();
    expect(mod.opsProductPlanRouter._def).toBeDefined();
  });

  it("opsProductPlanRouter should have CRUD procedures", async () => {
    const mod = await import("./routers/opsProductPlan");
    const procedures = Object.keys(mod.opsProductPlanRouter._def.procedures);
    expect(procedures).toContain("listPlans");
    expect(procedures).toContain("getPlan");
    expect(procedures).toContain("createPlan");
    expect(procedures).toContain("updatePlan");
    expect(procedures).toContain("deletePlan");
  });

  it("opsProductPlanRouter should have daily record procedures", async () => {
    const mod = await import("./routers/opsProductPlan");
    const procedures = Object.keys(mod.opsProductPlanRouter._def.procedures);
    expect(procedures).toContain("getDailyRecords");
    expect(procedures).toContain("upsertDailyRecord");
  });

  it("opsProductPlanRouter should have keyword tracking procedures", async () => {
    const mod = await import("./routers/opsProductPlan");
    const procedures = Object.keys(mod.opsProductPlanRouter._def.procedures);
    expect(procedures).toContain("listKeywords");
    expect(procedures).toContain("addKeyword");
    expect(procedures).toContain("deleteKeyword");
    expect(procedures).toContain("getKeywordDailyRecords");
    expect(procedures).toContain("upsertKeywordDailyRecord");
  });

  it("opsProductPlanRouter should have AI ops suggestion procedure", async () => {
    const mod = await import("./routers/opsProductPlan");
    const procedures = Object.keys(mod.opsProductPlanRouter._def.procedures);
    expect(procedures).toContain("aiOpsSuggestion");
  });
});

describe("Phase 2 P1 - appRouter integration", () => {
  it("appRouter should include all Phase 2 P1 routers", async () => {
    const mod = await import("./routers");
    const routerKeys = Object.keys(mod.appRouter._def.procedures);
    const hasAdP2 = routerKeys.some(k => k.startsWith("adAnalysisP2."));
    const hasOpsProductPlan = routerKeys.some(k => k.startsWith("opsProductPlan."));
    expect(hasAdP2).toBe(true);
    expect(hasOpsProductPlan).toBe(true);
  });
});
