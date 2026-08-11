import { sql } from "drizzle-orm";
import { requireDb } from "./dbClient";

export type DatabaseDomainSlug = "auth" | "project" | "listing" | "image" | "ads" | "ops" | "video" | "knowledge" | "ai_os";

export type DatabaseDomain = {
  slug: DatabaseDomainSlug;
  schemaModule: string;
  repositoryModule: string;
  tables: string[];
  writePolicy: "repository_required";
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

export type CoreTableRowCountBaseline = {
  domain: DatabaseDomainSlug;
  table: string;
  purpose: string;
  highGrowth: boolean;
};

export type DatabasePerformanceBaseline = {
  slug: string;
  domain: DatabaseDomainSlug;
  table: string;
  purpose: string;
  sql: string;
  expectedIndexNames: string[];
  migration: string;
  risk: "low" | "medium" | "high";
};

export type CoreTableRowCountResult = CoreTableRowCountBaseline & {
  rowCount: number;
  checkedAt: string;
};

export type DatabaseExplainAuditResult = DatabasePerformanceBaseline & {
  usesExpectedIndex: boolean;
  observedKeys: string[];
  possibleKeys: string[];
  explainRows: unknown[];
  checkedAt: string;
};

export type MigrationRegressionBaseline = {
  requiredMigrations: string[];
  requiredTables: string[];
  requiredIndexes: string[];
  requiredChecks: Array<{
    slug: string;
    description: string;
  }>;
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
    writePolicy: "repository_required",
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
      "dev_projects",
      "dev_project_progress",
      "dev_analysis_stages",
      "dev_analysis_stage_conflicts",
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
    writePolicy: "repository_required",
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
    writePolicy: "repository_required",
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
    writePolicy: "repository_required",
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
    writePolicy: "repository_required",
  },
  {
    slug: "video",
    schemaModule: "drizzle/schema/video",
    repositoryModule: "server/repositories/video",
    tables: [
      "video_scripts",
      "video_competitor_scripts",
      "video_product_snapshots",
      "video_script_sections",
      "video_script_subtopics",
      "video_script_shots",
      "video_edit_scripts",
      "video_script_versions",
      "video_spv_segments",
    ],
    writePolicy: "repository_required",
  },
  {
    slug: "knowledge",
    schemaModule: "drizzle/schema/knowledge",
    repositoryModule: "server/repositories/knowledge",
    tables: [
      "kb_product_innovations",
      "kb_listing_copywriting",
      "kb_operation_skills",
      "kb_videos",
      "kb_intel_items",
      "kb_feedback",
      "kb_bot_conversations",
      "kb_bot_messages",
      "kb_tag_definitions",
    ],
    writePolicy: "repository_required",
  },
  {
    slug: "ai_os",
    schemaModule: "drizzle/schema/ai_os",
    repositoryModule: "server/repositories/ai_os",
    tables: [
      "ai_artifacts",
      "ai_artifact_selection_events",
      "ai_artifact_consumptions",
      "ai_storage_objects",
      "ai_data_archive_runs",
      "ai_data_archive_items",
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
      "database_slow_query_samples",
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
    table: "dev_projects",
    column: "workspaceId",
    referencesTable: "workspaces",
    referencesColumn: "id",
    required: false,
    onDelete: "preserve_history",
    enforcement: "repository_check",
  },
  {
    domain: "project",
    table: "dev_project_progress",
    column: "projectId",
    referencesTable: "dev_projects",
    referencesColumn: "id",
    required: true,
    onDelete: "cascade",
    enforcement: "repository_check",
  },
  {
    domain: "project",
    table: "dev_project_progress",
    column: "workspaceId",
    referencesTable: "workspaces",
    referencesColumn: "id",
    required: false,
    onDelete: "preserve_history",
    enforcement: "repository_check",
  },
  {
    domain: "project",
    table: "dev_analysis_stages",
    column: "projectId",
    referencesTable: "dev_projects",
    referencesColumn: "id",
    required: true,
    onDelete: "cascade",
    enforcement: "repository_check",
  },
  {
    domain: "project",
    table: "dev_analysis_stages",
    column: "workspaceId",
    referencesTable: "workspaces",
    referencesColumn: "id",
    required: false,
    onDelete: "preserve_history",
    enforcement: "repository_check",
  },
  {
    domain: "project",
    table: "dev_analysis_stage_conflicts",
    column: "keptStageId",
    referencesTable: "dev_analysis_stages",
    referencesColumn: "id",
    required: true,
    onDelete: "preserve_history",
    enforcement: "migration_backfill",
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
    domain: "project",
    table: "projectFiles",
    column: "analysisArtifactId",
    referencesTable: "ai_artifacts",
    referencesColumn: "artifactId",
    required: false,
    onDelete: "preserve_history",
    enforcement: "repository_check",
  },
  {
    domain: "ai_os",
    table: "ai_storage_objects",
    column: "workspaceId",
    referencesTable: "workspaces",
    referencesColumn: "id",
    required: false,
    onDelete: "preserve_history",
    enforcement: "repository_check",
  },
  {
    domain: "ai_os",
    table: "ai_artifacts",
    column: "storageObjectId",
    referencesTable: "ai_storage_objects",
    referencesColumn: "id",
    required: false,
    onDelete: "preserve_history",
    enforcement: "repository_check",
  },
  {
    domain: "ai_os",
    table: "ai_artifacts",
    column: "projectId",
    referencesTable: "projects",
    referencesColumn: "id",
    required: false,
    onDelete: "preserve_history",
    enforcement: "repository_check",
  },
  {
    domain: "ai_os",
    table: "ai_data_archive_items",
    column: "archiveRunId",
    referencesTable: "ai_data_archive_runs",
    referencesColumn: "archiveRunId",
    required: true,
    onDelete: "preserve_history",
    enforcement: "worker_runtime",
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
    domain: "project",
    table: "dev_project_progress",
    indexName: "uniq_dev_project_progress_project",
    fields: ["projectId"],
    purpose: "保证每个产品开发项目只有一份项目列表人工维护资料",
    migration: "0132_dev_project_progress_list.sql",
  },
  {
    domain: "project",
    table: "dev_project_progress",
    indexName: "idx_dev_project_progress_workspace_project",
    fields: ["workspaceId", "projectId", "updatedAt"],
    purpose: "项目列表按工作区批量汇总进度资料",
    migration: "0132_dev_project_progress_list.sql",
  },
  {
    domain: "project",
    table: "dev_analysis_stages",
    indexName: "uniq_dev_stages_project_type",
    fields: ["projectId", "stageType"],
    purpose: "保证每个产品开发项目的每种分析阶段只有一条状态记录",
    migration: "0125_dev_stage_consistency.sql",
  },
  {
    domain: "project",
    table: "dev_analysis_stages",
    indexName: "uniq_dev_stages_workspace_project_type",
    fields: ["workspaceId", "projectId", "stageType"],
    purpose: "按工作区和项目隔离分析阶段并防止并发重复创建",
    migration: "0125_dev_stage_consistency.sql",
  },
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
    domain: "ai_os",
    table: "ai_artifacts",
    indexName: "idx_ai_artifacts_domain_source_current",
    fields: ["workspaceId", "domain", "sourceTable", "sourceRowId", "artifactKey", "isCurrent"],
    purpose: "统一产物按业务来源、版本 current 指针读取",
    migration: "0115_data_lifecycle_artifacts_v1.sql",
  },
  {
    domain: "ai_os",
    table: "ai_artifacts",
    indexName: "idx_ai_artifacts_project_key_current",
    fields: ["workspaceId", "projectId", "artifactKey", "status", "isCurrent", "version"],
    purpose: "项目下游只读取已确认 current Artifact",
    migration: "0128_artifact_source_of_truth.sql",
  },
  {
    domain: "ai_os",
    table: "ai_artifacts",
    indexName: "idx_ai_artifacts_lineage_version",
    fields: ["workspaceId", "sourceTable", "sourceRowId", "artifactKey", "version"],
    purpose: "按业务谱系查询不可变历史版本",
    migration: "0128_artifact_source_of_truth.sql",
  },
  {
    domain: "ai_os",
    table: "ai_artifact_consumptions",
    indexName: "idx_ai_artifact_consumption_consumer",
    fields: ["workspaceId", "consumerType", "consumerId", "createdAt"],
    purpose: "审计每次下游任务使用的精确 Artifact 版本",
    migration: "0128_artifact_source_of_truth.sql",
  },
  {
    domain: "ai_os",
    table: "ai_storage_objects",
    indexName: "idx_ai_storage_workspace_lifecycle",
    fields: ["workspaceId", "lifecycleState", "archiveAfter"],
    purpose: "Storage 对象按工作区和冷热生命周期治理",
    migration: "0115_data_lifecycle_artifacts_v1.sql",
  },
  {
    domain: "ai_os",
    table: "ai_data_archive_runs",
    indexName: "idx_ai_archive_runs_policy_status",
    fields: ["policySlug", "status", "createdAt"],
    purpose: "归档任务按策略、状态和创建时间排障",
    migration: "0115_data_lifecycle_artifacts_v1.sql",
  },
  {
    domain: "project",
    table: "projectFiles",
    indexName: "idx_project_files_lifecycle",
    fields: ["workspaceId", "lifecycleState", "archiveAfter"],
    purpose: "原始上传文件按工作区和生命周期分层",
    migration: "0115_data_lifecycle_artifacts_v1.sql",
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
    table: "ai_jobs",
    indexName: "idx_ai_jobs_lifecycle",
    fields: ["workspaceId", "retentionClass", "archiveAfter", "deleteAfter"],
    purpose: "AI Job 执行记录按冷热策略归档和删除",
    migration: "0115_data_lifecycle_artifacts_v1.sql",
  },
  {
    domain: "ai_os",
    table: "emperor_agent_events",
    indexName: "idx_agent_events_lifecycle",
    fields: ["workspaceId", "retentionClass", "archiveAfter", "deleteAfter"],
    purpose: "Agent 事件流按短热窗口归档",
    migration: "0115_data_lifecycle_artifacts_v1.sql",
  },
  {
    domain: "ai_os",
    table: "emperor_tool_runs",
    indexName: "idx_tool_runs_lifecycle",
    fields: ["workspaceId", "retentionClass", "archiveAfter", "deleteAfter"],
    purpose: "Tool Run 调用记录按审计窗口归档",
    migration: "0115_data_lifecycle_artifacts_v1.sql",
  },
  {
    domain: "ai_os",
    table: "emperor_ai_os_metrics",
    indexName: "idx_ai_os_metrics_lifecycle",
    fields: ["workspaceId", "retentionClass", "archiveAfter", "deleteAfter"],
    purpose: "观测指标按长热窗口归档",
    migration: "0115_data_lifecycle_artifacts_v1.sql",
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
    domain: "ai_os",
    table: "emperor_ai_os_metrics",
    timeField: "createdAt",
    retainHotDays: 180,
    archiveAfterDays: 365,
    deleteAfterDays: 1095,
    partitionHint: "MONTH(createdAt)",
    reason: "观测明细一年后转冷，长期趋势由聚合指标承接",
  },
  {
    domain: "ai_os",
    table: "database_slow_query_samples",
    timeField: "sampledAt",
    retainHotDays: 90,
    archiveAfterDays: 180,
    deleteAfterDays: 730,
    partitionHint: "MONTH(sampledAt)",
    reason: "慢查询摘要用于近期性能回归，长期只保留聚合趋势",
  },
  {
    domain: "ai_os",
    table: "ai_artifacts",
    timeField: "createdAt",
    retainHotDays: 180,
    archiveAfterDays: 365,
    deleteAfterDays: 1095,
    partitionHint: "MONTH(createdAt)",
    reason: "统一产物版本需要支撑回滚和复用，热窗口比事件流更长",
  },
  {
    domain: "project",
    table: "projectFiles",
    timeField: "createdAt",
    retainHotDays: 90,
    archiveAfterDays: 180,
    deleteAfterDays: 730,
    partitionHint: "MONTH(createdAt)",
    reason: "文件长内容迁移到 Storage/Artifact 后，热表只保留最近编辑窗口",
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

export const CORE_TABLE_ROW_COUNT_BASELINES: CoreTableRowCountBaseline[] = [
  {
    domain: "ai_os",
    table: "ai_jobs",
    purpose: "AI Job 队列和执行记录增长趋势",
    highGrowth: true,
  },
  {
    domain: "ai_os",
    table: "ai_job_workers",
    purpose: "Worker 心跳和健康状态基数",
    highGrowth: false,
  },
  {
    domain: "ai_os",
    table: "ai_job_dead_letters",
    purpose: "不可恢复 Job 的死信积压趋势",
    highGrowth: true,
  },
  {
    domain: "ai_os",
    table: "emperor_agent_runs",
    purpose: "Agent Run 历史增长趋势",
    highGrowth: true,
  },
  {
    domain: "ai_os",
    table: "emperor_agent_checkpoints",
    purpose: "人工确认节点和中间状态增长趋势",
    highGrowth: true,
  },
  {
    domain: "ai_os",
    table: "emperor_agent_events",
    purpose: "Agent 事件流高增长趋势",
    highGrowth: true,
  },
  {
    domain: "ai_os",
    table: "emperor_tool_runs",
    purpose: "Tool 调用审计和失败率趋势",
    highGrowth: true,
  },
  {
    domain: "ai_os",
    table: "emperor_ai_os_metrics",
    purpose: "AI OS 可观测明细增长趋势",
    highGrowth: true,
  },
  {
    domain: "ai_os",
    table: "emperor_ai_os_evaluations",
    purpose: "Skill/Agent/Tool 质量评测样本趋势",
    highGrowth: true,
  },
  {
    domain: "ai_os",
    table: "database_slow_query_samples",
    purpose: "真实慢查询摘要快照增长趋势",
    highGrowth: true,
  },
  {
    domain: "ai_os",
    table: "ai_artifacts",
    purpose: "统一产物版本资产增长趋势",
    highGrowth: true,
  },
  {
    domain: "ai_os",
    table: "ai_storage_objects",
    purpose: "文件、图片和长文本 Storage 引用增长趋势",
    highGrowth: true,
  },
  {
    domain: "ai_os",
    table: "ai_data_archive_runs",
    purpose: "归档任务执行历史趋势",
    highGrowth: false,
  },
  {
    domain: "project",
    table: "projectFiles",
    purpose: "原始上传文件热表增长趋势",
    highGrowth: true,
  },
  {
    domain: "ads",
    table: "ad_daily_search_term_reports",
    purpose: "广告每日搜索词明细高增长趋势",
    highGrowth: true,
  },
  {
    domain: "ops",
    table: "lingxing_product_weekly",
    purpose: "领星运营周报增长趋势",
    highGrowth: true,
  },
  {
    domain: "ops",
    table: "saihu_product_weekly",
    purpose: "赛狐运营周报增长趋势",
    highGrowth: true,
  },
];

export const DATABASE_PERFORMANCE_BASELINES: DatabasePerformanceBaseline[] = [
  {
    slug: "dev_analysis_stage_project_type",
    domain: "project",
    table: "dev_analysis_stages",
    purpose: "产品开发页面按项目和阶段读取唯一状态行",
    sql: "SELECT id, projectId, stageType, status, rowVersion FROM dev_analysis_stages WHERE projectId=0 AND stageType='market_overview' LIMIT 1",
    expectedIndexNames: ["uniq_dev_stages_project_type", "uniq_dev_stages_workspace_project_type"],
    migration: "0125_dev_stage_consistency.sql",
    risk: "high",
  },
  {
    slug: "ai_jobs_queue_due",
    domain: "ai_os",
    table: "ai_jobs",
    purpose: "Worker 按状态、队列、优先级和到期时间领取 Job",
    sql: "SELECT runId, status, queueName, priority, nextRunAt FROM ai_jobs WHERE status IN ('queued','running') AND queueName='default' ORDER BY priority DESC, nextRunAt ASC, createdAt ASC LIMIT 50",
    expectedIndexNames: ["idx_ai_jobs_queue_due", "idx_ai_jobs_due"],
    migration: "0108_ai_job_queue_system.sql",
    risk: "high",
  },
  {
    slug: "ai_jobs_project_history",
    domain: "ai_os",
    table: "ai_jobs",
    purpose: "项目级长任务历史按 projectId/status/createdAt 查询",
    sql: "SELECT runId, projectId, status, createdAt FROM ai_jobs WHERE projectId=0 AND status='succeeded' ORDER BY createdAt DESC LIMIT 100",
    expectedIndexNames: ["idx_ai_jobs_project_status_created"],
    migration: "0113_database_governance_v1.sql",
    risk: "medium",
  },
  {
    slug: "agent_runs_user_status",
    domain: "ai_os",
    table: "emperor_agent_runs",
    purpose: "用户 Agent Run 历史和状态看板",
    sql: "SELECT runId, userId, status, createdAt FROM emperor_agent_runs WHERE userId=0 AND status='running' ORDER BY createdAt DESC LIMIT 50",
    expectedIndexNames: ["idx_agent_runs_user_status_created"],
    migration: "0113_database_governance_v1.sql",
    risk: "high",
  },
  {
    slug: "agent_events_type_window",
    domain: "ai_os",
    table: "emperor_agent_events",
    purpose: "Agent 事件流按类型和时间窗口排障",
    sql: "SELECT id, runId, eventType, createdAt FROM emperor_agent_events WHERE eventType='node_completed' ORDER BY createdAt DESC LIMIT 100",
    expectedIndexNames: ["idx_agent_events_type_created"],
    migration: "0113_database_governance_v1.sql",
    risk: "high",
  },
  {
    slug: "tool_runs_workspace_tool",
    domain: "ai_os",
    table: "emperor_tool_runs",
    purpose: "Tool 调用日志按工作区、工具和时间审计",
    sql: "SELECT id, workspaceId, toolSlug, status, createdAt FROM emperor_tool_runs WHERE workspaceId=0 AND toolSlug='seller_sprite' ORDER BY createdAt DESC LIMIT 100",
    expectedIndexNames: ["idx_tool_runs_workspace_tool_created"],
    migration: "0114_security_tenant_governance_v1.sql",
    risk: "high",
  },
  {
    slug: "ai_os_metrics_entity",
    domain: "ai_os",
    table: "emperor_ai_os_metrics",
    purpose: "观测指标按实体聚合和排障",
    sql: "SELECT id, entityType, entityId, metricName, createdAt FROM emperor_ai_os_metrics WHERE entityType='job' AND entityId='sample' ORDER BY createdAt DESC LIMIT 100",
    expectedIndexNames: ["idx_ai_os_metrics_entity_created", "idx_ai_os_metrics_entity"],
    migration: "0113_database_governance_v1.sql",
    risk: "medium",
  },
  {
    slug: "archive_runs_policy_status",
    domain: "ai_os",
    table: "ai_data_archive_runs",
    purpose: "归档任务按策略、状态和创建时间排障",
    sql: "SELECT archiveRunId, policySlug, status, createdAt FROM ai_data_archive_runs WHERE policySlug='ai_jobs.completed' AND status='succeeded' ORDER BY createdAt DESC LIMIT 50",
    expectedIndexNames: ["idx_ai_archive_runs_policy_status"],
    migration: "0115_data_lifecycle_artifacts_v1.sql",
    risk: "medium",
  },
  {
    slug: "artifacts_current_source",
    domain: "ai_os",
    table: "ai_artifacts",
    purpose: "下游节点按业务来源读取 current artifact",
    sql: "SELECT artifactId, artifactKey, version, isCurrent FROM ai_artifacts WHERE workspaceId=0 AND domain='listing' AND sourceTable='listings' AND sourceRowId='0' AND artifactKey='title' AND isCurrent=1 LIMIT 50",
    expectedIndexNames: ["idx_ai_artifacts_domain_source_current"],
    migration: "0115_data_lifecycle_artifacts_v1.sql",
    risk: "high",
  },
  {
    slug: "artifact_lineage_versions",
    domain: "ai_os",
    table: "ai_artifacts",
    purpose: "按业务谱系读取不可变 Artifact 历史版本",
    sql: "SELECT artifactId, version, status, isCurrent FROM ai_artifacts WHERE workspaceId=0 AND sourceTable='listings' AND sourceRowId='0' AND artifactKey='listing.content' ORDER BY version DESC LIMIT 100",
    expectedIndexNames: ["idx_ai_artifacts_lineage_version"],
    migration: "0128_artifact_source_of_truth.sql",
    risk: "high",
  },
  {
    slug: "slow_query_samples_window",
    domain: "ai_os",
    table: "database_slow_query_samples",
    purpose: "按时间窗口审计真实慢查询摘要",
    sql: "SELECT sampleId, digest, avgTimerWaitMs, sampledAt FROM database_slow_query_samples WHERE sampledAt >= DATE_SUB(NOW(), INTERVAL 30 DAY) ORDER BY avgTimerWaitMs DESC, sampledAt DESC LIMIT 100",
    expectedIndexNames: ["idx_db_slow_samples_sampled", "idx_db_slow_samples_schema_avg"],
    migration: "0117_database_runtime_observability.sql",
    risk: "medium",
  },
];

export const MIGRATION_REGRESSION_BASELINE: MigrationRegressionBaseline = {
  requiredMigrations: [
    "0104_emperor_agent_artifacts.sql",
    "0105_emperor_tool_runs.sql",
    "0106_ai_os_runtime_hardening.sql",
    "0107_ai_os_observability.sql",
    "0108_ai_job_queue_system.sql",
    "0109_agent_job_retry_alignment.sql",
    "0110_agent_artifacts_v1.sql",
    "0111_tool_gateway_governance_v2.sql",
    "0112_template_observability_qa.sql",
    "0113_database_governance_v1.sql",
    "0114_security_tenant_governance_v1.sql",
    "0115_data_lifecycle_artifacts_v1.sql",
    "0116_ops_workspace_isolation.sql",
    "0117_database_runtime_observability.sql",
    "0124_product_development_workspace_security.sql",
    "0125_dev_stage_consistency.sql",
    "0128_artifact_source_of_truth.sql",
    "0130_ai_operations_runtime.sql",
    "0131_dev_panorama_market_insights.sql",
    "0132_dev_project_progress_list.sql",
    "0133_dev_panorama_competitor_selection.sql",
    "0134_round4_business_agent_bindings.sql",
    "0135_video_job_checkpoint_binder.sql",
    "0136_business_job_binding_qa.sql",
    "0137_dev_project_operator_stage.sql",
    "0138_dev_project_landing_stage.sql",
  ],
  requiredTables: [
    "ai_jobs",
    "ai_job_workers",
    "ai_job_dead_letters",
    "emperor_agent_runs",
    "emperor_agent_checkpoints",
    "emperor_agent_events",
    "emperor_agent_artifacts",
    "emperor_tool_runs",
    "emperor_tool_secrets",
    "emperor_ai_os_metrics",
    "emperor_ai_os_evaluations",
    "dev_panorama_market_insights",
    "dev_project_progress",
    "ai_artifacts",
    "ai_artifact_selection_events",
    "ai_artifact_consumptions",
    "ai_storage_objects",
    "ai_data_archive_runs",
    "ai_operational_alerts",
    "database_slow_query_samples",
    "dev_analysis_stage_conflicts",
  ],
  requiredIndexes: DATABASE_PERFORMANCE_BASELINES.flatMap((baseline) => baseline.expectedIndexNames),
  requiredChecks: [
    {
      slug: "worker_queue_indexes",
      description: "AI Job 领取、锁续约和死信表必须具备可审计索引",
    },
    {
      slug: "human_in_loop_metrics",
      description: "Agent checkpoint 必须能统计确认率、编辑率、失败率和重试率",
    },
    {
      slug: "tool_governance_fields",
      description: "Tool Run 必须记录 failureKind、circuit 状态、workspace 和 lifecycle 字段",
    },
    {
      slug: "artifact_current_pointer",
      description: "Artifact 必须支持 current 版本指针和业务来源索引",
    },
    {
      slug: "archive_health",
      description: "高增长表必须有归档策略和归档 run 成功率监控",
    },
    {
      slug: "ops_workspace_isolation",
      description: "运营和广告核心表必须具备 workspaceId 和工作区索引",
    },
    {
      slug: "slow_query_sampling",
      description: "必须从 performance_schema 采样参数归一化的慢查询摘要",
    },
  ],
};

export function getDatabaseGovernanceSnapshot() {
  return {
    domains: DATABASE_DOMAINS,
    softForeignKeys: SOFT_FOREIGN_KEYS,
    indexBaselines: INDEX_BASELINES,
    archivePolicies: ARCHIVE_POLICIES,
    coreTableRowCountBaselines: CORE_TABLE_ROW_COUNT_BASELINES,
    performanceBaselines: DATABASE_PERFORMANCE_BASELINES,
    migrationRegressionBaseline: MIGRATION_REGRESSION_BASELINE,
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

export function buildTableRowCountSql(baselineOrTable: CoreTableRowCountBaseline | string) {
  const tableName = typeof baselineOrTable === "string" ? baselineOrTable : baselineOrTable.table;
  return `SELECT COUNT(*) AS rowCount FROM ${quoteIdentifier(tableName)}`;
}

export function buildExplainAuditSql(baseline: DatabasePerformanceBaseline) {
  const normalized = baseline.sql.trim();
  if (!/^SELECT\s/i.test(normalized) || /;\s*\S/.test(normalized)) {
    throw new Error(`Unsafe performance baseline SQL: ${baseline.slug}`);
  }
  return `EXPLAIN ${normalized.replace(/;$/, "")}`;
}

function normalizeDbRows(result: any): any[] {
  if (Array.isArray(result)) {
    if (Array.isArray(result[0])) return result[0];
    return result;
  }
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
}

function splitExplainKeys(value: unknown) {
  if (value === null || value === undefined) return [];
  return String(value)
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

export async function collectCoreTableRowCounts(
  baselines: CoreTableRowCountBaseline[] = CORE_TABLE_ROW_COUNT_BASELINES,
): Promise<CoreTableRowCountResult[]> {
  const db = await requireDb("Database row count baseline");
  const checkedAt = new Date().toISOString();
  const results: CoreTableRowCountResult[] = [];

  for (const baseline of baselines) {
    const queryResult = await db.execute(sql.raw(buildTableRowCountSql(baseline)));
    const rows = normalizeDbRows(queryResult);
    const firstRow = rows[0] || {};
    results.push({
      ...baseline,
      rowCount: Number(firstRow.rowCount ?? firstRow["COUNT(*)"] ?? 0),
      checkedAt,
    });
  }

  return results;
}

export async function auditDatabasePerformanceBaselines(
  baselines: DatabasePerformanceBaseline[] = DATABASE_PERFORMANCE_BASELINES,
): Promise<DatabaseExplainAuditResult[]> {
  const db = await requireDb("Database EXPLAIN baseline");
  const checkedAt = new Date().toISOString();
  const results: DatabaseExplainAuditResult[] = [];

  for (const baseline of baselines) {
    const queryResult = await db.execute(sql.raw(buildExplainAuditSql(baseline)));
    const explainRows = normalizeDbRows(queryResult);
    const observedKeys = Array.from(new Set(explainRows.flatMap((row) => splitExplainKeys(row.key ?? row.Key))));
    const possibleKeys = Array.from(new Set(explainRows.flatMap((row) => splitExplainKeys(row.possible_keys ?? row.possibleKeys ?? row.Possible_keys))));
    const knownKeys = new Set([...observedKeys, ...possibleKeys]);
    results.push({
      ...baseline,
      usesExpectedIndex: baseline.expectedIndexNames.some((indexName) => knownKeys.has(indexName)),
      observedKeys,
      possibleKeys,
      explainRows,
      checkedAt,
    });
  }

  return results;
}

export function getMigrationRegressionBaseline(): MigrationRegressionBaseline {
  return MIGRATION_REGRESSION_BASELINE;
}
