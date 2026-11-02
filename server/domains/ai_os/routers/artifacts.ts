import { z } from "zod";
import { protectedProcedure, router } from "../../../_core/trpc";
import {
  actorFromContext,
  assertResourceAction,
  recordSecurityAuditLog,
  workspaceIdFromContext,
} from "../../../services/securityGovernance";
import {
  listBusinessArtifactVersions,
  resolveCurrentBusinessArtifact,
  rollbackBusinessArtifactVersion,
  selectBusinessArtifactVersion,
} from "../services/businessArtifactRegistry";
import { rawExecute } from "../routerContext";

const domainSchema = z.enum(["listing", "image", "ads", "video", "agent", "project", "file", "ops", "tool", "other"]);
const scopeSchema = z.object({
  domain: domainSchema,
  artifactKey: z.string().min(1).max(128),
  sourceTable: z.string().max(128).nullish(),
  sourceRowId: z.union([z.string().max(128), z.number().int()]).nullish(),
  projectId: z.number().int().positive().nullish(),
  runId: z.string().max(80).nullish(),
  nodeId: z.string().max(128).nullish(),
});

async function assertArtifactAction(ctx: any, action: "read" | "update" | "confirm", resourceId?: string) {
  await assertResourceAction({
    actor: actorFromContext(ctx),
    resource: "agent",
    action,
    resourceId,
  });
}

export const emperorArtifactsRouter = router({
  getCurrent: protectedProcedure
    .input(scopeSchema)
    .query(async ({ ctx, input }) => {
      await assertArtifactAction(ctx, "read", input.artifactKey);
      return resolveCurrentBusinessArtifact({
        ...input,
        workspaceId: workspaceIdFromContext(ctx),
      });
    }),

  listVersions: protectedProcedure
    .input(scopeSchema.extend({ limit: z.number().int().min(1).max(200).optional() }))
    .query(async ({ ctx, input }) => {
      await assertArtifactAction(ctx, "read", input.artifactKey);
      return listBusinessArtifactVersions({
        ...input,
        workspaceId: workspaceIdFromContext(ctx),
      });
    }),

  selectVersion: protectedProcedure
    .input(z.object({
      artifactId: z.string().min(1).max(80),
      reason: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertArtifactAction(ctx, "confirm", input.artifactId);
      const result = await selectBusinessArtifactVersion({
        artifactId: input.artifactId,
        workspaceId: workspaceIdFromContext(ctx),
        userId: ctx.user.id,
        reason: input.reason,
      });
      await recordSecurityAuditLog({
        ctx,
        action: "artifact.select_version",
        resourceType: "artifact",
        resourceId: input.artifactId,
        riskLevel: "medium",
        metadata: { operation: "artifact.select_version", version: result?.version ?? null },
      });
      return result;
    }),

  rollback: protectedProcedure
    .input(scopeSchema.extend({
      targetVersion: z.number().int().positive().optional(),
      reason: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertArtifactAction(ctx, "update", input.artifactKey);
      const result = await rollbackBusinessArtifactVersion({
        scope: {
          ...input,
          workspaceId: workspaceIdFromContext(ctx),
        },
        targetVersion: input.targetVersion,
        userId: ctx.user.id,
        reason: input.reason,
      });
      await recordSecurityAuditLog({
        ctx,
        action: "artifact.rollback",
        resourceType: "artifact",
        resourceId: input.artifactKey,
        riskLevel: "high",
        metadata: { operation: "artifact.rollback", targetVersion: input.targetVersion ?? null },
      });
      return result;
    }),

  listConsumptions: protectedProcedure
    .input(z.object({ artifactId: z.string().min(1).max(80), limit: z.number().int().min(1).max(200).optional() }))
    .query(async ({ ctx, input }) => {
      await assertArtifactAction(ctx, "read", input.artifactId);
      const workspaceId = workspaceIdFromContext(ctx);
      const scope = workspaceId === null ? "workspaceId IS NULL" : "workspaceId=?";
      return rawExecute(
        `SELECT * FROM ai_artifact_consumptions
         WHERE artifactId=? AND ${scope}
         ORDER BY createdAt DESC LIMIT ?`,
        [input.artifactId, ...(workspaceId === null ? [] : [workspaceId]), input.limit || 100],
      );
    }),
});
