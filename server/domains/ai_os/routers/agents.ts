import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../../../_core/trpc";
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

export const emperorAgentsRouter = router({
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      status: z.enum(["draft","active","deprecated"]).optional(),
    }).optional())
    .query(async ({ input }) => {
      let sql = "SELECT id,slug,name,description,status,triggerType,scope,maxExecutionSeconds,dagDefinition,updatedAt,createdAt FROM emperor_agents";
      const params: any[] = [];
      const where: string[] = [];
      if (input?.search) { where.push("(name LIKE ? OR slug LIKE ?)"); params.push(`%${input.search}%`, `%${input.search}%`); }
      if (input?.status) { where.push("status=?"); params.push(input.status); }
      if (where.length) sql += " WHERE " + where.join(" AND ");
      sql += " ORDER BY updatedAt DESC";
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
    .query(async ({ input }) => {
      const rows = await rawExecute("SELECT * FROM emperor_agents WHERE slug = ? LIMIT 1", [input.slug]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      const dag = normalizeAgentDag(rows[0].dagDefinition);
      return { ...rows[0], dagDefinition: dag, validation: validateAgentDag(dag) };
    }),

  validateDag: protectedProcedure
    .input(z.object({ workflow: z.any() }))
    .query(async ({ input }) => {
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
    .mutation(async ({ input }) => {
      const existing = await rawExecute("SELECT id FROM emperor_agents WHERE slug = ? LIMIT 1", [input.slug]);
      if (existing[0]) throw new TRPCError({ code: "CONFLICT", message: "Slug 已存在" });
      await rawExecute(
        `INSERT INTO emperor_agents (slug,name,description,status,scope,triggerType,maxExecutionSeconds,cronExpression,dagDefinition) VALUES (?,?,?,'draft',?,?,?,?,?)`,
        [
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
      const sets: string[] = []; const vals: any[] = [];
      let releasedDag: any = null;
      if (rest.status === "active") {
        const rows = await rawExecute("SELECT name,dagDefinition FROM emperor_agents WHERE slug=? LIMIT 1", [slug]);
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
      vals.push(slug);
      await rawExecute(`UPDATE emperor_agents SET ${sets.join(",")} WHERE slug=?`, vals);
      const templateVersion = releasedDag
        ? await recordAgentTemplateVersion({
          agentSlug: slug,
          agentName: rest.name ?? releasedDag.name,
          dag: releasedDag.dag,
          status: "released",
          createdBy: ctx.user.id,
          releaseNotes: "Agent activated",
        })
        : null;
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
      const dag = assertValidAgentDag(input.workflow, "save workflow");
      await rawExecute(
        "UPDATE emperor_agents SET dagDefinition=?, updatedAt=NOW() WHERE slug=?",
        [JSON.stringify(dag), input.slug]
      );
      const rows = await rawExecute("SELECT name,status FROM emperor_agents WHERE slug=? LIMIT 1", [input.slug]);
      const templateVersion = await recordAgentTemplateVersion({
        agentSlug: input.slug,
        agentName: rows[0]?.name || null,
        dag,
        status: rows[0]?.status === "active" ? "released" : "draft",
        createdBy: ctx.user.id,
        releaseNotes: "Workflow saved",
      });
      return { success: true, validation: validateAgentDag(dag), templateVersion };
    }),

  listTemplateVersions: protectedProcedure
    .input(z.object({
      slug: z.string(),
      limit: z.number().min(1).max(100).optional().default(20),
    }))
    .query(async ({ input }) => {
      return listAgentTemplateVersions({ agentSlug: input.slug, limit: input.limit });
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
      return publishAgentTemplateVersion({
        agentSlug: input.slug,
        versionId: input.versionId ?? null,
        version: input.version ?? null,
        rolloutPercent: input.rolloutPercent,
        rolloutPolicy: input.rolloutPolicy,
        releaseNotes: input.releaseNotes || null,
        userId: ctx.user.id,
      });
    }),

  rollbackTemplateVersion: adminProcedure
    .input(z.object({
      slug: z.string(),
      targetVersionId: z.number().int().positive().optional(),
      targetVersion: z.string().optional(),
      releaseNotes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return rollbackAgentTemplateVersion({
        agentSlug: input.slug,
        targetVersionId: input.targetVersionId ?? null,
        targetVersion: input.targetVersion ?? null,
        releaseNotes: input.releaseNotes || null,
        userId: ctx.user.id,
      });
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
      return setAgentTemplateRollout({
        agentSlug: input.slug,
        versionId: input.versionId ?? null,
        version: input.version ?? null,
        rolloutPercent: input.rolloutPercent,
        rolloutPolicy: input.rolloutPolicy,
        userId: ctx.user.id,
      });
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
    .query(async ({ input }) => {
      return diffAgentTemplateVersions({
        agentSlug: input.slug,
        baseVersionId: input.baseVersionId ?? null,
        baseVersion: input.baseVersion ?? null,
        targetVersionId: input.targetVersionId ?? null,
        targetVersion: input.targetVersion ?? null,
        limit: input.limit,
      });
    }),

  backfillRunTemplateVersions: adminProcedure
    .input(z.object({
      slug: z.string().optional(),
      limit: z.number().int().min(1).max(1000).optional(),
      dryRun: z.boolean().optional().default(false),
    }).optional())
    .mutation(async ({ input, ctx }) => {
      return backfillAgentRunTemplateVersions({
        agentSlug: input?.slug ?? null,
        limit: input?.limit,
        dryRun: input?.dryRun,
        userId: ctx.user.id,
      });
    }),

  getAvailableSkills: protectedProcedure.query(async () => {
    return rawExecute("SELECT slug,name,description,category FROM emperor_skills WHERE status='Released' ORDER BY name");
  }),

  getAvailableModels: protectedProcedure.query(async () => {
    const rows = await rawExecute("SELECT slug,name,provider,modelId,isDefault FROM emperor_model_providers WHERE isActive=1 ORDER BY isDefault DESC, name ASC");
    return rows.map((r: any) => ({ ...r, isDefault: !!r.isDefault }));
  }),

  getAvailableMcpTools: protectedProcedure.query(async () => {
    return rawExecute("SELECT slug,name,description,connectionType FROM emperor_mcp_connectors WHERE isActive=1 ORDER BY name");
  }),

  getAvailableTools: protectedProcedure.query(async () => {
    return listEmperorTools();
  }),

  run: protectedProcedure
    .input(z.object({
      slug: z.string(),
      inputs: z.record(z.string(), z.any()).optional().default({}),
      projectId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return startAgentRun({
        slug: input.slug,
        inputs: input.inputs,
        userId: ctx.user.id,
        projectId: input.projectId ?? null,
      });
    }),

  getRun: protectedProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ input, ctx }) => {
      const isAdmin = (ctx.user as any).role === "admin" || (ctx.user as any).role === "super_admin";
      return getAgentRun(input.runId, isAdmin ? undefined : ctx.user.id, isAdmin);
    }),

  listArtifacts: protectedProcedure
    .input(z.object({
      runId: z.string(),
      nodeId: z.string().optional(),
      artifactKey: z.string().optional(),
      currentOnly: z.boolean().optional(),
    }))
    .query(async ({ input, ctx }) => {
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
      return selectAgentArtifactVersion({
        runId: input.runId,
        nodeId: input.nodeId,
        artifactKey: input.artifactKey,
        version: input.version,
        userId: ctx.user.id,
      });
    }),

  rollbackArtifactVersion: protectedProcedure
    .input(z.object({
      runId: z.string(),
      nodeId: z.string(),
      artifactKey: z.string(),
      targetVersion: z.number().int().min(1).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return rollbackAgentArtifactVersion({
        runId: input.runId,
        nodeId: input.nodeId,
        artifactKey: input.artifactKey,
        targetVersion: input.targetVersion ?? null,
        userId: ctx.user.id,
      });
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
      const isAdmin = (ctx.user as any).role === "admin" || (ctx.user as any).role === "super_admin";
      if (isAdmin) {
        return rawExecute("SELECT * FROM emperor_agent_runs WHERE agentSlug=? ORDER BY createdAt DESC LIMIT ?", [input.slug, input.limit]);
      }
      return rawExecute("SELECT * FROM emperor_agent_runs WHERE agentSlug=? AND userId=? ORDER BY createdAt DESC LIMIT ?", [input.slug, ctx.user.id, input.limit]);
    }),

  executeNode: protectedProcedure
    .input(z.object({ runId: z.string(), nodeId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return executeAgentNode({ runId: input.runId, nodeId: input.nodeId, userId: ctx.user.id });
    }),

  scheduleRun: protectedProcedure
    .input(z.object({
      runId: z.string(),
      mode: z.enum(["unlock", "next", "all_ready"]).optional().default("unlock"),
    }))
    .mutation(async ({ ctx, input }) => {
      return scheduleAgentRun({ runId: input.runId, userId: ctx.user.id, mode: input.mode });
    }),

  cancelRun: protectedProcedure
    .input(z.object({
      runId: z.string(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return cancelAgentRun({ runId: input.runId, userId: ctx.user.id, reason: input.reason });
    }),

  pauseRun: protectedProcedure
    .input(z.object({
      runId: z.string(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return pauseAgentRun({ runId: input.runId, userId: ctx.user.id, reason: input.reason });
    }),

  resumeRun: protectedProcedure
    .input(z.object({
      runId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      return resumeAgentRun({ runId: input.runId, userId: ctx.user.id });
    }),

  recoverTimedOutNodes: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(200).optional() }).optional())
    .mutation(async ({ input }) => {
      return recoverTimedOutAgentNodes({ limit: input?.limit });
    }),

  rerunNode: protectedProcedure
    .input(z.object({
      runId: z.string(),
      nodeId: z.string(),
      resetDescendants: z.boolean().optional().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      return rerunAgentNode({
        runId: input.runId,
        nodeId: input.nodeId,
        userId: ctx.user.id,
        resetDescendants: input.resetDescendants,
      });
    }),

  updateNodeDraft: protectedProcedure
    .input(z.object({
      runId: z.string(),
      nodeId: z.string(),
      userEdit: z.any(),
    }))
    .mutation(async ({ ctx, input }) => {
      return updateAgentNodeDraft({
        runId: input.runId,
        nodeId: input.nodeId,
        userId: ctx.user.id,
        userEdit: input.userEdit,
      });
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
      return confirmAgentNode({
        runId: input.runId,
        nodeId: input.nodeId,
        userId: ctx.user.id,
        output: input.output,
        userEdit: input.userEdit,
        skip: input.skip,
      });
    }),

  installListingTemplate: adminProcedure
    .mutation(async () => {
      return upsertListingAgentTemplate();
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
      const dag = assertValidAgentDag(input.dagDefinition, "upsert agent");
      await rawExecute(
        `INSERT INTO emperor_agents (slug,name,description,category,status,dagDefinition) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),category=VALUES(category),status=VALUES(status),dagDefinition=VALUES(dagDefinition),updatedAt=NOW()`,
        [input.slug, input.name, input.description||null, input.category||"通用", input.status, JSON.stringify(dag)]
      );
      const templateVersion = await recordAgentTemplateVersion({
        agentSlug: input.slug,
        agentName: input.name,
        dag,
        status: input.status === "active" ? "released" : "draft",
        createdBy: ctx.user.id,
        releaseNotes: "Agent upserted",
      });
      return { success: true, validation: validateAgentDag(dag), templateVersion };
    }),

  delete: adminProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ input }) => {
      await rawExecute("DELETE FROM emperor_agents WHERE slug = ?", [input.slug]);
      return { success: true };
    }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Scheduled Tasks Router
// ─────────────────────────────────────────────────────────────────────────────
