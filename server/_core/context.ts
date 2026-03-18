import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import * as db from "../db";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // OAuth auth failed, try password-based session
    try {
      const { parse: parseCookieHeader } = await import("cookie");
      const cookies = opts.req.headers.cookie
        ? new Map(Object.entries(parseCookieHeader(opts.req.headers.cookie)))
        : new Map<string, string>();
      const sessionCookie = cookies.get("app_session_id");
      const session = await sdk.verifySession(sessionCookie);

      if (session && session.openId.startsWith("pwd_")) {
        // Password-based user session
        const userId = parseInt(session.openId.replace("pwd_", ""), 10);
        if (!isNaN(userId)) {
          const pwdUser = await db.getUserById(userId);
          if (pwdUser && pwdUser.status === "active") {
            user = pwdUser;
          }
        }
      }
    } catch {
      // Authentication is optional for public procedures.
      user = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
