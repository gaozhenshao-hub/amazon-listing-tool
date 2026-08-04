import { TRPCError, createHash, buildWorkspaceScopeFilter, recordAiOsMetric, EmperorAgentNode, EmperorAgentEdge, EmperorAgentDag, AgentTemplateVersionStatus, LISTING_AGENT_SLUG, hashJson, buildStoredAgentRunInputs, parseStoredAgentRunInputs, rawExecute, parseJson, stringifyJson, stringifyJsonOrNull, normalizeAgentDag, validateAgentDag, assertValidAgentDag } from "./runtimeCore";
import { diffAgentArtifactContent } from "./artifactStore";
export function getListingAgentDag(): EmperorAgentDag {
  const node = (
    id: string,
    nodeType: string,
    label: string,
    subtitle: string,
    x: number,
    y: number,
    extra: Partial<EmperorAgentNode> = {},
  ): EmperorAgentNode => ({
    id,
    nodeType,
    label,
    subtitle,
    x,
    y,
    humanGate: true,
    required: true,
    ...extra,
  });

  const edge = (source: string, target: string, label?: string, kind: EmperorAgentEdge["kind"] = "required"): EmperorAgentEdge => ({
    id: `${source}-${target}`,
    source,
    target,
    from: source,
    to: target,
    label,
    kind,
    required: kind === "required",
  });

  return {
    version: "1.0.0",
    workflowType: "human_in_loop_dag",
    description: "完整 Listing 长工作流：前置数据准备、生成主链、输出优化和扩展内容。",
    nodes: [
      node("N0", "input_node", "N0 · 项目管理", "品牌/产品/市场基础信息", 520, 20, {
        toolSlug: "internal.agent.capture_input",
        outputKey: "project",
      }),
      node("N1", "skill_node", "N1 · 竞品分析", "ASIN/竞品 Listing 分析", 110, 150, { skillSlug: "listing.competitor.analyze", outputKey: "competitorAnalysis" }),
      node("N2", "skill_node", "N2 · 竞品对比", "多竞品横向对比", -80, 350, { skillSlug: "analysis.competitor.multi", outputKey: "competitorComparison" }),
      node("N3", "skill_node", "N3 · 数据文件", "产品属性 / Rufus / 买家问题", 780, 350, { skillSlug: "analysis.rufus.attribute", outputKey: "productAttributes" }),
      node("N4", "skill_node", "N4 · 关键词管理", "关键词矩阵与词根分类", 520, 350, { skillSlug: "keyword.listing.layout", outputKey: "keywordMatrix" }),
      node("N5", "skill_node", "N5 · 评论聚合分析", "痛点/痒点/爽点提取", 160, 350, { skillSlug: "analysis.review.extract", outputKey: "reviewAggregation" }),
      node("G1", "skill_node", "G1 · 卖点精雕", "7条卖点核心方向", 360, 620, { skillSlug: "listing.sellingpoints.generate", outputKey: "sellingPoints" }),
      node("G2", "skill_node", "G2 · 标题生成", "200字符内核心词前置", 360, 820, { skillSlug: "listing.title.generate", outputKey: "title" }),
      node("G3", "skill_node", "G3 · 产品描述", "长描述 + A+内容规划", 360, 1020, { skillSlug: "listing.description.generate", outputKey: "description" }),
      node("G4", "skill_node", "G4 · 搜索词", "后台关键词 250 字符", 360, 1220, { skillSlug: "listing.searchterms.generate", outputKey: "searchTerms" }),
      node("G5", "skill_node", "G5 · QA问答", "买家问题与专业解答", 360, 1420, { skillSlug: "listing.qa.generate", outputKey: "qaContent" }),
      node("O1", "output_node", "O1 · 结果预览", "完整 Listing 中英文版本", 360, 1620, {
        toolSlug: "internal.listing.compose_preview",
        outputKey: "listingPreview",
      }),
      node("O2", "skill_node", "O2 · Listing评分", "多维度质量评估", 190, 1820, { skillSlug: "listing.scoring.overall", outputKey: "listingScore", required: false }),
      node("O3", "skill_node", "O3 · 广告架构", "广告词 + 投放策略", 190, 2020, { skillSlug: "ad.structure.generate", outputKey: "adStructure", required: false }),
      node("E1", "skill_node", "E1 · 智能图片建议", "图片结构与构图建议", 560, 1820, { skillSlug: "listing.image.advice", outputKey: "imageAdvice", required: false }),
      node("E2", "skill_node", "E2 · 视频脚本", "产品视频脚本与分镜", 560, 2020, { skillSlug: "video.edit.script", outputKey: "videoScript", required: false }),
    ],
    edges: [
      edge("N0", "N1"), edge("N0", "N3"), edge("N1", "N2"), edge("N1", "N5"),
      edge("N1", "G1"), edge("N2", "G1", "差异化建议"), edge("N3", "G1", "产品属性"),
      edge("N4", "G1", "策略矩阵"), edge("N5", "G1", "痛点/爽点"), edge("G1", "G2"),
      edge("N4", "G2", "关键词矩阵"), edge("G2", "G3"), edge("G2", "G4"), edge("G1", "G4"),
      edge("N4", "G4", "词根分类"), edge("G1", "G5"), edge("N3", "G5", "买家问题库", "suggested"),
      edge("N5", "G5", "评论洞察"), edge("G1", "O1"), edge("G2", "O1"), edge("G3", "O1"),
      edge("G4", "O1"), edge("G5", "O1"), edge("O1", "O2", "评分"), edge("N4", "O3", "广告关键词"),
      edge("O1", "O3", "Listing内容"), edge("G1", "E1"), edge("G2", "E1"), edge("N5", "E1", "用户痛点"),
      edge("G1", "E2"), edge("E1", "E2", "图片建议"),
    ],
  };
}

