import { sql } from "drizzle-orm";
import { requireDb } from "./dbClient";

export type DatabaseDomainSlug = "auth" | "project" | "listing" | "image" | "ads" | "ops" | "ai_os";

export type DatabaseDomain = {
  slug: DatabaseDomainSlug;
  schemaModule: string;
  repositoryModule: string;
  tables: string[];
  writePolicy: "repository_required" | "legacy_compat";
};

export type SoftForeignKeyPolicy = {
  domain: DatabaseDomainSlug;
  table: string;
  column: string;
  referencesTable: string;
  referencesColumn: string;
  required: boolean;
  onDelete: "restrict" | "cascade" | "set_null" | "preserve_history";
  enforcement: "repository_check" | "state_machine" | "worker_runtime" | "migration_backfill";
};

export type IndexBaseline = {
  domain: DatabaseDomainSlug;
  table: string;
  indexName: string;
  fields: string[];
  purpose: string;
  migration: string;
};

export type ArchivePolicy = {
  domain: DatabaseDomainSlug;
  table: string;
  timeField: string;
  retainHotDays: number;
  archiveAfterDays: number;
  deleteAfterDays?: number;
  partitionHint?: string;
  reason: string;
};

export type SoftForeignKeyAuditResult = SoftForeignKeyPolicy & {
  orphanCount: number;
};

export const DATABASE_DOMAINS: DatabaseDomain[] = [
  {
    slug: "auth",
    schemaModule: "drizzle/schema/auth",
    repositoryModule: "server/repositories/auth",
    tables: [
      "organizations",
      "workspaces",
      "workspace_memberships",
      "users",
      "login_logs",
      "role_permissions",
      "project_assignments",
      "security_access_policies",
      "security_audit_logs",
      "sop_access_grants",
      "usage_stats",
      "notifications",
      "user_settings",
    ],
    writePolicy: "legacy_compat",
  },
  {
    slug: "project",
    schemaModule: "drizzle/schema/project",
    repositoryModule: "server/repositories/project",
    tables: [
      "projects",
      "projectFiles",
      "analysisVersions",
      "reviewImports",
      "competitorAnalyses",
    ],
    writePolicy: "repository_required",
  },
  {
    slug: "listing",
    schemaModule: "drizzle/schema/listing",
    repositoryModule: "server/repositories/listing",
    tables: [
      "listings",
      "listingVersions",
      "keywords",
      "negativeKeywords",
      "reviewAggregations",
      "sellingPointDrafts",
      "buyer_questions",
    ],
    writePolicy: "legacy_compat",
  },
  {
    slug: "image",
    schemaModule: "drizzle/schema/image",
    repositoryModule: "server/repositories/image",
    tables: [
      "image_workflow_sessions",
      "competitor_image_analyses",
      "expression_groups",
      "expression_group_images",
    ],
    writePolicy: "legacy_compat",
  },
  {
    slug: "ads",
    schemaModule: "drizzle/schema/ads",
    repositoryModule: "server/repositories/ads",
    tables: [
      "ad_report_uploads",
      "ad_search_term_reports",
      "ad_campaign_reports",
      "ad_placement_reports",
      "ad_hourly_reports",
      "ad_order_hourly",
      "ad_dsp_reports",
      "ad_daily_placement_reports",
      "ad_daily_search_term_reports",
      "ad_daily_impression_share_reports",
      "ad_daily_sb_benchmark_reports",
      "ad_daily_business_reports",
      "ad_product_stages",
      "ad_keyword_tiers",
      "ad_diagnoses",
      "ad_report_analysis_records",
      "ad_sop_tasks",
      "ad_clinic_records",
    ],
    writePolicy: "legacy_compat",
  },
  {
    slug: "ops",
    schemaModule: "drizzle/schema/ops",
    repositoryModule: "server/repositories/ops",
    tables: [
      "product_profiles",
      "product_variants",
      "product_todos",
      "product_logs",
      "ops_plans",
      "ops_plan_actions",
      "ops_plan_summaries",
      "conversion_comparisons",
      "conversion_scores",
      "team_tasks",
      "shipping_batches",
      "batch_logs",
      "lingxing_product_weekly",
      "saihu_product_weekly",
      "product_weekly_ops",
      "product_monthly_summary",
    ],
    writePolicy: "legacy_compat",
  },
  {
    slug: "ai_os",
    schemaModule: "drizzle/schema/ai_os",
    repositoryModule: "server/repositories/ai_os",
    tables: [
      "ai_jobs",
      "ai_job_workers",
      "ai_job_dead_letters",
      "emperor_skills",
      "emperor_skill_runs",
      "emperor_agents",
      "emperor_agent_template_versions",
      "emperor_agent_runs",
      "emperor_agent_checkpoints",
      "emperor_agent_events",
      "emperor_agent_artifacts",
      "emperor_tools",
      "emperor_tool_runs",
      "emperor_tool_secrets",
      "emperor_secret_key_versions",
      "emperor_ai_os_metrics",
      "emperor_ai_os_evaluations",
      "emperor_knowledge",
      "emperor_mcp_connectors",
      "emperor_model_providers",
    ],
    writePolicy: "repository_required",
  },
];

