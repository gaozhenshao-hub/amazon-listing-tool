import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { sdk } from "../_core/sdk";
import { getSessionCookieOptions } from "../_core/cookies";
import bcrypt from "bcryptjs";
import { scryptSync, randomBytes, timingSafeEqual } from "crypto";

// Cloud Run (1vCPU, 512MB) makes bcrypt very slow at high rounds.
// Use 8 rounds for acceptable security with fast response times.
const BCRYPT_ROUNDS = 8;

// Fast password hashing using Node.js native scrypt (much faster than bcrypt on low-resource environments)
function hashPasswordFast(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPasswordFast(password: string, stored: string): boolean {
  if (stored.startsWith("scrypt:")) {
    const [, salt, hash] = stored.split(":");
    const hashBuf = Buffer.from(hash, "hex");
    const derivedBuf = scryptSync(password, salt, 64);
    return timingSafeEqual(hashBuf, derivedBuf);
  }
  // Legacy bcrypt hash - verify with bcrypt (slow but only once)
  return bcrypt.compareSync(password, stored);
}

import {
  COOKIE_NAME, ONE_YEAR_MS,
  ALL_ROLES, ADMIN_ROLES, ROLE_LABELS,
  PASSWORD_MIN_LENGTH, PASSWORD_REGEX,
  MAX_LOGIN_ATTEMPTS, LOCK_DURATION_MS,
  ACCOUNT_DISABLED_MSG, ACCOUNT_LOCKED_MSG,
  INVALID_CREDENTIALS_MSG, MUST_CHANGE_PASSWORD_MSG,
} from "@shared/const";
import type { UserRole } from "../../drizzle/schema";

// ─── Password Login Router ─────────────────────────────────────────
export const userAuthRouter = router({
  // Password login
  login: publicProcedure
    .input(z.object({
      identifier: z.string().min(1, "请输入邮箱或手机号"),
      password: z.string().min(1, "请输入密码"),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = await db.getUserByEmailOrPhone(input.identifier);

      if (!user) {
        await db.insertLoginLog({
          loginMethod: "password",
          loginIdentifier: input.identifier,
          ipAddress: ctx.req.ip || null,
          userAgent: ctx.req.headers["user-agent"]?.substring(0, 512) || null,
          success: 0,
          failReason: "user_not_found",
        });
        throw new TRPCError({ code: "UNAUTHORIZED", message: INVALID_CREDENTIALS_MSG });
      }

      // Check account status
      if (user.status === "disabled") {
        throw new TRPCError({ code: "FORBIDDEN", message: ACCOUNT_DISABLED_MSG });
      }

      // Check lock status
      if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
        throw new TRPCError({ code: "FORBIDDEN", message: ACCOUNT_LOCKED_MSG });
      }

      // Check password
      if (!user.password) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "该账号未设置密码，请使用其他方式登录" });
      }

      const passwordMatch = verifyPasswordFast(input.password, user.password);
      if (!passwordMatch) {
        const attempts = (user.failedLoginAttempts || 0) + 1;
        const lockedUntil = attempts >= MAX_LOGIN_ATTEMPTS
          ? new Date(Date.now() + LOCK_DURATION_MS)
          : null;

        await db.updateLoginAttempts(user.id, attempts, lockedUntil);
        await db.insertLoginLog({
          userId: user.id,
          loginMethod: "password",
          loginIdentifier: input.identifier,
          ipAddress: ctx.req.ip || null,
          userAgent: ctx.req.headers["user-agent"]?.substring(0, 512) || null,
          success: 0,
          failReason: `wrong_password_attempt_${attempts}`,
        });

        if (lockedUntil) {
          throw new TRPCError({ code: "FORBIDDEN", message: ACCOUNT_LOCKED_MSG });
        }
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: `${INVALID_CREDENTIALS_MSG}，还剩 ${MAX_LOGIN_ATTEMPTS - attempts} 次尝试机会`,
        });
      }

      // Login success - run DB updates in parallel for speed
      const loginUpdates = Promise.all([
        db.updateLoginAttempts(user.id, 0, null),
        db.updateUserById(user.id, { lastSignedIn: new Date() }),
        db.insertLoginLog({
          userId: user.id,
          loginMethod: "password",
          loginIdentifier: input.identifier,
          ipAddress: ctx.req.ip || null,
          userAgent: ctx.req.headers["user-agent"]?.substring(0, 512) || null,
          success: 1,
        }),
      ]);

      // Migrate from bcrypt to scrypt if needed (background, don't block response)
      if (!user.password.startsWith("scrypt:")) {
        const newHash = hashPasswordFast(input.password);
        db.updateUserById(user.id, { password: newHash }).catch(() => {});
      }

      await loginUpdates;

      // Create session token using a pseudo openId for password users
      const sessionOpenId = user.openId || `pwd_${user.id}`;

      // CRITICAL: persist the pseudo openId so auth.me can find this user later
      if (!user.openId) {
        await db.updateUserById(user.id, { openId: sessionOpenId });
      }

      const sessionToken = await sdk.signSession(
        { openId: sessionOpenId, appId: process.env.VITE_APP_ID || "", name: user.name || "" },
        { expiresInMs: ONE_YEAR_MS }
      );

      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      return {
        success: true,
        mustChangePassword: user.mustChangePassword === 1,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      };
    }),

  // Change password
  changePassword: protectedProcedure
    .input(z.object({
      currentPassword: z.string().optional(),
      newPassword: z.string().min(PASSWORD_MIN_LENGTH, `密码至少${PASSWORD_MIN_LENGTH}位`)
        .regex(PASSWORD_REGEX, "密码必须包含大小写字母和数字"),
    }))
    .mutation(async ({ input, ctx }) => {
      const user = await db.getUserById(ctx.user.id);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });

      // If user has a password and is not forced to change, require current password
      if (user.password && user.mustChangePassword !== 1) {
        if (!input.currentPassword) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "请输入当前密码" });
        }
        const match = verifyPasswordFast(input.currentPassword, user.password);
        if (!match) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "当前密码错误" });
        }
      }

      const hashedPassword = hashPasswordFast(input.newPassword);
      await db.updateUserById(user.id, {
        password: hashedPassword,
        mustChangePassword: 0,
        lastPasswordChangedAt: new Date(),
      });

      return { success: true };
    }),
});