function normalizeTemplateVersionRow(row: any) {
  return {
    ...row,
    isDefault: Boolean(row?.isDefault),
    rolloutPercent: Math.min(Math.max(Number(row?.rolloutPercent ?? 100), 0), 100),
    rolloutPolicy: parseJson(row?.rolloutPolicy, null),
    dagDefinition: normalizeAgentDag(row.dagDefinition),
  };
}

function templateRolloutBucket(input: { agentSlug: string; userId: number; projectId?: number | null; version: string }) {
  const key = `${input.agentSlug}:${input.version}:${input.userId}:${input.projectId ?? "none"}`;
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 8);
  return Number.parseInt(hash, 16) % 100;
}

async function findAgentTemplateVersion(input: {
  agentSlug: string;
  versionId?: number | null;
  version?: string | null;
  workspaceId?: number | null;
}) {
  if (!input.versionId && !input.version) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Template versionId or version is required" });
  }
  const scope = input.workspaceId === undefined ? null : buildWorkspaceScopeFilter(input.workspaceId);
  const rows = input.versionId
    ? await rawExecute(
      scope
        ? `SELECT * FROM emperor_agent_template_versions WHERE agentSlug=? AND id=? AND ${scope.clause} ORDER BY workspaceId IS NULL ASC LIMIT 1`
        : "SELECT * FROM emperor_agent_template_versions WHERE agentSlug=? AND id=? LIMIT 1",
      scope ? [input.agentSlug, input.versionId, ...scope.params] : [input.agentSlug, input.versionId],
    )
    : await rawExecute(
      scope
        ? `SELECT * FROM emperor_agent_template_versions WHERE agentSlug=? AND version=? AND ${scope.clause} ORDER BY workspaceId IS NULL ASC LIMIT 1`
        : "SELECT * FROM emperor_agent_template_versions WHERE agentSlug=? AND version=? LIMIT 1",
      scope ? [input.agentSlug, input.version || "", ...scope.params] : [input.agentSlug, input.version || ""],
    );
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Agent template version not found" });
  return normalizeTemplateVersionRow(rows[0]);
}

async function getDefaultAgentTemplateVersion(agentSlug: string, workspaceId?: number | null) {
  const scope = buildWorkspaceScopeFilter(workspaceId);
  const rows = await rawExecute(
    `SELECT * FROM emperor_agent_template_versions
     WHERE agentSlug=? AND status='released' AND isDefault=1 AND ${scope.clause}
     ORDER BY versionNumber DESC, id DESC
     LIMIT 1`,
    [agentSlug, ...scope.params],
  );
  return rows[0] ? normalizeTemplateVersionRow(rows[0]) : null;
}