export const SOFT_FOREIGN_KEYS: SoftForeignKeyPolicy[] = [
  {
    domain: "auth",
    table: "workspaces",
    column: "organizationId",
    referencesTable: "organizations",
    referencesColumn: "id",
    required: false,
    onDelete: "preserve_history",
    enforcement: "migration_backfill",
  },
  {
    domain: "auth",
    table: "workspace_memberships",
    column: "workspaceId",
    referencesTable: "workspaces",
    referencesColumn: "id",
    required: true,
    onDelete: "restrict",
    enforcement: "repository_check",
  },
  {
    domain: "auth",
    table: "workspace_memberships",
    column: "userId",
    referencesTable: "users",
    referencesColumn: "id",
    required: true,
    onDelete: "restrict",
    enforcement: "repository_check",
  },
  {
    domain: "auth",
    table: "security_audit_logs",
    column: "workspaceId",
    referencesTable: "workspaces",
    referencesColumn: "id",
    required: false,
    onDelete: "preserve_history",
    enforcement: "repository_check",
  },
  {
    domain: "project",
    table: "projects",
    column: "userId",
    referencesTable: "users",
    referencesColumn: "id",
    required: true,
    onDelete: "preserve_history",
    enforcement: "repository_check",
  },
  {
    domain: "project",
    table: "projects",
    column: "workspaceId",
    referencesTable: "workspaces",
    referencesColumn: "id",
    required: false,
    onDelete: "preserve_history",
    enforcement: "repository_check",
  },
  {
    domain: "listing",
    table: "listings",
    column: "projectId",
    referencesTable: "projects",
    referencesColumn: "id",
    required: true,
    onDelete: "cascade",
    enforcement: "repository_check",
  },
  {
    domain: "listing",
    table: "listingVersions",
    column: "listingId",
    referencesTable: "listings",
    referencesColumn: "id",
    required: true,
    onDelete: "cascade",
    enforcement: "repository_check",
  },
  {
    domain: "project",
    table: "projectFiles",
    column: "projectId",
    referencesTable: "projects",
    referencesColumn: "id",
    required: true,
    onDelete: "cascade",
    enforcement: "repository_check",
  },
  {
    domain: "project",
    table: "analysisVersions",
    column: "projectFileId",
    referencesTable: "projectFiles",
    referencesColumn: "id",
    required: true,
    onDelete: "cascade",
    enforcement: "repository_check",
  },
  {
    domain: "image",
    table: "image_workflow_sessions",
    column: "projectId",
    referencesTable: "projects",
    referencesColumn: "id",
    required: true,
    onDelete: "cascade",
    enforcement: "repository_check",
  },
  {
    domain: "ai_os",
    table: "ai_jobs",
    column: "projectId",
    referencesTable: "projects",
    referencesColumn: "id",
    required: false,
    onDelete: "preserve_history",
    enforcement: "worker_runtime",
  },
  {
    domain: "ai_os",
    table: "emperor_agent_runs",
    column: "userId",
    referencesTable: "users",
    referencesColumn: "id",
    required: true,
    onDelete: "preserve_history",
    enforcement: "state_machine",
  },
  {
    domain: "ai_os",
    table: "emperor_agent_checkpoints",
    column: "runId",
    referencesTable: "emperor_agent_runs",
    referencesColumn: "runId",
    required: true,
    onDelete: "preserve_history",
    enforcement: "state_machine",
  },
  {
    domain: "ai_os",
    table: "emperor_agent_artifacts",
    column: "runId",
    referencesTable: "emperor_agent_runs",
    referencesColumn: "runId",
    required: true,
    onDelete: "preserve_history",
    enforcement: "state_machine",
  },
  {
    domain: "ai_os",
    table: "emperor_tool_runs",
    column: "workspaceId",
    referencesTable: "workspaces",
    referencesColumn: "id",
    required: false,
    onDelete: "preserve_history",
    enforcement: "worker_runtime",
  },
  {
    domain: "ads",
    table: "ad_search_term_reports",
    column: "upload_id",
    referencesTable: "ad_report_uploads",
    referencesColumn: "id",
    required: true,
    onDelete: "preserve_history",
    enforcement: "repository_check",
  },
  {
    domain: "ads",
    table: "ad_campaign_reports",
    column: "upload_id",
    referencesTable: "ad_report_uploads",
    referencesColumn: "id",
    required: true,
    onDelete: "preserve_history",
    enforcement: "repository_check",
  },
];

