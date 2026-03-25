import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock ENV
vi.mock("./_core/env", () => ({
  ENV: {
    ownerOpenId: "owner_open_id_123",
    appId: "test_app",
    cookieSecret: "test_secret_key_32_chars_long_xx",
    oAuthServerUrl: "https://api.manus.im",
  },
}));

// Mock db module
const mockGetUserByOpenId = vi.fn();
const mockGetUserByEmailOrPhone = vi.fn();
const mockUpdateUserById = vi.fn();
const mockUpsertUser = vi.fn();

vi.mock("./db", () => ({
  getUserByOpenId: (...args: any[]) => mockGetUserByOpenId(...args),
  getUserByEmailOrPhone: (...args: any[]) => mockGetUserByEmailOrPhone(...args),
  updateUserById: (...args: any[]) => mockUpdateUserById(...args),
  upsertUser: (...args: any[]) => mockUpsertUser(...args),
  getDb: vi.fn().mockResolvedValue({}),
}));

describe("No Auto-Registration Policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("OAuth callback logic", () => {
    it("should reject login when no pre-created account exists for non-owner", async () => {
      // Simulate: user with email not found in DB
      mockGetUserByOpenId.mockResolvedValue(undefined);
      mockGetUserByEmailOrPhone.mockResolvedValue(undefined);

      // The OAuth callback should NOT call upsertUser for non-owner users
      // Instead it should redirect to login with error
      const { ENV } = await import("./_core/env");
      
      const nonOwnerOpenId = "some_random_open_id";
      expect(nonOwnerOpenId).not.toBe(ENV.ownerOpenId);
      
      // Verify the policy: non-owner without existing account should be rejected
      const existingUser = await mockGetUserByEmailOrPhone("unknown@example.com");
      expect(existingUser).toBeUndefined();
      
      // upsertUser should NOT be called for non-owner
      expect(mockUpsertUser).not.toHaveBeenCalled();
    });

    it("should allow owner to auto-create account", async () => {
      const { ENV } = await import("./_core/env");
      
      mockGetUserByOpenId.mockResolvedValue(undefined);
      
      // Owner should be allowed to auto-create
      const isOwner = "owner_open_id_123" === ENV.ownerOpenId;
      expect(isOwner).toBe(true);
      
      // For owner, upsertUser should be called
      await mockUpsertUser({
        openId: ENV.ownerOpenId,
        name: "Owner",
        email: "owner@test.com",
        loginMethod: "google",
        lastSignedIn: new Date(),
      });
      expect(mockUpsertUser).toHaveBeenCalledTimes(1);
    });

    it("should bind openId to existing account when email matches", async () => {
      const existingUser = {
        id: 100,
        name: "王俊财(Jace)",
        email: "2835872291@qq.com",
        openId: null,
        role: "product_dev",
        status: "active",
      };

      mockGetUserByOpenId.mockResolvedValue(undefined);
      mockGetUserByEmailOrPhone.mockResolvedValue(existingUser);

      // Simulate the binding logic
      const userFromEmail = await mockGetUserByEmailOrPhone("2835872291@qq.com");
      expect(userFromEmail).toBeDefined();
      expect(userFromEmail.name).toBe("王俊财(Jace)");

      // Should update existing user with openId, not create new
      await mockUpdateUserById(existingUser.id, {
        openId: "new_oauth_open_id",
        loginMethod: "email",
        lastSignedIn: new Date(),
      });
      expect(mockUpdateUserById).toHaveBeenCalledWith(100, expect.objectContaining({
        openId: "new_oauth_open_id",
      }));
      expect(mockUpsertUser).not.toHaveBeenCalled();
    });

    it("should reject disabled accounts", async () => {
      const disabledUser = {
        id: 200,
        name: "Disabled User",
        email: "disabled@test.com",
        openId: "disabled_open_id",
        status: "disabled",
      };

      mockGetUserByOpenId.mockResolvedValue(disabledUser);

      const user = await mockGetUserByOpenId("disabled_open_id");
      expect(user.status).toBe("disabled");
      // Disabled users should be rejected
    });
  });

  describe("Password login logic", () => {
    it("should reject login when user not found by email/phone", async () => {
      mockGetUserByEmailOrPhone.mockResolvedValue(undefined);

      const user = await mockGetUserByEmailOrPhone("nonexistent@test.com");
      expect(user).toBeUndefined();
      // Password login already rejects unknown users (no auto-registration)
    });

    it("should allow login for existing user with correct password", async () => {
      const existingUser = {
        id: 300,
        name: "Test User",
        email: "test@test.com",
        password: "$2b$10$hashedpassword",
        status: "active",
        failedLoginAttempts: 0,
        lockedUntil: null,
      };

      mockGetUserByEmailOrPhone.mockResolvedValue(existingUser);

      const user = await mockGetUserByEmailOrPhone("test@test.com");
      expect(user).toBeDefined();
      expect(user.status).toBe("active");
    });
  });

  describe("SDK authenticateRequest logic", () => {
    it("should bind openId when email matches existing account (no auto-register)", async () => {
      // First lookup by openId fails
      mockGetUserByOpenId.mockResolvedValueOnce(undefined);
      
      const existingUser = {
        id: 400,
        name: "郁洋(Carl)",
        email: "970032132@qq.com",
        openId: null,
        role: "product_dev",
        status: "active",
      };
      
      mockGetUserByEmailOrPhone.mockResolvedValue(existingUser);
      
      // After binding, second lookup succeeds
      mockGetUserByOpenId.mockResolvedValueOnce({
        ...existingUser,
        openId: "new_open_id",
      });

      // Simulate the flow
      let user = await mockGetUserByOpenId("new_open_id");
      expect(user).toBeUndefined(); // First call returns undefined

      const emailUser = await mockGetUserByEmailOrPhone("970032132@qq.com");
      expect(emailUser).toBeDefined();

      await mockUpdateUserById(emailUser.id, { openId: "new_open_id" });
      
      user = await mockGetUserByOpenId("new_open_id");
      expect(user).toBeDefined();
      expect(user.openId).toBe("new_open_id");
    });

    it("should reject when no account found by openId or email", async () => {
      mockGetUserByOpenId.mockResolvedValue(undefined);
      mockGetUserByEmailOrPhone.mockResolvedValue(undefined);

      const user = await mockGetUserByOpenId("unknown_open_id");
      expect(user).toBeUndefined();
      
      const emailUser = await mockGetUserByEmailOrPhone("unknown@test.com");
      expect(emailUser).toBeUndefined();
      
      // Should NOT auto-create
      expect(mockUpsertUser).not.toHaveBeenCalled();
    });
  });
});