async function selectAgentTemplateVersionForRun(input: {
  agent: any;
  userId: number;
  workspaceId?: number | null;
  projectId?: number | null;
}) {
  const scope = buildWorkspaceScopeFilter(input.workspaceId ?? input.agent.workspaceId ?? null);
  const canaryRows = await rawExecute(
    `SELECT * FROM emperor_agent_template_versions
     WHERE agentSlug=? AND status='released' AND isDefault=0 AND rolloutPercent > 0 AND rolloutPercent < 100 AND ${scope.clause}
     ORDER BY versionNumber DESC, id DESC
     LIMIT 20`,
    [input.agent.slug, ...scope.params],
  ).catch(() => []);
  for (const row of canaryRows) {
    const template = normalizeTemplateVersionRow(row);
    if (templateRolloutBucket({
      agentSlug: input.agent.slug,
      version: template.version,
      userId: input.userId,
      projectId: input.projectId ?? null,
    }) < template.rolloutPercent) {
      return template;
    }
  }

  const defaultVersion = await getDefaultAgentTemplateVersion(input.agent.slug, input.workspaceId ?? input.agent.workspaceId ?? null).catch(() => null);
  if (defaultVersion) return defaultVersion;
  return recordAgentTemplateVersion({
    workspaceId: input.workspaceId ?? input.agent.workspaceId ?? null,
    agentSlug: input.agent.slug,
    agentName: input.agent.name,
    dag: normalizeAgentDag(input.agent.dagDefinition),
    status: input.agent.status === "draft" ? "draft" : "released",
    createdBy: input.userId,
    releaseNotes: "Captured default Agent template",
    isDefault: input.agent.status !== "draft",
    rolloutPercent: input.agent.status === "draft" ? 0 : 100,
  });
}