export const INDEX_BASELINES: IndexBaseline[] = [
  {
    domain: "auth",
    table: "users",
    indexName: "idx_users_workspace_status",
    fields: ["defaultWorkspaceId", "status", "role"],
    purpose: "登录后按默认工作区、状态和角色做权限治理过滤",
    migration: "0114_security_tenant_governance_v1.sql",
  },
  {
    domain: "auth",
    table: "workspace_memberships",
    indexName: "idx_workspace_memberships_user_status",
    fields: ["userId", "status", "workspaceId"],
    purpose: "校验用户是否属于目标工作区",
    migration: "0114_security_tenant_governance_v1.sql",
  },
  {
    domain: "auth",
    table: "security_audit_logs",
    indexName: "idx_security_audit_workspace_created",
    fields: ["workspaceId", "createdAt"],
    purpose: "关键操作审计按工作区和时间检索",
    migration: "0114_security_tenant_governance_v1.sql",
  },
  {
    domain: "project",
    table: "projects",
    indexName: "idx_projects_user_status_updated",
    fields: ["userId", "status", "updatedAt"],
    purpose: "项目列表、状态筛选、按最近更新时间排序",
    migration: "0113_database_governance_v1.sql",
  },
  {
    domain: "project",
    table: "projectFiles",
    indexName: "idx_project_files_project_type_status",
    fields: ["projectId", "fileType", "status", "createdAt"],
    purpose: "Listing 前置数据文件按项目、类型、解析状态查询",
    migration: "0113_database_governance_v1.sql",
  },
  {
    domain: "listing",
    table: "keywords",
    indexName: "idx_keywords_project_status_created",
    fields: ["projectId", "status", "createdAt"],
    purpose: "关键词矩阵按项目、状态分页和确认流读取",
    migration: "0113_database_governance_v1.sql",
  },
  {
    domain: "image",
    table: "image_workflow_sessions",
    indexName: "idx_image_workflow_project_user_status",
    fields: ["projectId", "userId", "status", "updatedAt"],
    purpose: "图片工作流按项目恢复当前会话和确认状态",
    migration: "0113_database_governance_v1.sql",
  },
  {
    domain: "ads",
    table: "ad_report_uploads",
    indexName: "idx_ad_report_uploads_user_type_status",
    fields: ["user_id", "report_type", "upload_status", "createdAt"],
    purpose: "广告上传记录按用户、报表类型、解析状态查询",
    migration: "0113_database_governance_v1.sql",
  },
  {
    domain: "ads",
    table: "ad_daily_search_term_reports",
    indexName: "idx_ad_daily_search_user_date_product",
    fields: ["user_id", "report_date", "product_id"],
    purpose: "每日搜索词报表按用户、日期、产品聚合",
    migration: "0113_database_governance_v1.sql",
  },
  {
    domain: "ops",
    table: "lingxing_product_weekly",
    indexName: "idx_lingxing_weekly_user_week",
    fields: ["user_id", "week_start_date"],
    purpose: "运营周报按用户、周期查询；ASIN 精确检索后续使用短 hash 列",
    migration: "0113_database_governance_v1.sql",
  },
  {
    domain: "ops",
    table: "saihu_product_weekly",
    indexName: "idx_saihu_weekly_user_week",
    fields: ["user_id", "week_start_date"],
    purpose: "赛狐周报按用户、周期查询；ASIN 精确检索后续使用短 hash 列",
    migration: "0113_database_governance_v1.sql",
  },
  {
    domain: "ai_os",
    table: "emperor_tool_runs",
    indexName: "idx_tool_runs_workspace_tool_created",
    fields: ["workspaceId", "toolSlug", "createdAt"],
    purpose: "Tool 调用日志按工作区、工具和时间审计",
    migration: "0114_security_tenant_governance_v1.sql",
  },
  {
    domain: "ai_os",
    table: "emperor_tool_secrets",
    indexName: "idx_tool_secrets_workspace_status",
    fields: ["workspaceId", "status", "updatedAt"],
    purpose: "Tool secret 按工作区、状态和轮换时间治理",
    migration: "0114_security_tenant_governance_v1.sql",
  },
  {
    domain: "ai_os",
    table: "ai_jobs",
    indexName: "idx_ai_jobs_project_status_created",
    fields: ["projectId", "status", "createdAt"],
    purpose: "项目级长任务历史、恢复和状态过滤",
    migration: "0113_database_governance_v1.sql",
  },
  {
    domain: "ai_os",
    table: "emperor_agent_runs",
    indexName: "idx_agent_runs_user_status_created",
    fields: ["userId", "status", "createdAt"],
    purpose: "Agent Run 列表、状态看板和用户历史追踪",
    migration: "0113_database_governance_v1.sql",
  },
  {
    domain: "ai_os",
    table: "emperor_agent_events",
    indexName: "idx_agent_events_type_created",
    fields: ["eventType", "createdAt"],
    purpose: "Agent 事件流按类型和时间窗口审计",
    migration: "0113_database_governance_v1.sql",
  },
  {
    domain: "ai_os",
    table: "emperor_ai_os_metrics",
    indexName: "idx_ai_os_metrics_entity_created",
    fields: ["entityType", "entityId", "createdAt"],
    purpose: "观测指标按 Skill/Agent/Tool 实体聚合",
    migration: "0113_database_governance_v1.sql",
  },
];

