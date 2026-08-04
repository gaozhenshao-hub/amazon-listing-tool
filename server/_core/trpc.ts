import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { normalizeAppError, toTrpcError } from "./appError";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error, ctx }) {
    const normalized = normalizeAppError(error);
    return {
      ...shape,
      message: normalized.expose ? normalized.message : "系统内部错误",
      data: {
        ...shape.data,
        appCode: normalized.code,
        requestId: ctx?.requestId || "internal",
        retryable: normalized.retryable,
        details: normalized.details,
      },
    };
  },
});

export const router = t.router;
export const mergeRouters = t.mergeRouters;

const withErrorContract = t.middleware(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    throw toTrpcError(error);
  }
});

const baseProcedure = t.procedure.use(withErrorContract);
export const publicProcedure = baseProcedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = baseProcedure.use(requireUser);

export const adminProcedure = baseProcedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || !['super_admin', 'admin'].includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

// Manager-level procedure (super_admin, admin, ops_manager)
export const managerProcedure = baseProcedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || !['super_admin', 'admin', 'ops_manager'].includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