export async function recordAgentTemplateVersion(input: {
  workspaceId?: number | null;
  agentSlug: string;
  agentName?: string | null;
  dag: EmperorAgentDag;
  status?: AgentTemplateVersionStatus;
  createdBy?: number | null;
  releaseNotes?: string | null;
  parentVersionId?: number | null;
  isDefault?: boolean;
  rolloutPercent?: number | null;
  rolloutPolicy?: unknown;
}) {
  const dag = assertValidAgentDag(input.dag, "record agent template version");
  const status = input.status || "released";
  const dagHash = hashJson(dag);
  const rolloutPercent = Math.min(Math.max(Math.floor(Number(input.rolloutPercent ?? (status === "released" ? 100 : 0))), 0), 100);
  const isDefault = input.isDefault ?? (status === "released" && rolloutPercent >= 100);
  const rolloutPolicyProvided = input.rolloutPolicy !== undefined;
  const scope = input.workspaceId === undefined ? null : buildWorkspaceScopeFilter(input.workspaceId);
  const existing = await rawExecute(
    scope
      ? `SELECT * FROM emperor_agent_template_versions WHERE agentSlug=? AND dagHash=? AND ${scope.clause} ORDER BY workspaceId IS NULL ASC LIMIT 1`
      : "SELECT * FROM emperor_agent_template_versions WHERE agentSlug=? AND dagHash=? LIMIT 1",
    scope ? [input.agentSlug, dagHash, ...scope.params] : [input.agentSlug, dagHash],
  );
  if (existing[0]) {
    const nextStatus = existing[0].status === "released" && status === "draft" ? "released" : status;
    const nextIsDefault = input.isDefault === undefined ? Number(existing[0].isDefault || 0) : (isDefault ? 1 : 0);
    const nextRolloutPercent = input.rolloutPercent === undefined ? Number(existing[0].rolloutPercent ?? rolloutPercent) : rolloutPercent;
    await rawExecute(
      "UPDATE emperor_agent_template_versions SET agentName=?,status=?,isDefault=?,rolloutPercent=?,rolloutPolicy=?,releaseNotes=COALESCE(?,releaseNotes),releasedAt=COALESCE(releasedAt,?),activatedAt=COALESCE(activatedAt,?),updatedAt=NOW() WHERE id=?",
      [
        input.agentName || null,
        nextStatus,
        nextIsDefault,
        nextRolloutPercent,
        rolloutPolicyProvided ? stringifyJson(input.rolloutPolicy) : stringifyJsonOrNull(existing[0].rolloutPolicy),
        input.releaseNotes || null,
        nextStatus === "released" ? new Date() : null,
        nextIsDefault ? new Date() : null,
        existing[0].id,
      ],
    );
    if (nextIsDefault) {
      await rawExecute(
        scope
          ? `UPDATE emperor_agent_template_versions SET isDefault=0,deprecatedAt=COALESCE(deprecatedAt,?),updatedAt=NOW() WHERE agentSlug=? AND id<>? AND ${scope.clause}`
          : "UPDATE emperor_agent_template_versions SET isDefault=0,deprecatedAt=COALESCE(deprecatedAt,?),updatedAt=NOW() WHERE agentSlug=? AND id<>?",
        scope ? [new Date(), input.agentSlug, existing[0].id, ...scope.params] : [new Date(), input.agentSlug, existing[0].id],
      );
    }
    const rows = await rawExecute("SELECT * FROM emperor_agent_template_versions WHERE id=? LIMIT 1", [existing[0].id]);
    return normalizeTemplateVersionRow(rows[0] || existing[0]);
  }

  const latest = await rawExecute(
    scope
      ? `SELECT versionNumber FROM emperor_agent_template_versions WHERE agentSlug=? AND ${scope.clause} ORDER BY versionNumber DESC LIMIT 1`
      : "SELECT versionNumber FROM emperor_agent_template_versions WHERE agentSlug=? ORDER BY versionNumber DESC LIMIT 1",
    scope ? [input.agentSlug, ...scope.params] : [input.agentSlug],
  );
  const versionNumber = Number(latest[0]?.versionNumber || 0) + 1;
  const version = `v${versionNumber}`;
  await rawExecute(
    `INSERT INTO emperor_agent_template_versions
     (workspaceId,agentSlug,agentName,parentVersionId,versionNumber,version,dagHash,status,isDefault,rolloutPercent,rolloutPolicy,dagDefinition,releaseNotes,createdBy,releasedAt,activatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.workspaceId ?? null,
      input.agentSlug,
      input.agentName || null,
      input.parentVersionId || null,
      versionNumber,
      version,
      dagHash,
      status,
      isDefault ? 1 : 0,
      rolloutPercent,
      input.rolloutPolicy === undefined ? null : stringifyJson(input.rolloutPolicy),
      stringifyJson(dag),
      input.releaseNotes || null,
      input.createdBy || null,
      status === "released" ? new Date() : null,
      isDefault ? new Date() : null,
    ],
  );
  const rows = await rawExecute(
    scope
      ? `SELECT * FROM emperor_agent_template_versions WHERE agentSlug=? AND dagHash=? AND ${scope.clause} ORDER BY workspaceId IS NULL ASC LIMIT 1`
      : "SELECT * FROM emperor_agent_template_versions WHERE agentSlug=? AND dagHash=? LIMIT 1",
    scope ? [input.agentSlug, dagHash, ...scope.params] : [input.agentSlug, dagHash],
  );
  if (isDefault && rows[0]?.id) {
    await rawExecute(
      scope
        ? `UPDATE emperor_agent_template_versions SET isDefault=0,deprecatedAt=COALESCE(deprecatedAt,?),updatedAt=NOW() WHERE agentSlug=? AND id<>? AND ${scope.clause}`
        : "UPDATE emperor_agent_template_versions SET isDefault=0,deprecatedAt=COALESCE(deprecatedAt,?),updatedAt=NOW() WHERE agentSlug=? AND id<>?",
      scope ? [new Date(), input.agentSlug, rows[0].id, ...scope.params] : [new Date(), input.agentSlug, rows[0].id],
    );
    const refreshed = await rawExecute("SELECT * FROM emperor_agent_template_versions WHERE id=? LIMIT 1", [rows[0].id]);
    return normalizeTemplateVersionRow(refreshed[0] || rows[0]);
  }
  return normalizeTemplateVersionRow(rows[0]);
}

export async function listAgentTemplateVersions(input: {
  agentSlug: string;
  limit?: number;
  workspaceId?: number | null;
}) {
  const limit = Math.min(Math.max(input.limit || 20, 1), 100);
  const scope = input.workspaceId === undefined ? null : buildWorkspaceScopeFilter(input.workspaceId);
  const rows = await rawExecute(
    scope
      ? `SELECT * FROM emperor_agent_template_versions
     WHERE agentSlug=? AND ${scope.clause}
     ORDER BY versionNumber DESC, id DESC
     LIMIT ${limit}`
      : `SELECT * FROM emperor_agent_template_versions
     WHERE agentSlug=?
     ORDER BY versionNumber DESC, id DESC
     LIMIT ${limit}`,
    scope ? [input.agentSlug, ...scope.params] : [input.agentSlug],
  );
  return rows.map(normalizeTemplateVersionRow);
}

export async function publishAgentTemplateVersion(input: {
  agentSlug: string;
  versionId?: number | null;
  version?: string | null;
  rolloutPercent?: number;
  rolloutPolicy?: unknown;
  releaseNotes?: string | null;
  userId?: number | null;
  workspaceId?: number | null;
}) {
  const template = await findAgentTemplateVersion(input);
  const dag = assertValidAgentDag(template.dagDefinition, "publish agent template version");
  const rolloutPercent = Math.min(Math.max(Math.floor(Number(input.rolloutPercent ?? 100)), 0), 100);
  const now = new Date();
  const scope = input.workspaceId === undefined ? null : buildWorkspaceScopeFilter(input.workspaceId);
  if (rolloutPercent >= 100) {
    await rawExecute(
      scope
        ? `UPDATE emperor_agent_template_versions SET isDefault=0,deprecatedAt=COALESCE(deprecatedAt,?),updatedAt=NOW() WHERE agentSlug=? AND id<>? AND ${scope.clause}`
        : "UPDATE emperor_agent_template_versions SET isDefault=0,deprecatedAt=COALESCE(deprecatedAt,?),updatedAt=NOW() WHERE agentSlug=? AND id<>?",
      scope ? [now, input.agentSlug, template.id, ...scope.params] : [now, input.agentSlug, template.id],
    );
    await rawExecute(
      scope
        ? `UPDATE emperor_agents SET dagDefinition=?, status='active', updatedAt=NOW() WHERE slug=? AND ${scope.clause}`
        : "UPDATE emperor_agents SET dagDefinition=?, status='active', updatedAt=NOW() WHERE slug=?",
      scope ? [stringifyJson(dag), input.agentSlug, ...scope.params] : [stringifyJson(dag), input.agentSlug],
    );
  }
  await rawExecute(
    `UPDATE emperor_agent_template_versions
     SET status='released',
         isDefault=?,
         rolloutPercent=?,
         rolloutPolicy=?,
         releaseNotes=COALESCE(?, releaseNotes),
         releasedAt=COALESCE(releasedAt, ?),
         activatedAt=?,
         deprecatedAt=NULL,
         updatedAt=NOW()
     WHERE id=?`,
    [
      rolloutPercent >= 100 ? 1 : 0,
      rolloutPercent,
      input.rolloutPolicy === undefined ? stringifyJsonOrNull(template.rolloutPolicy) : stringifyJson(input.rolloutPolicy),
      input.releaseNotes || null,
      now,
      rolloutPercent > 0 ? now : null,
      template.id,
    ],
  );
  const rows = await rawExecute("SELECT * FROM emperor_agent_template_versions WHERE id=? LIMIT 1", [template.id]);
  await recordAiOsMetric({
    entityType: "agent_run",
    entityId: `${input.agentSlug}:${template.version}`,
    metricName: rolloutPercent >= 100 ? "template.published" : "template.rollout_started",
    metricValue: rolloutPercent,
    status: "released",
    workspaceId: input.workspaceId ?? null,
    userId: input.userId ?? null,
    agentSlug: input.agentSlug,
    metadata: { version: template.version, versionId: template.id, rolloutPercent },
  });
  return {
    success: true,
    templateVersion: normalizeTemplateVersionRow(rows[0] || template),
    validation: validateAgentDag(dag),
  };
}

export async function rollbackAgentTemplateVersion(input: {
  agentSlug: string;
  targetVersionId?: number | null;
  targetVersion?: string | null;
  releaseNotes?: string | null;
  userId?: number | null;
  workspaceId?: number | null;
}) {
  const target = await findAgentTemplateVersion({
    agentSlug: input.agentSlug,
    versionId: input.targetVersionId ?? null,
    version: input.targetVersion ?? null,
    workspaceId: input.workspaceId ?? null,
  });
  return publishAgentTemplateVersion({
    agentSlug: input.agentSlug,
    versionId: target.id,
    rolloutPercent: 100,
    releaseNotes: input.releaseNotes || `Rollback to ${target.version}`,
    userId: input.userId ?? null,
    workspaceId: input.workspaceId ?? null,
  });
}

export async function setAgentTemplateRollout(input: {
  agentSlug: string;
  versionId?: number | null;
  version?: string | null;
  rolloutPercent: number;
  rolloutPolicy?: unknown;
  userId?: number | null;
  workspaceId?: number | null;
}) {
  return publishAgentTemplateVersion({
    agentSlug: input.agentSlug,
    versionId: input.versionId ?? null,
    version: input.version ?? null,
    rolloutPercent: input.rolloutPercent,
    rolloutPolicy: input.rolloutPolicy,
    releaseNotes: `Rollout set to ${Math.min(Math.max(Math.floor(Number(input.rolloutPercent)), 0), 100)}%`,
    userId: input.userId ?? null,
    workspaceId: input.workspaceId ?? null,
  });
}

export async function diffAgentTemplateVersions(input: {
  agentSlug: string;
  baseVersionId?: number | null;
  baseVersion?: string | null;
  targetVersionId?: number | null;
  targetVersion?: string | null;
  limit?: number;
  workspaceId?: number | null;
}) {
  const target = await findAgentTemplateVersion({
    agentSlug: input.agentSlug,
    versionId: input.targetVersionId ?? null,
    version: input.targetVersion ?? null,
    workspaceId: input.workspaceId ?? null,
  });
  let base = input.baseVersionId || input.baseVersion
    ? await findAgentTemplateVersion({
      agentSlug: input.agentSlug,
      versionId: input.baseVersionId ?? null,
      version: input.baseVersion ?? null,
      workspaceId: input.workspaceId ?? null,
    })
    : null;
  const scope = buildWorkspaceScopeFilter(input.workspaceId ?? null);
  if (!base) {
    const rows = await rawExecute(
      `SELECT * FROM emperor_agent_template_versions
       WHERE agentSlug=? AND versionNumber < ? AND ${scope.clause}
       ORDER BY versionNumber DESC, id DESC
       LIMIT 1`,
      [input.agentSlug, target.versionNumber, ...scope.params],
    );
    base = rows[0] ? normalizeTemplateVersionRow(rows[0]) : null;
  }
  if (!base) throw new TRPCError({ code: "NOT_FOUND", message: "Base template version not found" });
  const entries = diffAgentArtifactContent(base.dagDefinition, target.dagDefinition, input.limit || 300);
  return {
    agentSlug: input.agentSlug,
    base: {
      id: base.id,
      version: base.version,
      dagHash: base.dagHash,
    },
    target: {
      id: target.id,
      version: target.version,
      dagHash: target.dagHash,
      rolloutPercent: target.rolloutPercent,
      isDefault: target.isDefault,
    },
    changed: entries.length > 0,
    entries,
  };
}

export async function backfillAgentRunTemplateVersions(input: {
  agentSlug?: string | null;
  limit?: number;
  dryRun?: boolean;
  userId?: number | null;
} = {}) {
  const limit = Math.min(Math.max(input.limit || 200, 1), 1000);
  const clauses = ["(templateVersionId IS NULL OR templateVersion IS NULL OR dagHash IS NULL)"];
  const params: unknown[] = [];
  if (input.agentSlug) {
    clauses.push("agentSlug=?");
    params.push(input.agentSlug);
  }
  const rows = await rawExecute(
    `SELECT id,runId,agentSlug,agentName,userId,projectId,inputs,dagHash,templateVersionId,templateVersion
     FROM emperor_agent_runs
     WHERE ${clauses.join(" AND ")}
     ORDER BY createdAt ASC
     LIMIT ${limit}`,
    params,
  );
  const agentCache = new Map<string, any>();
  const results: Array<{ runId: string; agentSlug: string; templateVersion: string | null; templateVersionId: number | null; dagHash: string | null; updated: boolean }> = [];
  for (const row of rows) {
    if (!agentCache.has(row.agentSlug)) {
      agentCache.set(row.agentSlug, await getAgentBySlug(row.agentSlug));
    }
    const agent = agentCache.get(row.agentSlug);
    const storedInputs = parseStoredAgentRunInputs(row.inputs);
    const dag = assertValidAgentDag(storedInputs.runtime?.dagSnapshot || agent.dagDefinition, "backfill run template version");
    const template = await recordAgentTemplateVersion({
      agentSlug: row.agentSlug,
      agentName: row.agentName || agent.name,
      dag,
      status: agent.status === "draft" ? "draft" : "released",
      createdBy: input.userId ?? row.userId ?? null,
      releaseNotes: "Backfilled from historical Agent run",
      isDefault: false,
      rolloutPercent: 0,
    });
    const stored = buildStoredAgentRunInputs({
      inputs: storedInputs.inputs,
      agentSlug: row.agentSlug,
      agentName: row.agentName || agent.name,
      templateVersionId: template.id ?? null,
      templateVersion: template.version ?? null,
      dag,
    });
    if (!input.dryRun) {
      await rawExecute(
        "UPDATE emperor_agent_runs SET templateVersionId=?,templateVersion=?,dagHash=?,inputs=?,updatedAt=NOW() WHERE id=?",
        [template.id ?? null, template.version ?? null, template.dagHash ?? hashJson(dag), stringifyJson(stored), row.id],
      );
    }
    results.push({
      runId: row.runId,
      agentSlug: row.agentSlug,
      templateVersion: template.version ?? null,
      templateVersionId: template.id ?? null,
      dagHash: template.dagHash ?? hashJson(dag),
      updated: !input.dryRun,
    });
  }
  await recordAiOsMetric({
    entityType: "agent_run",
    entityId: input.agentSlug || "all",
    metricName: "template.backfilled_runs",
    metricValue: results.length,
    status: input.dryRun ? "dry_run" : "completed",
    workspaceId: null,
    userId: input.userId ?? null,
    agentSlug: input.agentSlug || null,
    metadata: { dryRun: input.dryRun === true, limit },
  });
  return {
    success: true,
    dryRun: input.dryRun === true,
    scanned: rows.length,
    updated: input.dryRun ? 0 : results.length,
    results,
  };
}

export async function upsertListingAgentTemplate() {
  const dag = assertValidAgentDag(getListingAgentDag(), "install listing template");
  await rawExecute(
    `INSERT INTO emperor_agents (slug,name,description,category,status,scope,triggerType,maxExecutionSeconds,dagDefinition,execution_mode)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),category=VALUES(category),status=VALUES(status),scope=VALUES(scope),triggerType=VALUES(triggerType),maxExecutionSeconds=VALUES(maxExecutionSeconds),dagDefinition=VALUES(dagDefinition),execution_mode=VALUES(execution_mode),updatedAt=NOW()`,
    [
      LISTING_AGENT_SLUG,
      "智能 Listing 全链路 Agent",
      "按 N0-N5 数据层、G1-G5 生成层、O/E 输出优化层编排的 Human-in-the-loop Listing DAG。",
      "Listing",
      "active",
      "project",
      "manual",
      1800,
      stringifyJson(dag),
      "background",
    ],
  );
  const templateVersion = await recordAgentTemplateVersion({
    agentSlug: LISTING_AGENT_SLUG,
    agentName: "智能 Listing 全链路 Agent",
    dag,
    status: "released",
    releaseNotes: "Install Listing full workflow template",
  });
  return { success: true, slug: LISTING_AGENT_SLUG, dag, templateVersion };
}

async function getAgentBySlug(slug: string, workspaceId?: number | null) {
  const scope = workspaceId === undefined ? null : buildWorkspaceScopeFilter(workspaceId);
  const rows = await rawExecute(
    scope
      ? `SELECT * FROM emperor_agents WHERE slug=? AND ${scope.clause} ORDER BY workspaceId IS NULL ASC LIMIT 1`
      : "SELECT * FROM emperor_agents WHERE slug=? LIMIT 1",
    scope ? [slug, ...scope.params] : [slug],
  );
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
  return {
    ...rows[0],
    dagDefinition: normalizeAgentDag(rows[0].dagDefinition),
  };
}

export { normalizeTemplateVersionRow, templateRolloutBucket, findAgentTemplateVersion, getDefaultAgentTemplateVersion, selectAgentTemplateVersionForRun, getAgentBySlug };