export const ARCHIVE_POLICIES: ArchivePolicy[] = [
  {
    domain: "ai_os",
    table: "ai_jobs",
    timeField: "createdAt",
    retainHotDays: 90,
    archiveAfterDays: 180,
    deleteAfterDays: 730,
    partitionHint: "MONTH(createdAt)",
    reason: "长任务执行记录增长稳定，热数据只需要支撑最近恢复和排障",
  },
  {
    domain: "ai_os",
    table: "emperor_agent_events",
    timeField: "createdAt",
    retainHotDays: 30,
    archiveAfterDays: 90,
    deleteAfterDays: 365,
    partitionHint: "MONTH(createdAt)",
    reason: "事件流增长最快，超过排障窗口后保留聚合指标即可",
  },
  {
    domain: "ai_os",
    table: "emperor_tool_runs",
    timeField: "createdAt",
    retainHotDays: 90,
    archiveAfterDays: 180,
    deleteAfterDays: 730,
    partitionHint: "MONTH(createdAt)",
    reason: "外部工具调用日志需要覆盖账单、限流和事故复盘窗口",
  },
  {
    domain: "ads",
    table: "ad_report_uploads",
    timeField: "createdAt",
    retainHotDays: 180,
    archiveAfterDays: 365,
    partitionHint: "MONTH(createdAt)",
    reason: "上传记录是广告报表血缘入口，需要比明细数据保留更久",
  },
  {
    domain: "ads",
    table: "ad_search_term_reports",
    timeField: "week_start_date",
    retainHotDays: 180,
    archiveAfterDays: 365,
    partitionHint: "RANGE COLUMNS(week_start_date)",
    reason: "搜索词明细高增长，常用窗口集中在最近 26 周",
  },
  {
    domain: "ads",
    table: "ad_daily_search_term_reports",
    timeField: "report_date",
    retainHotDays: 180,
    archiveAfterDays: 365,
    partitionHint: "RANGE COLUMNS(report_date)",
    reason: "每日搜索词明细用于趋势和诊断，适合按日期滚动归档",
  },
  {
    domain: "ops",
    table: "lingxing_product_weekly",
    timeField: "week_start_date",
    retainHotDays: 365,
    archiveAfterDays: 730,
    partitionHint: "RANGE COLUMNS(week_start_date)",
    reason: "运营周报需要同比分析，热数据保留完整年度",
  },
  {
    domain: "ops",
    table: "saihu_product_weekly",
    timeField: "week_start_date",
    retainHotDays: 365,
    archiveAfterDays: 730,
    partitionHint: "RANGE COLUMNS(week_start_date)",
    reason: "赛狐周报与领星周报保持同样归档窗口",
  },
];

