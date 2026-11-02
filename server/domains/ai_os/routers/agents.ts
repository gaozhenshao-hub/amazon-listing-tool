import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../../../_core/trpc";
import {
  actorFromContext,
  assertResourceAction,
  buildWorkspaceScopeFilter,
  recordSecurityAuditLog,
  workspaceIdFromContext,
  type SecurityAction,
  type SecurityRiskLevel,
} from "../../../services/securityGovernance";
import type { TrpcContext } from "../../../_core/context";
import {
  assertValidAgentDag,
  backfillAgentRunTemplateVersions,
  cancelAgentRun,
  confirmAgentNode,
  diffAgentArtifactVersions,
  diffAgentTemplateVersions,
  executeAgentNode,
  getAgentRun,
  listAgentArtifacts,
  listAgentTemplateVersions,
  normalizeAgentDag,
  pauseAgentRun,
  publishAgentTemplateVersion,
  recordAgentTemplateVersion,
  recoverTimedOutAgentNodes,
  rerunAgentNode,
  resolveAgentArtifactRef,
  resumeAgentRun,
  rollbackAgentArtifactVersion,
  rollbackAgentTemplateVersion,
  scheduleAgentRun,
  selectAgentArtifactVersion,
  setAgentTemplateRollout,
  startAgentRun,
  updateAgentNodeDraft,
  upsertListingAgentTemplate,
  validateAgentDag,
} from "../services/agentRunner";
import { listEmperorTools } from "../services/toolGateway";
import { rawExecute } from "../routerContext";
import { startImageStepGenerationForUser } from "../../image/services/startImageStepGeneration";

const IMAGE_WORKFLOW_SKILL_NODE_STEP: Record<string, 0 | 1 | 2 | 3> = {
  step0_skill: 0,
  step1_skill: 1,
  step2_skill: 2,
  step3_skill: 3,
};

export async function delegateImageWorkflowSkillNode(input: {
  runId: string;
  nodeId: string;
  user: { id: number; role: string };
  workspaceId?: number | null;
  getRunDetail?: typeof getAgentRun;
  startGeneration?: typeof startImageStepGenerationForUser;
}) {
  const step = IMAGE_WORKFLOW_SKILL_NODE_STEP[input.nodeId];
  if (step === undefined) return null;
  const detail = await (input.getRunDetail || getAgentRun)(input.runId, input.user.id);
  if (detail.run.agentSlug !== "image.workflow") return null;
  const projectId = Number(detail.run.projectId || detail.run.inputs?.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "图片工作流Agent缺少项目上下文，无法执行该节点" });
  }
  const job = await (input.startGeneration || startImageStepGenerationForUser)({
    projectId,
    step,
    user: input.user,
    workspaceId: input.workspaceId ?? null,
    agentRunId: input.runId,
  });
  return { delegated: true, businessProcedure: "imageWorkflow.startStepGeneration", step, job };
}

async function assertAgentAction(ctx: TrpcContext, action: SecurityAction, resourceId?: string | null) {
  await assertResourceAction({
    actor: actorFromContext(ctx),
    resource: "agent",
    action,
    resourceId,
  });
}

async function assertAgentRuntimeOwnsExecution(runId: string) {
  const rows = await rawExecute(
    `SELECT a.dagDefinition
     FROM emperor_agent_runs r
     JOIN emperor_agents a ON a.slug=r.agentSlug
     WHERE r.runId=?
     ORDER BY a.workspaceId IS NULL ASC
     LIMIT 1`,
    [runId],
  );
  const dag = rows[0]?.dagDefinition && typeof rows[0].dagDefinition === "string"
    ? JSON.parse(rows[0].dagDefinition)
    : rows[0]?.dagDefinition;
  if (dag?.executionOwner && dag.executionOwner !== "agent_runtime") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "该 Agent 由业务页面托管，请在对应业务阶段执行、编辑、确认或取消",
    });
  }
}

