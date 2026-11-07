import { getListingById } from "../../repositories/listing";
import { assertResearchEditable } from "./researchLocks";
import { protectedProcedure as authenticatedProcedure } from "../../_core/trpc";
import { TRPCError } from "@trpc/server";
import { actorFromContext, assertResourceAction } from "../../services/securityGovernance";

/** Module permissions complement the project-owner and revision checks in each
 * handler. A read-only account must not write through a hidden API endpoint. */
export const protectedProcedure = authenticatedProcedure.use(async ({ ctx, type, path, getRawInput, next }) => {
  if (ctx.workspaceId === undefined) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "工作区信息不完整，请重新登录" });
  }
  if (type === "mutation") {
    await assertResourceAction({ actor: actorFromContext(ctx), resource: "project",
      action: "update", workspaceId: ctx.workspaceId }, ctx);

    if(path.startsWith("listing.") && ctx.workspaceId){
      const raw=await getRawInput() as {projectId?:number;listingId?:number;id?:number};
      const listingId=raw?.listingId || (["listing.update","listing.delete"].includes(path)?raw?.id:undefined);
      const projectId=raw?.projectId || (listingId ? (await getListingById(listingId))?.projectId : undefined);
      if(projectId)await assertResearchEditable({projectId,workspaceId:ctx.workspaceId,userId:ctx.user.id},"listing");
    }
  }
  return next({ ctx });
});