export function getDatabaseGovernanceSnapshot() {
  return {
    domains: DATABASE_DOMAINS,
    softForeignKeys: SOFT_FOREIGN_KEYS,
    indexBaselines: INDEX_BASELINES,
    archivePolicies: ARCHIVE_POLICIES,
  };
}

export function listDomainTables(domain: DatabaseDomainSlug) {
  return DATABASE_DOMAINS.find((item) => item.slug === domain)?.tables ?? [];
}

export function listIndexBaselinesByDomain(domain: DatabaseDomainSlug) {
  return INDEX_BASELINES.filter((item) => item.domain === domain);
}

export function listArchivePoliciesByDomain(domain: DatabaseDomainSlug) {
  return ARCHIVE_POLICIES.filter((item) => item.domain === domain);
}

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
    throw new Error(`Unsafe database identifier: ${identifier}`);
  }
  return `\`${identifier}\``;
}

export function buildSoftForeignKeyAuditSql(policy: SoftForeignKeyPolicy) {
  const childTable = quoteIdentifier(policy.table);
  const childColumn = quoteIdentifier(policy.column);
  const parentTable = quoteIdentifier(policy.referencesTable);
  const parentColumn = quoteIdentifier(policy.referencesColumn);
  const nullableClause = policy.required ? "" : `AND child.${childColumn} IS NOT NULL`;

  return [
    "SELECT COUNT(*) AS orphanCount",
    `FROM ${childTable} child`,
    `LEFT JOIN ${parentTable} parent ON child.${childColumn} = parent.${parentColumn}`,
    `WHERE parent.${parentColumn} IS NULL ${nullableClause}`,
  ].join(" ");
}

export async function auditSoftForeignKeys(
  policies: SoftForeignKeyPolicy[] = SOFT_FOREIGN_KEYS,
): Promise<SoftForeignKeyAuditResult[]> {
  const db = await requireDb("Database governance audit");
  const results: SoftForeignKeyAuditResult[] = [];

  for (const policy of policies) {
    const queryResult = (await db.execute(sql.raw(buildSoftForeignKeyAuditSql(policy)))) as any;
    const rows = Array.isArray(queryResult?.[0]) ? queryResult[0] : queryResult;
    const firstRow = Array.isArray(rows) ? rows[0] : rows?.rows?.[0];
    results.push({
      ...policy,
      orphanCount: Number(firstRow?.orphanCount ?? firstRow?.["COUNT(*)"] ?? 0),
    });
  }

  return results;
}

export function buildArchiveCandidateSql(policy: ArchivePolicy, cutoffExpression = "?") {
  const table = quoteIdentifier(policy.table);
  const timeField = quoteIdentifier(policy.timeField);
  return `SELECT COUNT(*) AS archiveCandidateCount FROM ${table} WHERE ${timeField} < ${cutoffExpression}`;
}