async function auditAgentAction(input: {
  ctx: TrpcContext;
  action: string;
  resourceId?: string | null;
  resourceName?: string | null;
  agentRunId?: string | null;
  status?: "success" | "denied" | "failed";
  riskLevel?: SecurityRiskLevel;
  metadata?: unknown;
}) {
  await recordSecurityAuditLog({
    ctx: input.ctx,
    workspaceId: workspaceIdFromContext(input.ctx),
    action: input.action,
    resourceType: "agent",
    resourceId: input.resourceId,
    resourceName: input.resourceName,
    agentRunId: input.agentRunId,
    status: input.status || "success",
    riskLevel: input.riskLevel || "medium",
    metadata: input.metadata,
  });
}

export const emperorAgentsRouter = router({
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      status: z.enum(["draft","active","deprecated"]).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      await assertAgentAction(ctx, "read");
      const scope = buildWorkspaceScopeFilter(workspaceIdFromContext(ctx));
      let sql = "SELECT id,workspaceId,slug,name,description,status,triggerType,scope,maxExecutionSeconds,dagDefinition,updatedAt,createdAt FROM emperor_agents";
      const params: any[] = [...scope.params];
      const where: string[] = [scope.clause];
      if (input?.search) { where.push("(name LIKE ? OR slug LIKE ?)"); params.push(`%${input.search}%`, `%${input.search}%`); }
      if (input?.status) { where.push("status=?"); params.push(input.status); }
      if (where.length) sql += " WHERE " + where.join(" AND ");
      sql += " ORDER BY workspaceId IS NULL ASC, updatedAt DESC";
      const rows = await rawExecute(sql, params);
      return rows.map((r: any) => {
        const dag = normalizeAgentDag(r.dagDefinition);
        return {
          ...r,
          dagDefinition: dag,
          validation: validateAgentDag(dag),
        };
      });
    }),

  get: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertAgentAction(ctx, "read", input.slug);
      const scope = buildWorkspaceScopeFilter(workspaceIdFromContext(ctx));
      const rows = await rawExecute(
        `SELECT *
         FROM emperor_agents
         WHERE slug = ? AND ${scope.clause}
         ORDER BY workspaceId IS NULL ASC
         LIMIT 1`,
        [input.slug, ...scope.params],
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      const dag = normalizeAgentDag(rows[0].dagDefinition);
      return { ...rows[0], dagDefinition: dag, validation: validateAgentDag(dag) };
    }),

  validateDag: protectedProcedure
    .input(z.object({ workflow: z.any() }))
    .query(async ({ input, ctx }) => {
      await assertAgentAction(ctx, "read");
      return validateAgentDag(input.workflow);
    }),

  create: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(128),
      slug: z.string().min(1).max(128),
      description: z.string().optional(),
      scope: z.enum(["global","project","private"]).optional().default("project"),
      triggerType: z.enum(["manual","event","scheduled"]).optional().default("manual"),
      maxExecutionSeconds: z.number().optional().default(300),
      cronExpression: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertAgentAction(ctx, "create", input.slug);
      const existing = await rawExecute("SELECT id FROM emperor_agents WHERE slug = ? LIMIT 1", [input.slug]);
      if (existing[0]) throw new TRPCError({ code: "CONFLICT", message: "Slug 已存在" });
      const workspaceId = workspaceIdFromContext(ctx);
      await rawExecute(
        `INSERT INTO emperor_agents (workspaceId,slug,name,description,status,scope,triggerType,maxExecutionSeconds,cronExpression,dagDefinition) VALUES (?,?,?,?, 'draft',?,?,?,?,?)`,
        [
          workspaceId,
          input.slug,
          input.name,
          input.description||null,
          input.scope,
          input.triggerType,
          input.maxExecutionSeconds,
          input.cronExpression||null,
          JSON.stringify({ nodes: [], edges: [] }),
        ]
      );
      await auditAgentAction({
        ctx,
        action: "agent.create",
        resourceId: input.slug,
        resourceName: input.name,
        riskLevel: "high",
        metadata: { scope: input.scope, triggerType: input.triggerType },
      });
      return { success: true, slug: input.slug };
    }),

  update: adminProcedure
    .input(z.object({
      slug: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(["draft","active","deprecated"]).optional(),
      triggerType: z.string().optional(),
      maxExecutionSeconds: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { slug, ...rest } = input;
      await assertAgentAction(ctx, "update", slug);
      const sets: string[] = []; const vals: any[] = [];
      let releasedDag: any = null;
      const scope = buildWorkspaceScopeFilter(workspaceIdFromContext(ctx));
      if (rest.status === "active") {
        const rows = await rawExecute(
          `SELECT name,dagDefinition
           FROM emperor_agents
           WHERE slug=? AND ${scope.clause}
           ORDER BY workspaceId IS NULL ASC
           LIMIT 1`,
          [slug, ...scope.params],
        );
        if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
        const dag = normalizeAgentDag(rows[0].dagDefinition);
        assertValidAgentDag(dag, "activate agent");
        releasedDag = { name: rows[0].name, dag };
      }
      if (rest.name !== undefined) { sets.push("name=?"); vals.push(rest.name); }
      if (rest.description !== undefined) { sets.push("description=?"); vals.push(rest.description); }
      if (rest.status !== undefined) { sets.push("status=?"); vals.push(rest.status); }
      if (rest.triggerType !== undefined) { sets.push("triggerType=?"); vals.push(rest.triggerType); }
      if (rest.maxExecutionSeconds !== undefined) { sets.push("maxExecutionSeconds=?"); vals.push(rest.maxExecutionSeconds); }
      if (!sets.length) return { success: true };
      sets.push("updatedAt=NOW()");
      vals.push(slug, ...scope.params);
      await rawExecute(`UPDATE emperor_agents SET ${sets.join(",")} WHERE slug=? AND ${scope.clause}`, vals);
      const templateVersion = releasedDag
        ? await recordAgentTemplateVersion({
          workspaceId: workspaceIdFromContext(ctx),
          agentSlug: slug,
          agentName: rest.name ?? releasedDag.name,
          dag: releasedDag.dag,
          status: "released",
          createdBy: ctx.user.id,
          releaseNotes: "Agent activated",
        })
        : null;
      await auditAgentAction({
        ctx,
        action: "agent.update",
        resourceId: slug,
        resourceName: rest.name || null,
        riskLevel: rest.status === "active" ? "high" : "medium",
        metadata: { status: rest.status, templateVersion },
      });
      return { success: true, templateVersion };
    }),

  saveWorkflow: adminProcedure
    .input(z.object({
      slug: z.string(),
      workflow: z.object({
        nodes: z.array(z.any()),
        edges: z.array(z.any()),
      }).passthrough(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertAgentAction(ctx, "update", input.slug);
      const dag = assertValidAgentDag(input.workflow, "save workflow");
      const scope = buildWorkspaceScopeFilter(workspaceIdFromContext(ctx));
      await rawExecute(
        `UPDATE emperor_agents SET dagDefinition=?, updatedAt=NOW() WHERE slug=? AND ${scope.clause}`,
        [JSON.stringify(dag), input.slug, ...scope.params]
      );
      const rows = await rawExecute(
        `SELECT name,status
         FROM emperor_agents
         WHERE slug=? AND ${scope.clause}
         ORDER BY workspaceId IS NULL ASC
         LIMIT 1`,
        [input.slug, ...scope.params],
      );
      const templateVersion = await recordAgentTemplateVersion({
        workspaceId: workspaceIdFromContext(ctx),
        agentSlug: input.slug,
        agentName: rows[0]?.name || null,
        dag,
        status: rows[0]?.status === "active" ? "released" : "draft",
        createdBy: ctx.user.id,
        releaseNotes: "Workflow saved",
      });
      await auditAgentAction({
        ctx,
        action: "agent.workflow.save",
        resourceId: input.slug,
        resourceName: rows[0]?.name || null,
        riskLevel: "high",
        metadata: { templateVersion, validation: validateAgentDag(dag) },
      });
      return { success: true, validation: validateAgentDag(dag), templateVersion };
    }),

  listTemplateVersions: protectedProcedure
    .input(z.object({
      slug: z.string(),
      limit: z.number().min(1).max(100).optional().default(20),
    }))
    .query(async ({ input, ctx }) => {
      await assertAgentAction(ctx, "read", input.slug);
      return listAgentTemplateVersions({
        agentSlug: input.slug,
        limit: input.limit,
        workspaceId: workspaceIdFromContext(ctx),
      });
    }),

  publishTemplateVersion: adminProcedure
    .input(z.object({
      slug: z.string(),
      versionId: z.number().int().positive().optional(),
      version: z.string().optional(),
      rolloutPercent: z.number().int().min(0).max(100).optional().default(100),
      rolloutPolicy: z.any().optional(),
      releaseNotes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertAgentAction(ctx, "update", input.slug);
      const result = await publishAgentTemplateVersion({
        agentSlug: input.slug,
        versionId: input.versionId ?? null,
        version: input.version ?? null,
        rolloutPercent: input.rolloutPercent,
        rolloutPolicy: input.rolloutPolicy,
        releaseNotes: input.releaseNotes || null,
        userId: ctx.user.id,
        workspaceId: workspaceIdFromContext(ctx),
      });
      await auditAgentAction({
        ctx,
        action: "agent_template.publish",
        resourceId: input.slug,
        riskLevel: "high",
        metadata: { versionId: input.versionId, version: input.version, rolloutPercent: input.rolloutPercent },
      });
      return result;
    }),

  rollbackTemplateVersion: adminProcedure
    .input(z.object({
      slug: z.string(),
      targetVersionId: z.number().int().positive().optional(),
      targetVersion: z.string().optional(),
      releaseNotes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertAgentAction(ctx, "update", input.slug);
      const result = await rollbackAgentTemplateVersion({
        agentSlug: input.slug,
        targetVersionId: input.targetVersionId ?? null,
        targetVersion: input.targetVersion ?? null,
        releaseNotes: input.releaseNotes || null,
        userId: ctx.user.id,
        workspaceId: workspaceIdFromContext(ctx),
      });
      await auditAgentAction({
        ctx,
        action: "agent_template.rollback",
        resourceId: input.slug,
        riskLevel: "high",
        metadata: { targetVersionId: input.targetVersionId, targetVersion: input.targetVersion },
      });
      return result;
    }),

  setTemplateRollout: adminProcedure
    .input(z.object({
      slug: z.string(),
      versionId: z.number().int().positive().optional(),
      version: z.string().optional(),
      rolloutPercent: z.number().int().min(0).max(100),
      rolloutPolicy: z.any().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertAgentAction(ctx, "update", input.slug);
      const result = await setAgentTemplateRollout({
        agentSlug: input.slug,
        versionId: input.versionId ?? null,
        version: input.version ?? null,
        rolloutPercent: input.rolloutPercent,
        rolloutPolicy: input.rolloutPolicy,
        userId: ctx.user.id,
        workspaceId: workspaceIdFromContext(ctx),
      });
      await auditAgentAction({
        ctx,
        action: "agent_template.rollout",
        resourceId: input.slug,
        riskLevel: "high",
        metadata: { versionId: input.versionId, version: input.version, rolloutPercent: input.rolloutPercent },
      });
      return result;
    }),

  diffTemplateVersions: protectedProcedure
    .input(z.object({
      slug: z.string(),
      baseVersionId: z.number().int().positive().optional(),
      baseVersion: z.string().optional(),
      targetVersionId: z.number().int().positive().optional(),
      targetVersion: z.string().optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    }))
    .query(async ({ input, ctx }) => {
      await assertAgentAction(ctx, "read", input.slug);
      return diffAgentTemplateVersions({
        agentSlug: input.slug,
        baseVersionId: input.baseVersionId ?? null,
        baseVersion: input.baseVersion ?? null,
        targetVersionId: input.targetVersionId ?? null,
        targetVersion: input.targetVersion ?? null,
        limit: input.limit,
        workspaceId: workspaceIdFromContext(ctx),
      });
    }),

  backfillRunTemplateVersions: adminProcedure
    .input(z.object({
      slug: z.string().optional(),
      limit: z.number().int().min(1).max(1000).optional(),
      dryRun: z.boolean().optional().default(false),
    }).optional())
    .mutation(async ({ input, ctx }) => {
      await assertAgentAction(ctx, "update", input?.slug || null);
      const result = await backfillAgentRunTemplateVersions({
        agentSlug: input?.slug ?? null,
        limit: input?.limit,
        dryRun: input?.dryRun,
        userId: ctx.user.id,
      });
      await auditAgentAction({
        ctx,
        action: "agent_template.backfill",
        resourceId: input?.slug || null,
        riskLevel: "high",
        metadata: { limit: input?.limit, dryRun: input?.dryRun, result },
      });
      return result;
    }),

  getAvailableSkills: protectedProcedure.query(async ({ ctx }) => {
    await assertAgentAction(ctx, "read");
    const scope = buildWorkspaceScopeFilter(workspaceIdFromContext(ctx));
    return rawExecute(
      `SELECT slug,name,description,category
       FROM emperor_skills
       WHERE status='Released' AND ${scope.clause}
       ORDER BY workspaceId IS NULL ASC, name`,
      scope.params,
    );
  }),

  getAvailableModels: protectedProcedure.query(async ({ ctx }) => {
    await assertAgentAction(ctx, "read");
    const scope = buildWorkspaceScopeFilter(workspaceIdFromContext(ctx));
    const rows = await rawExecute(
      `SELECT slug,name,provider,modelId,isDefault
       FROM emperor_model_providers
       WHERE isActive=1 AND ${scope.clause}
       ORDER BY workspaceId IS NULL ASC, isDefault DESC, name ASC`,
      scope.params,
    );
    return rows.map((r: any) => ({ ...r, isDefault: !!r.isDefault }));
  }),

  getAvailableMcpTools: protectedProcedure.query(async ({ ctx }) => {
    await assertResourceAction({ actor: actorFromContext(ctx), resource: "tool", action: "read" });
    const scope = buildWorkspaceScopeFilter(workspaceIdFromContext(ctx));
    return rawExecute(
      `SELECT slug,name,description,connectionType
       FROM emperor_mcp_connectors
       WHERE isActive=1 AND ${scope.clause}
       ORDER BY workspaceId IS NULL ASC, name`,
      scope.params,
    );
  }),

  getAvailableTools: protectedProcedure.query(async ({ ctx }) => {
    await assertResourceAction({ actor: actorFromContext(ctx), resource: "tool", action: "read" });
    return listEmperorTools(workspaceIdFromContext(ctx));
  }),

  run: protectedProcedure
    .input(z.object({
      slug: z.string(),
      inputs: z.record(z.string(), z.any()).optional().default({}),
      projectId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertAgentAction(ctx, "run", input.slug);
      const result = await startAgentRun({
        slug: input.slug,
        inputs: input.inputs,
        userId: ctx.user.id,
        workspaceId: workspaceIdFromContext(ctx),
        projectId: input.projectId ?? null,
      });
      await auditAgentAction({
        ctx,
        action: "agent.run",
        resourceId: input.slug,
        agentRunId: (result as any).runId || null,
        riskLevel: "medium",
        metadata: { projectId: input.projectId },
      });
      return result;
    }),

  getRun: protectedProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertAgentAction(ctx, "read", input.runId);
      const scope = buildWorkspaceScopeFilter(workspaceIdFromContext(ctx));
      const visible = await rawExecute(
        `SELECT runId FROM emperor_agent_runs WHERE runId=? AND ${scope.clause} LIMIT 1`,
        [input.runId, ...scope.params],
      );
      if (!visible[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Agent run not found" });
      return getAgentRun(input.runId, undefined, true);
    }),

  listArtifacts: protectedProcedure
    .input(z.object({
      runId: z.string(),
      nodeId: z.string().optional(),
      artifactKey: z.string().optional(),
      currentOnly: z.boolean().optional(),
    }))
    .query(async ({ input, ctx }) => {
      await assertAgentAction(ctx, "read", input.runId);
      const isAdmin = (ctx.user as any).role === "admin" || (ctx.user as any).role === "super_admin";
      return listAgentArtifacts({
        runId: input.runId,
        nodeId: input.nodeId,
        artifactKey: input.artifactKey,
        currentOnly: input.currentOnly,
        userId: isAdmin ? undefined : ctx.user.id,
        skipOwnerCheck: isAdmin,
      });
    }),

  getArtifactByRef: protectedProcedure
    .input(z.object({ ref: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      await assertAgentAction(ctx, "read");
      const isAdmin = (ctx.user as any).role === "admin" || (ctx.user as any).role === "super_admin";
      return resolveAgentArtifactRef({
        ref: input.ref,
        userId: isAdmin ? undefined : ctx.user.id,
        skipOwnerCheck: isAdmin,
      });
    }),

  selectArtifactVersion: protectedProcedure
    .input(z.object({
      runId: z.string(),
      nodeId: z.string(),
      artifactKey: z.string(),
      version: z.number().int().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertAgentAction(ctx, "confirm", input.runId);
      const result = await selectAgentArtifactVersion({
        runId: input.runId,
        nodeId: input.nodeId,
        artifactKey: input.artifactKey,
        version: input.version,
        userId: ctx.user.id,
      });
      await auditAgentAction({
        ctx,
        action: "agent_artifact.select_version",
        resourceId: input.artifactKey,
        agentRunId: input.runId,
        riskLevel: "medium",
        metadata: { nodeId: input.nodeId, version: input.version },
      });
      return result;
    }),

  rollbackArtifactVersion: protectedProcedure
    .input(z.object({
      runId: z.string(),
      nodeId: z.string(),
      artifactKey: z.string(),
      targetVersion: z.number().int().min(1).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertAgentAction(ctx, "update", input.runId);
      const result = await rollbackAgentArtifactVersion({
        runId: input.runId,
        nodeId: input.nodeId,
        artifactKey: input.artifactKey,
        targetVersion: input.targetVersion ?? null,
        userId: ctx.user.id,
      });
      await auditAgentAction({
        ctx,
        action: "agent_artifact.rollback",
        resourceId: input.artifactKey,
        agentRunId: input.runId,
        riskLevel: "high",
        metadata: { nodeId: input.nodeId, targetVersion: input.targetVersion ?? null },
      });
      return result;
    }),

  diffArtifactVersions: protectedProcedure
    .input(z.object({
      runId: z.string(),
      nodeId: z.string(),
      artifactKey: z.string(),
      baseVersion: z.number().int().min(1).optional(),
      targetVersion: z.union([z.number().int().min(1), z.literal("current")]).optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    }))
    .query(async ({ input, ctx }) => {
      await assertAgentAction(ctx, "read", input.runId);
      const isAdmin = (ctx.user as any).role === "admin" || (ctx.user as any).role === "super_admin";
      return diffAgentArtifactVersions({
        runId: input.runId,
        nodeId: input.nodeId,
        artifactKey: input.artifactKey,
        baseVersion: input.baseVersion ?? null,
        targetVersion: input.targetVersion ?? "current",
        limit: input.limit,
        userId: isAdmin ? undefined : ctx.user.id,
        skipOwnerCheck: isAdmin,
      });
    }),

  listRuns: protectedProcedure
    .input(z.object({ slug: z.string(), limit: z.number().optional().default(20) }))
    .query(async ({ input, ctx }) => {
      await assertAgentAction(ctx, "read", input.slug);
      const isAdmin = (ctx.user as any).role === "admin" || (ctx.user as any).role === "super_admin";
      const scope = buildWorkspaceScopeFilter(workspaceIdFromContext(ctx));
      if (isAdmin) {
        return rawExecute(
          `SELECT *
           FROM emperor_agent_runs
           WHERE agentSlug=? AND ${scope.clause}
           ORDER BY createdAt DESC
           LIMIT ?`,
          [input.slug, ...scope.params, input.limit],
        );
      }
      return rawExecute(
        `SELECT *
         FROM emperor_agent_runs
         WHERE agentSlug=? AND userId=? AND ${scope.clause}
         ORDER BY createdAt DESC
         LIMIT ?`,
        [input.slug, ctx.user.id, ...scope.params, input.limit],
      );
    }),

  listProjectRuns: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      agentSlug: z.string().max(128).optional(),
      limit: z.number().int().min(1).max(50).optional().default(10),
    }))
    .query(async ({ input, ctx }) => {
      await assertAgentAction(ctx, "read", String(input.projectId));
      const scope = buildWorkspaceScopeFilter(workspaceIdFromContext(ctx));
      const slugClause = input.agentSlug ? " AND agentSlug=?" : "";
      return rawExecute(
        `SELECT * FROM emperor_agent_runs
         WHERE projectId=? AND ${scope.clause}${slugClause}
         ORDER BY createdAt DESC LIMIT ?`,
        [input.projectId, ...scope.params, ...(input.agentSlug ? [input.agentSlug] : []), input.limit],
      );
    }),

  executeNode: protectedProcedure
    .input(z.object({ runId: z.string(), nodeId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertAgentAction(ctx, "run", input.runId);
      const delegated = await delegateImageWorkflowSkillNode({
        runId: input.runId,
        nodeId: input.nodeId,
        user: ctx.user,
        workspaceId: ctx.workspaceId,
      });
      if (delegated) return delegated;
      await assertAgentRuntimeOwnsExecution(input.runId);
      const result = await executeAgentNode({ runId: input.runId, nodeId: input.nodeId, userId: ctx.user.id });
      await auditAgentAction({
        ctx,
        action: "agent_node.execute",
        resourceId: input.nodeId,
        agentRunId: input.runId,
        riskLevel: "medium",
      });
      return result;
    }),

  scheduleRun: protectedProcedure
    .input(z.object({
      runId: z.string(),
      mode: z.enum(["unlock", "next", "all_ready"]).optional().default("unlock"),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertAgentAction(ctx, "run", input.runId);
      await assertAgentRuntimeOwnsExecution(input.runId);
      const result = await scheduleAgentRun({ runId: input.runId, userId: ctx.user.id, mode: input.mode });
      await auditAgentAction({
        ctx,
        action: "agent_run.schedule",
        resourceId: input.runId,
        agentRunId: input.runId,
        riskLevel: "medium",
        metadata: { mode: input.mode },
      });
      return result;
    }),

  cancelRun: protectedProcedure
    .input(z.object({
      runId: z.string(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertAgentAction(ctx, "cancel", input.runId);
      await assertAgentRuntimeOwnsExecution(input.runId);
      const result = await cancelAgentRun({ runId: input.runId, userId: ctx.user.id, reason: input.reason });
      await auditAgentAction({
        ctx,
        action: "agent_run.cancel",
        resourceId: input.runId,
        agentRunId: input.runId,
        riskLevel: "high",
        metadata: { reason: input.reason },
      });
      return result;
    }),

  pauseRun: protectedProcedure
    .input(z.object({
      runId: z.string(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertAgentAction(ctx, "cancel", input.runId);
      await assertAgentRuntimeOwnsExecution(input.runId);
      const result = await pauseAgentRun({ runId: input.runId, userId: ctx.user.id, reason: input.reason });
      await auditAgentAction({
        ctx,
        action: "agent_run.pause",
        resourceId: input.runId,
        agentRunId: input.runId,
        riskLevel: "medium",
        metadata: { reason: input.reason },
      });
      return result;
    }),

  resumeRun: protectedProcedure
    .input(z.object({
      runId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertAgentAction(ctx, "run", input.runId);
      await assertAgentRuntimeOwnsExecution(input.runId);
      const result = await resumeAgentRun({ runId: input.runId, userId: ctx.user.id });
      await auditAgentAction({
        ctx,
        action: "agent_run.resume",
        resourceId: input.runId,
        agentRunId: input.runId,
        riskLevel: "medium",
      });
      return result;
    }),

  recoverTimedOutNodes: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(200).optional() }).optional())
    .mutation(async ({ input, ctx }) => {
      await assertAgentAction(ctx, "update");
      const result = await recoverTimedOutAgentNodes({ limit: input?.limit });
      await auditAgentAction({
        ctx,
        action: "agent_node.recover_timed_out",
        riskLevel: "high",
        metadata: { limit: input?.limit, result },
      });
      return result;
    }),

  rerunNode: protectedProcedure
    .input(z.object({
      runId: z.string(),
      nodeId: z.string(),
      resetDescendants: z.boolean().optional().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertAgentAction(ctx, "run", input.runId);
      const delegated = await delegateImageWorkflowSkillNode({
        runId: input.runId,
        nodeId: input.nodeId,
        user: ctx.user,
        workspaceId: ctx.workspaceId,
      });
      if (delegated) return delegated;
      await assertAgentRuntimeOwnsExecution(input.runId);
      const result = await rerunAgentNode({
        runId: input.runId,
        nodeId: input.nodeId,
        userId: ctx.user.id,
        resetDescendants: input.resetDescendants,
      });
      await auditAgentAction({
        ctx,
        action: "agent_node.rerun",
        resourceId: input.nodeId,
        agentRunId: input.runId,
        riskLevel: "medium",
        metadata: { resetDescendants: input.resetDescendants },
      });
      return result;
    }),

  updateNodeDraft: protectedProcedure
    .input(z.object({
      runId: z.string(),
      nodeId: z.string(),
      userEdit: z.any(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertAgentAction(ctx, "update", input.runId);
      await assertAgentRuntimeOwnsExecution(input.runId);
      const result = await updateAgentNodeDraft({
        runId: input.runId,
        nodeId: input.nodeId,
        userId: ctx.user.id,
        userEdit: input.userEdit,
      });
      await auditAgentAction({
        ctx,
        action: "agent_node.update_draft",
        resourceId: input.nodeId,
        agentRunId: input.runId,
        riskLevel: "medium",
      });
      return result;
    }),

  confirmNode: protectedProcedure
    .input(z.object({
      runId: z.string(),
      nodeId: z.string(),
      output: z.any().optional(),
      userEdit: z.any().optional(),
      skip: z.boolean().optional().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertAgentAction(ctx, "confirm", input.runId);
      await assertAgentRuntimeOwnsExecution(input.runId);
      const result = await confirmAgentNode({
        runId: input.runId,
        nodeId: input.nodeId,
        userId: ctx.user.id,
        output: input.output,
        userEdit: input.userEdit,
        skip: input.skip,
      });
      await auditAgentAction({
        ctx,
        action: input.skip ? "agent_node.skip" : "agent_node.confirm",
        resourceId: input.nodeId,
        agentRunId: input.runId,
        riskLevel: "high",
      });
      return result;
    }),

  installListingTemplate: adminProcedure
    .mutation(async ({ ctx }) => {
      await assertAgentAction(ctx, "create", "listing-generation-v2");
      const result = await upsertListingAgentTemplate();
      await auditAgentAction({
        ctx,
        action: "agent_template.install_listing",
        resourceId: "listing-generation-v2",
        riskLevel: "high",
        metadata: result,
      });
      return result;
    }),

  upsert: adminProcedure
    .input(z.object({
      slug: z.string(),
      name: z.string(),
      description: z.string().optional(),
      category: z.string().optional(),
      status: z.enum(["draft","active","deprecated"]).optional().default("draft"),
      dagDefinition: z.any(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertAgentAction(ctx, "update", input.slug);
      const dag = assertValidAgentDag(input.dagDefinition, "upsert agent");
      const workspaceId = workspaceIdFromContext(ctx);
      await rawExecute(
        `INSERT INTO emperor_agents (workspaceId,slug,name,description,category,status,dagDefinition) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE workspaceId=VALUES(workspaceId),name=VALUES(name),description=VALUES(description),category=VALUES(category),status=VALUES(status),dagDefinition=VALUES(dagDefinition),updatedAt=NOW()`,
        [workspaceId, input.slug, input.name, input.description||null, input.category||"通用", input.status, JSON.stringify(dag)]
      );
      const templateVersion = await recordAgentTemplateVersion({
        workspaceId,
        agentSlug: input.slug,
        agentName: input.name,
        dag,
        status: input.status === "active" ? "released" : "draft",
        createdBy: ctx.user.id,
        releaseNotes: "Agent upserted",
      });
      await auditAgentAction({
        ctx,
        action: "agent.upsert",
        resourceId: input.slug,
        resourceName: input.name,
        riskLevel: input.status === "active" ? "high" : "medium",
        metadata: { templateVersion },
      });
      return { success: true, validation: validateAgentDag(dag), templateVersion };
    }),

  delete: adminProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await assertAgentAction(ctx, "delete", input.slug);
      const scope = buildWorkspaceScopeFilter(workspaceIdFromContext(ctx));
      await rawExecute(
        `DELETE FROM emperor_agents WHERE slug = ? AND ${scope.clause}`,
        [input.slug, ...scope.params],
      );
      await auditAgentAction({
        ctx,
        action: "agent.delete",
        resourceId: input.slug,
        riskLevel: "high",
      });
      return { success: true };
    }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Scheduled Tasks Router
// ─────────────────────────────────────────────────────────────────────────────
