import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { ENV } from "./env";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      // --- 禁止自动注册逻辑 ---
      // Step 1: 先按openId查找已有用户
      let existingUser = await db.getUserByOpenId(userInfo.openId);

      if (!existingUser && userInfo.email) {
        // Step 2: 按邮箱查找管理员已创建的账号（openId为NULL的）
        existingUser = await db.getUserByEmailOrPhone(userInfo.email);
        if (existingUser) {
          // 找到已有账号 → 绑定openId和登录方式，不创建新账号
          console.log(`[OAuth] Binding openId to existing user: ${existingUser.name} (${existingUser.email})`);
          await db.updateUserById(existingUser.id, {
            openId: userInfo.openId,
            loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
            lastSignedIn: new Date(),
          });
        }
      }

      if (!existingUser) {
        // 检查是否是项目Owner（super_admin始终允许登录）
        if (userInfo.openId === ENV.ownerOpenId) {
          // Owner可以自动创建
          await db.upsertUser({
            openId: userInfo.openId,
            name: userInfo.name || null,
            email: userInfo.email ?? null,
            loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
            lastSignedIn: new Date(),
          });
        } else {
          // 非Owner且未找到已有账号 → 拒绝登录
          console.warn(`[OAuth] Login rejected: no pre-created account found for email=${userInfo.email}, openId=${userInfo.openId}`);
          // 重定向到登录页并显示错误信息
          res.redirect(302, "/login?error=no_account&message=" + encodeURIComponent("您的账号尚未被管理员创建，请联系管理员添加账号后再登录"));
          return;
        }
      } else {
        // 已有用户 → 检查账号状态
        if (existingUser.status === "disabled") {
          console.warn(`[OAuth] Login rejected: account disabled for user ${existingUser.name}`);
          res.redirect(302, "/login?error=disabled&message=" + encodeURIComponent("您的账号已被禁用，请联系管理员"));
          return;
        }
        // 更新最后登录时间
        await db.updateUserById(existingUser.id, {
          lastSignedIn: new Date(),
        });
      }

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
