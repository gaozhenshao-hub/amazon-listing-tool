import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import * as db from "../repositories";
import {
  MAX_LOGIN_ATTEMPTS,
  LOCK_DURATION_MS,
  ACCOUNT_DISABLED_MSG,
  ACCOUNT_LOCKED_MSG,
  INVALID_CREDENTIALS_MSG,
} from "../../shared/const";

export function hashPasswordFast(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPasswordFast(password: string, stored: string): boolean {
  if (stored.startsWith("scrypt:")) {
    const [, salt, hash] = stored.split(":");
    if (!salt || !/^[a-f0-9]{128}$/i.test(hash || "")) return false;
    const hashBuf = Buffer.from(hash, "hex");
    const derivedBuf = scryptSync(password, salt, 64);
    return timingSafeEqual(hashBuf, derivedBuf);
  }
  // Legacy bcrypt hash - verify with bcrypt (slow but only once)
  return bcrypt.compareSync(password, stored);
}

export async function authenticatePasswordCredentials(
  input: { identifier: string; password: string },
  metadata: { ip?: string; userAgent?: string }
) {
  const user = await db.getUserByEmailOrPhone(input.identifier);

  if (!user) {
    await db.insertLoginLog({
      loginMethod: "password",
      loginIdentifier: input.identifier,
      ipAddress: metadata.ip || null,
      userAgent: metadata.userAgent?.substring(0, 512) || null,
      success: 0,
      failReason: "user_not_found",
    });
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: INVALID_CREDENTIALS_MSG,
    });
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
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "该账号未设置密码，请使用其他方式登录",
    });
  }

  const passwordMatch = verifyPasswordFast(input.password, user.password);
  if (!passwordMatch) {
    const attempts = (user.failedLoginAttempts || 0) + 1;
    const lockedUntil =
      attempts >= MAX_LOGIN_ATTEMPTS
        ? new Date(Date.now() + LOCK_DURATION_MS)
        : null;

    await db.updateLoginAttempts(user.id, attempts, lockedUntil);
    await db.insertLoginLog({
      userId: user.id,
      loginMethod: "password",
      loginIdentifier: input.identifier,
      ipAddress: metadata.ip || null,
      userAgent: metadata.userAgent?.substring(0, 512) || null,
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
      ipAddress: metadata.ip || null,
      userAgent: metadata.userAgent?.substring(0, 512) || null,
      success: 1,
    }),
  ]);

  // Migrate from bcrypt to scrypt if needed (background, don't block response)
  if (!user.password.startsWith("scrypt:")) {
    const newHash = hashPasswordFast(input.password);
    db.updateUserById(user.id, { password: newHash }).catch(() => {});
  }

  await loginUpdates;

  return user;
}