// ─── User Management Router (Admin only) ───────────────────────────
export const userManagementRouter = router({
  // List all users
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!ADMIN_ROLES.includes(ctx.user.role as any)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
    }
    return db.getAllUsers();
  }),

  // Create user (admin only)
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1, "请输入姓名"),
      email: z.string().email("请输入有效邮箱").optional(),
      phone: z.string().optional(),
      role: z.enum(ALL_ROLES as unknown as [string, ...string[]]),
      department: z.string().optional(),
      jobTitle: z.string().optional(),
      initialPassword: z.string().min(PASSWORD_MIN_LENGTH).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!ADMIN_ROLES.includes(ctx.user.role as any)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
      }

      // Check if email or phone already exists
      if (input.email) {
        const existing = await db.getUserByEmailOrPhone(input.email);
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "该邮箱已被注册" });
      }
      if (input.phone) {
        const existing = await db.getUserByEmailOrPhone(input.phone);
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "该手机号已被注册" });
      }

      // Cannot create super_admin unless you are super_admin
      if (input.role === "super_admin" && ctx.user.role !== "super_admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有超级管理员可以创建超级管理员" });
      }

      const password = input.initialPassword || "Abc12345";
      const hashedPassword = hashPasswordFast(password);

      await db.upsertUser({
        name: input.name,
        email: input.email || null,
        phone: input.phone || null,
        password: hashedPassword,
        role: input.role as UserRole,
        department: input.department || null,
        jobTitle: input.jobTitle || null,
        status: "active",
        mustChangePassword: 1,
        invitedBy: ctx.user.id,
      });

      return { success: true, defaultPassword: password };
    }),

  // Update user
  update: protectedProcedure
    .input(z.object({
      userId: z.number(),
      name: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      role: z.enum(ALL_ROLES as unknown as [string, ...string[]]).optional(),
      department: z.string().optional(),
      jobTitle: z.string().optional(),
      status: z.enum(["active", "disabled", "pending"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!ADMIN_ROLES.includes(ctx.user.role as any)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
      }

      const targetUser = await db.getUserById(input.userId);
      if (!targetUser) throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });

      // Cannot modify super_admin unless you are super_admin
      if (targetUser.role === "super_admin" && ctx.user.role !== "super_admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "无法修改超级管理员" });
      }

      const updateData: Record<string, any> = {};
      if (input.name !== undefined) updateData.name = input.name;
      if (input.email !== undefined) updateData.email = input.email;
      if (input.phone !== undefined) updateData.phone = input.phone;
      if (input.role !== undefined) updateData.role = input.role;
      if (input.department !== undefined) updateData.department = input.department;
      if (input.jobTitle !== undefined) updateData.jobTitle = input.jobTitle;
      if (input.status !== undefined) updateData.status = input.status;

      await db.updateUserById(input.userId, updateData);
      return { success: true };
    }),

  // Reset password (admin only)
  resetPassword: protectedProcedure
    .input(z.object({
      userId: z.number(),
      newPassword: z.string().min(PASSWORD_MIN_LENGTH).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!ADMIN_ROLES.includes(ctx.user.role as any)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
      }

      const targetUser = await db.getUserById(input.userId);
      if (!targetUser) throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });

      if (targetUser.role === "super_admin" && ctx.user.role !== "super_admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "无法重置超级管理员密码" });
      }

      const newPassword = input.newPassword || "Abc12345";
      const hashedPassword = hashPasswordFast(newPassword);

      await db.updateUserById(input.userId, {
        password: hashedPassword,
        mustChangePassword: 1,
        failedLoginAttempts: 0,
        lockedUntil: null,
      });

      return { success: true, newPassword };
    }),

  // Bulk import users from Excel data
  bulkImport: protectedProcedure
    .input(z.object({
      users: z.array(z.object({
        name: z.string(),
        email: z.string().optional(),
        phone: z.string().optional(),
        role: z.enum(ALL_ROLES as unknown as [string, ...string[]]).optional(),
        department: z.string().optional(),
        jobTitle: z.string().optional(),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!ADMIN_ROLES.includes(ctx.user.role as any)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
      }

      const defaultPassword = "Abc12345";
      const hashedPassword = hashPasswordFast(defaultPassword);
      let successCount = 0;
      let skipCount = 0;
      const errors: string[] = [];

      for (const u of input.users) {
        try {
          // Check if already exists
          if (u.email) {
            const existing = await db.getUserByEmailOrPhone(u.email);
            if (existing) { skipCount++; errors.push(`${u.name}: 邮箱已存在`); continue; }
          }
          if (u.phone) {
            const existing = await db.getUserByEmailOrPhone(u.phone);
            if (existing) { skipCount++; errors.push(`${u.name}: 手机号已存在`); continue; }
          }

          await db.upsertUser({
            name: u.name,
            email: u.email || null,
            phone: u.phone || null,
            password: hashedPassword,
            role: (u.role || "ops_specialist") as UserRole,
            department: u.department || null,
            jobTitle: u.jobTitle || null,
            status: "active",
            mustChangePassword: 1,
            invitedBy: ctx.user.id,
          });
          successCount++;
        } catch (err: any) {
          errors.push(`${u.name}: ${err.message}`);
        }
      }

      return { success: true, successCount, skipCount, errors, defaultPassword };
    }),

  // Get login logs
  loginLogs: protectedProcedure
    .input(z.object({ limit: z.number().optional() }).optional())
    .query(async ({ input, ctx }) => {
      if (!ADMIN_ROLES.includes(ctx.user.role as any)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
      }
      return db.getLoginLogs(input?.limit || 100);
    }),

  // Get role labels
  roleLabels: publicProcedure.query(() => {
    return { roles: ALL_ROLES, labels: ROLE_LABELS };
  }),

  // Get deployment config (public)
  deploymentConfig: publicProcedure.query(() => {
    const { ENV } = require("../_core/env");
    return {
      companyName: ENV.companyName,
      companyLogo: ENV.companyLogo,
      erpType: ENV.erpType,
      instanceId: ENV.instanceId,
      peerSyncEnabled: ENV.peerSyncEnabled,
    };
  }),
});
