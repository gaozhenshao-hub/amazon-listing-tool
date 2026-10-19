import { splitLink, type TRPCLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";

/** Large source uploads explicitly opt out of coalescing. Every ordinary
 * operation keeps the existing batch transport and its unchanged options. */
export function singleRequestOptInLink<TRouter extends AnyRouter>(
  single: TRPCLink<TRouter>,
  batch: TRPCLink<TRouter>,
): TRPCLink<TRouter> {
  return splitLink({ condition: operation => operation.context.skipBatch === true, true: single, false: batch });
}
