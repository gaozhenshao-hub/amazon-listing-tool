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
    // Step 1: Try to verify the session JWT first (works for both OAuth and password users)
    const { parse: parseCookieHeader } = await import("cookie");
    const cookies = opts.req.headers.cookie
      ? new Map(Object.entries(parseCookieHeader(opts.req.headers.cookie)))
      : new Map<string, string>();
    const sessionCookie = cookies.get("app_session_id");
    const session = await sdk.verifySession(sessionCookie);

    if (session) {
      if (session.openId.startsWith("pwd_")) {
        // Step 2a: Password-based user session - look up by user ID directly
        const userId = parseInt(session.openId.replace("pwd_", ""), 10);
        if (!isNaN(userId)) {
          const pwdUser = await db.getUserById(userId);
          if (pwdUser && pwdUser.status === "active") {
            user = pwdUser;
          }
        }
      } else {
        // Step 2b: OAuth user session - use the standard authenticateRequest flow
        try {
          user = await sdk.authenticateRequest(opts.req);
        } catch {
          // OAuth auth failed, user stays null
        }
      }
    }
  } catch {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
