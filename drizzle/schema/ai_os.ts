import { bigint, boolean, decimal, int, json, longtext, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

// Generic AI job runs for long-running Emperor Skill / LLM tasks.
export const aiJobs = mysqlTable("ai_jobs", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  runId: varchar("runId", { length: 80 }).notNull().unique(),
  kind: varchar("kind", { length: 128 }).notNull(),
  module: varchar("module", { length: 64 }).notNull(),
  procedure: varchar("procedure", { length: 128 }),
  status: mysqlEnum("status", ["queued", "running", "succeeded", "failed", "canceled"]).default("queued").notNull(),
  progress: int("progress").default(0).notNull(),
  priority: int("priority").default(0).notNull(),
  queueName: varchar("queueName", { length: 64 }).default("default").notNull(),
  attempt: int("attempt").default(0).notNull(),
  maxAttempts: int("maxAttempts").default(1).notNull(),
  timeoutSeconds: int("timeoutSeconds").default(600).notNull(),
  userId: int("userId").notNull(),
  projectId: int("projectId"),
  skillSlug: varchar("skillSlug", { length: 128 }),
  input: json("input"),
  output: json("output"),
  errorMessage: text("errorMessage"),
  retentionClass: mysqlEnum("retentionClass", ["hot", "warm", "cold", "archive"]).default("hot").notNull(),
  archiveAfter: timestamp("archiveAfter"),
  deleteAfter: timestamp("deleteAfter"),
  archivedAt: timestamp("archivedAt"),
  archiveBatchId: varchar("archiveBatchId", { length: 80 }),
  nextRunAt: timestamp("nextRunAt"),
  leaseUntil: timestamp("leaseUntil"),
  lockedBy: varchar("lockedBy", { length: 128 }),
  claimedAt: timestamp("claimedAt"),
  lastHeartbeatAt: timestamp("lastHeartbeatAt"),
  deadLetterAt: timestamp("deadLetterAt"),
  deadLetterReason: text("deadLetterReason"),
  recoveryOfRunId: varchar("recoveryOfRunId", { length: 80 }),
  recoveryReason: text("recoveryReason"),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AiJob = typeof aiJobs.$inferSelect;

export type InsertAiJob = typeof aiJobs.$inferInsert;

export const aiOperationalAlerts = mysqlTable("ai_operational_alerts", {
  id: int("id").autoincrement().primaryKey(),
  alertId: varchar("alertId", { length: 80 }).notNull().unique(),
  fingerprint: varchar("fingerprint", { length: 191 }).notNull().unique(),
  category: varchar("category", { length: 64 }).notNull(),
  severity: mysqlEnum("severity", ["warning", "critical"]).default("warning").notNull(),
  status: mysqlEnum("status", ["open", "resolved"]).default("open").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  occurrenceCount: int("occurrenceCount").default(1).notNull(),
  firstOccurredAt: timestamp("firstOccurredAt").defaultNow().notNull(),
  lastOccurredAt: timestamp("lastOccurredAt").defaultNow().notNull(),
  notifiedAt: timestamp("notifiedAt"),
  resolvedAt: timestamp("resolvedAt"),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AiOperationalAlert = typeof aiOperationalAlerts.$inferSelect;
export type InsertAiOperationalAlert = typeof aiOperationalAlerts.$inferInsert;

export const aiJobWorkers = mysqlTable("ai_job_workers", {
  id: int("id").autoincrement().primaryKey(),
  workerId: varchar("workerId", { length: 128 }).notNull().unique(),
  hostname: varchar("hostname", { length: 255 }),
  pid: int("pid"),
  role: varchar("role", { length: 64 }).default("worker").notNull(),
  status: mysqlEnum("status", ["active", "draining", "stopped", "unhealthy"]).default("active").notNull(),
  concurrency: int("concurrency").default(1).notNull(),
  runningCount: int("runningCount").default(0).notNull(),
  lastHeartbeatAt: timestamp("lastHeartbeatAt"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  stoppedAt: timestamp("stoppedAt"),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AiJobWorker = typeof aiJobWorkers.$inferSelect;

export type InsertAiJobWorker = typeof aiJobWorkers.$inferInsert;

export const aiJobDeadLetters = mysqlTable("ai_job_dead_letters", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  runId: varchar("runId", { length: 80 }).notNull().unique(),
  kind: varchar("kind", { length: 128 }).notNull(),
  module: varchar("module", { length: 64 }).notNull(),
  procedure: varchar("procedure", { length: 128 }),
  status: varchar("status", { length: 40 }),
  attempt: int("attempt").default(0).notNull(),
  maxAttempts: int("maxAttempts").default(1).notNull(),
  userId: int("userId"),
  projectId: int("projectId"),
  skillSlug: varchar("skillSlug", { length: 128 }),
  errorMessage: text("errorMessage"),
  input: json("input"),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AiJobDeadLetter = typeof aiJobDeadLetters.$inferSelect;

export type InsertAiJobDeadLetter = typeof aiJobDeadLetters.$inferInsert;

export const aiStorageObjects = mysqlTable("ai_storage_objects", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  storageId: varchar("storageId", { length: 80 }).unique().notNull(),
  provider: mysqlEnum("provider", ["forge", "s3", "local", "external"]).default("forge").notNull(),
  bucket: varchar("bucket", { length: 128 }),
  objectKey: text("objectKey").notNull(),
  storageUri: text("storageUri").notNull(),
  publicUrl: text("publicUrl"),
  mimeType: varchar("mimeType", { length: 128 }),
  fileName: varchar("fileName", { length: 255 }),
  sizeBytes: bigint("sizeBytes", { mode: "number" }),
  contentHash: varchar("contentHash", { length: 64 }),
  contentEncoding: varchar("contentEncoding", { length: 64 }),
  sourceDomain: mysqlEnum("sourceDomain", ["listing", "image", "ads", "video", "agent", "project", "file", "ops", "tool", "other"]).default("other").notNull(),
  sourceType: mysqlEnum("sourceType", ["upload", "ai_output", "user_edit", "import", "tool_output", "system", "archive"]).default("upload").notNull(),
  sourceId: varchar("sourceId", { length: 128 }),
  lifecycleState: mysqlEnum("lifecycleState", ["hot", "warm", "cold", "archived", "deleted"]).default("hot").notNull(),
  retainUntil: timestamp("retainUntil"),
  archiveAfter: timestamp("archiveAfter"),
  deleteAfter: timestamp("deleteAfter"),
  archivedAt: timestamp("archivedAt"),
  metadata: json("metadata"),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AiStorageObject = typeof aiStorageObjects.$inferSelect;

export type InsertAiStorageObject = typeof aiStorageObjects.$inferInsert;

export const aiArtifacts = mysqlTable("ai_artifacts", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  artifactId: varchar("artifactId", { length: 80 }).unique().notNull(),
  domain: mysqlEnum("domain", ["listing", "image", "ads", "video", "agent", "project", "file", "ops", "tool", "other"]).default("other").notNull(),
  artifactKey: varchar("artifactKey", { length: 128 }).notNull(),
  artifactType: mysqlEnum("artifactType", ["json", "text", "markdown", "html", "image", "file", "table", "video", "audio", "other"]).default("json").notNull(),
  sourceType: mysqlEnum("sourceType", ["upload", "ai_output", "user_edit", "import", "tool_output", "system", "archive"]).default("ai_output").notNull(),
  sourceId: varchar("sourceId", { length: 128 }),
  sourceTable: varchar("sourceTable", { length: 128 }),
  sourceRowId: varchar("sourceRowId", { length: 128 }),
  runId: varchar("runId", { length: 80 }),
  agentSlug: varchar("agentSlug", { length: 128 }),
  nodeId: varchar("nodeId", { length: 128 }),
  projectId: int("projectId"),
  userId: int("userId"),
  status: mysqlEnum("status", ["draft", "final", "superseded", "archived", "deleted"]).default("draft").notNull(),
  version: int("version").default(1).notNull(),
  isCurrent: int("isCurrent").default(0).notNull(),
  parentArtifactId: varchar("parentArtifactId", { length: 80 }),
  selectedBy: int("selectedBy"),
  currentSince: timestamp("currentSince"),
  contentJson: json("contentJson"),
  searchableText: text("searchableText"),
  summary: text("summary"),
  contentHash: varchar("contentHash", { length: 64 }),
  storageObjectId: int("storageObjectId"),
  storageUri: text("storageUri"),
  mimeType: varchar("mimeType", { length: 128 }),
  fileName: varchar("fileName", { length: 255 }),
  fileSizeBytes: bigint("fileSizeBytes", { mode: "number" }),
  retentionClass: mysqlEnum("retentionClass", ["hot", "warm", "cold", "archive"]).default("hot").notNull(),
  retainUntil: timestamp("retainUntil"),
  archiveAfter: timestamp("archiveAfter"),
  deleteAfter: timestamp("deleteAfter"),
  archivedAt: timestamp("archivedAt"),
  metadata: json("metadata"),
  sourceSkillRunId: varchar("sourceSkillRunId", { length: 80 }),
  sourceAiJobRunId: varchar("sourceAiJobRunId", { length: 80 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AiArtifact = typeof aiArtifacts.$inferSelect;

export type InsertAiArtifact = typeof aiArtifacts.$inferInsert;

export const aiArtifactSelectionEvents = mysqlTable("ai_artifact_selection_events", {
  id: int("id").autoincrement().primaryKey(),
  selectionId: varchar("selectionId", { length: 80 }).unique().notNull(),
  workspaceId: int("workspaceId"),
  projectId: int("projectId"),
  artifactKey: varchar("artifactKey", { length: 128 }).notNull(),
  sourceTable: varchar("sourceTable", { length: 128 }),
  sourceRowId: varchar("sourceRowId", { length: 128 }),
  fromArtifactId: varchar("fromArtifactId", { length: 80 }),
  fromVersion: int("fromVersion"),
  toArtifactId: varchar("toArtifactId", { length: 80 }).notNull(),
  toVersion: int("toVersion").notNull(),
  action: mysqlEnum("action", ["select", "rollback", "confirm"]).notNull(),
  userId: int("userId"),
  reason: text("reason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AiArtifactSelectionEvent = typeof aiArtifactSelectionEvents.$inferSelect;

export type InsertAiArtifactSelectionEvent = typeof aiArtifactSelectionEvents.$inferInsert;

export const aiArtifactConsumptions = mysqlTable("ai_artifact_consumptions", {
  id: int("id").autoincrement().primaryKey(),
  consumptionId: varchar("consumptionId", { length: 80 }).unique().notNull(),
  workspaceId: int("workspaceId"),
  projectId: int("projectId"),
  artifactId: varchar("artifactId", { length: 80 }).notNull(),
  artifactKey: varchar("artifactKey", { length: 128 }).notNull(),
  artifactVersion: int("artifactVersion").notNull(),
  artifactRef: varchar("artifactRef", { length: 192 }).notNull(),
  consumerDomain: mysqlEnum("consumerDomain", ["listing", "image", "ads", "video", "agent", "project", "file", "ops", "tool", "other"]).notNull(),
  consumerType: mysqlEnum("consumerType", ["agent_node", "ai_job", "skill_run", "business_operation"]).notNull(),
  consumerId: varchar("consumerId", { length: 128 }).notNull(),
  runId: varchar("runId", { length: 80 }),
  nodeId: varchar("nodeId", { length: 128 }),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AiArtifactConsumption = typeof aiArtifactConsumptions.$inferSelect;

export type InsertAiArtifactConsumption = typeof aiArtifactConsumptions.$inferInsert;

export const aiDataArchiveRuns = mysqlTable("ai_data_archive_runs", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  archiveRunId: varchar("archiveRunId", { length: 80 }).unique().notNull(),
  policySlug: varchar("policySlug", { length: 128 }).notNull(),
  tableName: varchar("tableName", { length: 128 }).notNull(),
  status: mysqlEnum("status", ["planned", "running", "succeeded", "failed", "dry_run"]).default("planned").notNull(),
  mode: mysqlEnum("mode", ["count", "archive", "delete"]).default("archive").notNull(),
  cutoffAt: timestamp("cutoffAt"),
  batchSize: int("batchSize").default(1000).notNull(),
  candidateCount: int("candidateCount").default(0).notNull(),
  archivedCount: int("archivedCount").default(0).notNull(),
  deletedCount: int("deletedCount").default(0).notNull(),
  storageObjectId: int("storageObjectId"),
  storageUri: text("storageUri"),
  errorMessage: text("errorMessage"),
  metadata: json("metadata"),
  createdBy: int("createdBy"),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AiDataArchiveRun = typeof aiDataArchiveRuns.$inferSelect;

export type InsertAiDataArchiveRun = typeof aiDataArchiveRuns.$inferInsert;

export const aiDataArchiveItems = mysqlTable("ai_data_archive_items", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  archiveRunId: varchar("archiveRunId", { length: 80 }).notNull(),
  sourceTable: varchar("sourceTable", { length: 128 }).notNull(),
  sourceId: varchar("sourceId", { length: 128 }).notNull(),
  sourceCreatedAt: timestamp("sourceCreatedAt"),
  storageObjectId: int("storageObjectId"),
  contentHash: varchar("contentHash", { length: 64 }),
  status: mysqlEnum("status", ["archived", "deleted", "failed"]).default("archived").notNull(),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AiDataArchiveItem = typeof aiDataArchiveItems.$inferSelect;

export type InsertAiDataArchiveItem = typeof aiDataArchiveItems.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// 皇帝 · AI能力中台 融合表（Emperor Integration）
// ─────────────────────────────────────────────────────────────────────────────

// Skill 定义表（存储 110 个 Skill 的 manifest 和元数据）
export const emperorSkills = mysqlTable("emperor_skills", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  slug: varchar("slug", { length: 128 }).unique().notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 64 }).notNull().default("通用"),
  owner: varchar("owner", { length: 64 }).default("system"),
  riskTier: mysqlEnum("riskTier", ["L0", "L1", "L2", "L3"]).default("L1").notNull(),
  status: mysqlEnum("status", ["Draft", "Validated", "Approved", "Released", "Deprecated"]).default("Released").notNull(),
  scope: mysqlEnum("scope", ["global", "private", "shared"]).default("global").notNull(),
  version: int("version").default(1).notNull(),
  isSystem: int("isSystem").default(1).notNull(),
  callCount: int("callCount").default(0).notNull(),
  // manifest JSON: { implementation: { systemPrompt, userPromptTemplate, modelPolicy, tools, knowledge }, contract: { inputSchema, outputSchema, mode, timeoutMs } }
  manifest: json("manifest").notNull(),
  // 模型路由覆盖（null = 使用 manifest.implementation.modelPolicy）
  modelOverride: varchar("modelOverride", { length: 128 }),
  // cc-haha 元数据字段
  whenToUse: text("when_to_use"),
  timeoutSeconds: int("timeout_seconds").default(120).notNull(),
  executionMode: mysqlEnum("execution_mode", ["inline", "fork", "background"]).default("inline").notNull(),
  allowedTools: json("allowed_tools"),
  disallowedTools: json("disallowed_tools"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmperorSkill = typeof emperorSkills.$inferSelect;

export type InsertEmperorSkill = typeof emperorSkills.$inferInsert;

// Skill 运行记录表
export const emperorSkillRuns = mysqlTable("emperor_skill_runs", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  runId: varchar("runId", { length: 64 }).unique().notNull(),
  skillSlug: varchar("skillSlug", { length: 128 }).notNull(),
  skillName: varchar("skillName", { length: 255 }),
  skillVersion: int("skillVersion"),
  skillPromptHash: varchar("skillPromptHash", { length: 64 }),
  skillManifestHash: varchar("skillManifestHash", { length: 64 }),
  migrationSource: varchar("migrationSource", { length: 255 }),
  userId: int("userId"),
  // 运行输入/输出（JSON）
  input: json("input"),
  output: json("output"),
  // 运行状态
  status: mysqlEnum("status", ["queued", "running", "succeeded", "failed", "canceled"]).default("queued").notNull(),
  stateVersion: int("stateVersion").default(0).notNull(),
  recoverySnapshotId: varchar("recoverySnapshotId", { length: 80 }),
  errorMessage: text("errorMessage"),
  // 用量统计
  modelSlug: varchar("modelSlug", { length: 128 }),
  provider: varchar("provider", { length: 64 }),
  inputTokens: int("inputTokens").default(0),
  outputTokens: int("outputTokens").default(0),
  durationMs: int("durationMs").default(0),
  costCents: int("costCents").default(0),
  // 追踪
  traceId: varchar("traceId", { length: 64 }),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EmperorSkillRun = typeof emperorSkillRuns.$inferSelect;

export type InsertEmperorSkillRun = typeof emperorSkillRuns.$inferInsert;

// Agent 定义表
export const emperorAgents = mysqlTable("emperor_agents", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  slug: varchar("slug", { length: 128 }).unique().notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 64 }).default("通用"),
  status: mysqlEnum("status", ["draft", "active", "deprecated"]).default("active").notNull(),
  scope: mysqlEnum("scope", ["global", "project", "private"]).default("project").notNull(),
  triggerType: mysqlEnum("triggerType", ["manual", "event", "scheduled"]).default("manual").notNull(),
  maxExecutionSeconds: int("maxExecutionSeconds").default(300).notNull(),
  cronExpression: varchar("cronExpression", { length: 120 }),
  ownerUserId: int("ownerUserId"),
  // DAG 定义 JSON: { nodes: [...], edges: [...] }
  dagDefinition: json("dagDefinition").notNull(),
  // cc-haha 执行模式
  executionMode: mysqlEnum("execution_mode", ["inline", "fork", "background"]).default("inline").notNull(),
  callCount: int("callCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmperorAgent = typeof emperorAgents.$inferSelect;

export type InsertEmperorAgent = typeof emperorAgents.$inferInsert;

export const emperorAgentTemplateVersions = mysqlTable("emperor_agent_template_versions", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  agentSlug: varchar("agentSlug", { length: 128 }).notNull(),
  agentName: varchar("agentName", { length: 255 }),
  parentVersionId: int("parentVersionId"),
  versionNumber: int("versionNumber").notNull(),
  version: varchar("version", { length: 40 }).notNull(),
  dagHash: varchar("dagHash", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["draft", "released", "deprecated"]).default("released").notNull(),
  isDefault: int("isDefault").default(0).notNull(),
  rolloutPercent: int("rolloutPercent").default(100).notNull(),
  rolloutPolicy: json("rolloutPolicy"),
  dagDefinition: json("dagDefinition").notNull(),
  releaseNotes: text("releaseNotes"),
  createdBy: int("createdBy"),
  releasedAt: timestamp("releasedAt"),
  activatedAt: timestamp("activatedAt"),
  deprecatedAt: timestamp("deprecatedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmperorAgentTemplateVersion = typeof emperorAgentTemplateVersions.$inferSelect;

export type InsertEmperorAgentTemplateVersion = typeof emperorAgentTemplateVersions.$inferInsert;

// Agent 运行实例。长流程不直接等 LLM 返回，而是以 run/checkpoint 推进。
export const emperorAgentRuns = mysqlTable("emperor_agent_runs", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  runId: varchar("runId", { length: 80 }).unique().notNull(),
  agentSlug: varchar("agentSlug", { length: 128 }).notNull(),
  agentName: varchar("agentName", { length: 255 }),
  templateVersionId: int("templateVersionId"),
  templateVersion: varchar("templateVersion", { length: 40 }),
  dagHash: varchar("dagHash", { length: 64 }),
  userId: int("userId").notNull(),
  projectId: int("projectId"),
  status: mysqlEnum("status", ["running", "waiting_human", "paused", "completed", "failed", "canceled"]).default("waiting_human").notNull(),
  currentNodeId: varchar("currentNodeId", { length: 128 }),
  progress: int("progress").default(0).notNull(),
  stateVersion: int("stateVersion").default(0).notNull(),
  recoverySnapshotId: varchar("recoverySnapshotId", { length: 80 }),
  inputs: json("inputs"),
  outputs: json("outputs"),
  errorMessage: text("errorMessage"),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmperorAgentRun = typeof emperorAgentRuns.$inferSelect;

export type InsertEmperorAgentRun = typeof emperorAgentRuns.$inferInsert;

export const emperorAgentCheckpoints = mysqlTable("emperor_agent_checkpoints", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  runId: varchar("runId", { length: 80 }).notNull(),
  agentSlug: varchar("agentSlug", { length: 128 }).notNull(),
  nodeId: varchar("nodeId", { length: 128 }).notNull(),
  nodeLabel: varchar("nodeLabel", { length: 255 }),
  nodeType: varchar("nodeType", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["pending", "ready", "running", "waiting_human", "confirmed", "skipped", "failed", "canceled"]).default("pending").notNull(),
  attempt: int("attempt").default(0).notNull(),
  maxAttempts: int("maxAttempts").default(1).notNull(),
  input: json("input"),
  output: json("output"),
  userEdit: json("userEdit"),
  metadata: json("metadata"),
  skillRunId: varchar("skillRunId", { length: 80 }),
  aiJobRunId: varchar("aiJobRunId", { length: 80 }),
  aiJobAttempt: int("aiJobAttempt").default(0).notNull(),
  aiJobClaimedAt: timestamp("aiJobClaimedAt"),
  lockToken: varchar("lockToken", { length: 80 }),
  lockedAt: timestamp("lockedAt"),
  timeoutAt: timestamp("timeoutAt"),
  retryCount: int("retryCount").default(0).notNull(),
  retryScheduledAt: timestamp("retryScheduledAt"),
  lastFailureKind: varchar("lastFailureKind", { length: 40 }),
  reviewerUserId: int("reviewerUserId"),
  errorMessage: longtext("errorMessage"),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  confirmedAt: timestamp("confirmedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmperorAgentCheckpoint = typeof emperorAgentCheckpoints.$inferSelect;

export type InsertEmperorAgentCheckpoint = typeof emperorAgentCheckpoints.$inferInsert;

export const emperorAgentEvents = mysqlTable("emperor_agent_events", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  runId: varchar("runId", { length: 80 }).notNull(),
  agentSlug: varchar("agentSlug", { length: 128 }).notNull(),
  nodeId: varchar("nodeId", { length: 128 }),
  eventType: varchar("eventType", { length: 64 }).notNull(),
  message: text("message"),
  payload: json("payload"),
  retentionClass: mysqlEnum("retentionClass", ["hot", "warm", "cold", "archive"]).default("hot").notNull(),
  archiveAfter: timestamp("archiveAfter"),
  deleteAfter: timestamp("deleteAfter"),
  archivedAt: timestamp("archivedAt"),
  archiveBatchId: varchar("archiveBatchId", { length: 80 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EmperorAgentEvent = typeof emperorAgentEvents.$inferSelect;

export type InsertEmperorAgentEvent = typeof emperorAgentEvents.$inferInsert;

export const emperorAgentArtifacts = mysqlTable("emperor_agent_artifacts", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  runId: varchar("runId", { length: 80 }).notNull(),
  unifiedArtifactId: varchar("unifiedArtifactId", { length: 80 }),
  agentSlug: varchar("agentSlug", { length: 128 }).notNull(),
  nodeId: varchar("nodeId", { length: 128 }).notNull(),
  artifactKey: varchar("artifactKey", { length: 128 }).notNull(),
  artifactType: mysqlEnum("artifactType", ["json", "text", "markdown", "html", "image", "file", "table", "other"]).default("json").notNull(),
  status: mysqlEnum("status", ["draft", "final", "superseded"]).default("draft").notNull(),
  version: int("version").default(1).notNull(),
  isCurrent: int("isCurrent").default(0).notNull(),
  currentSince: timestamp("currentSince"),
  selectedBy: int("selectedBy"),
  userId: int("userId").notNull(),
  projectId: int("projectId"),
  content: json("content"),
  contentHash: varchar("contentHash", { length: 64 }),
  summary: text("summary"),
  metadata: json("metadata"),
  mimeType: varchar("mimeType", { length: 128 }),
  fileName: varchar("fileName", { length: 255 }),
  fileSizeBytes: bigint("fileSizeBytes", { mode: "number" }),
  storageUri: text("storageUri"),
  retentionClass: mysqlEnum("retentionClass", ["hot", "warm", "cold", "archive"]).default("hot").notNull(),
  archiveAfter: timestamp("archiveAfter"),
  deleteAfter: timestamp("deleteAfter"),
  archivedAt: timestamp("archivedAt"),
  sourceSkillRunId: varchar("sourceSkillRunId", { length: 80 }),
  sourceAiJobRunId: varchar("sourceAiJobRunId", { length: 80 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmperorAgentArtifact = typeof emperorAgentArtifacts.$inferSelect;

export type InsertEmperorAgentArtifact = typeof emperorAgentArtifacts.$inferInsert;

export const emperorTools = mysqlTable("emperor_tools", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  slug: varchar("slug", { length: 128 }).unique().notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  type: mysqlEnum("type", ["mcp", "api", "internal", "code"]).notNull(),
  config: json("config"),
  governancePolicy: json("governancePolicy"),
  permissionPolicy: json("permissionPolicy"),
  rateLimitPolicy: json("rateLimitPolicy"),
  circuitBreakerPolicy: json("circuitBreakerPolicy"),
  secretRefs: json("secretRefs"),
  outputPolicy: json("outputPolicy"),
  inputSchema: json("inputSchema"),
  outputSchema: json("outputSchema"),
  isActive: int("isActive").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmperorTool = typeof emperorTools.$inferSelect;

export type InsertEmperorTool = typeof emperorTools.$inferInsert;

export const emperorToolRuns = mysqlTable("emperor_tool_runs", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  toolRunId: varchar("toolRunId", { length: 80 }).unique().notNull(),
  toolSlug: varchar("toolSlug", { length: 128 }).notNull(),
  toolName: varchar("toolName", { length: 255 }),
  toolType: mysqlEnum("toolType", ["mcp", "api", "internal", "code"]).notNull(),
  source: mysqlEnum("source", ["builtin", "emperor_tools", "mcp_connector"]).notNull(),
  status: mysqlEnum("status", ["running", "succeeded", "failed", "blocked"]).default("running").notNull(),
  riskLevel: mysqlEnum("riskLevel", ["low", "medium", "high", "critical"]).default("medium").notNull(),
  userId: int("userId").notNull(),
  agentRunId: varchar("agentRunId", { length: 80 }),
  nodeId: varchar("nodeId", { length: 128 }),
  projectId: int("projectId"),
  input: json("input"),
  output: json("output"),
  normalizedOutput: json("normalizedOutput"),
  errorMessage: text("errorMessage"),
  retentionClass: mysqlEnum("retentionClass", ["hot", "warm", "cold", "archive"]).default("hot").notNull(),
  archiveAfter: timestamp("archiveAfter"),
  deleteAfter: timestamp("deleteAfter"),
  archivedAt: timestamp("archivedAt"),
  archiveBatchId: varchar("archiveBatchId", { length: 80 }),
  failureKind: mysqlEnum("failureKind", ["policy", "rate_limit", "circuit_open", "schema", "auth", "timeout", "network", "http", "executor", "unknown"]),
  retryable: int("retryable").default(0).notNull(),
  attemptCount: int("attemptCount").default(0).notNull(),
  governanceDecision: json("governanceDecision"),
  secretRefs: json("secretRefs"),
  circuitState: varchar("circuitState", { length: 32 }),
  durationMs: int("durationMs"),
  httpStatus: int("httpStatus"),
  requestHost: varchar("requestHost", { length: 255 }),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmperorToolRun = typeof emperorToolRuns.$inferSelect;

export type InsertEmperorToolRun = typeof emperorToolRuns.$inferInsert;

export const emperorToolSecrets = mysqlTable("emperor_tool_secrets", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  slug: varchar("slug", { length: 128 }).unique().notNull(),
  description: text("description"),
  encryptedValue: text("encryptedValue").notNull(),
  iv: varchar("iv", { length: 32 }).notNull(),
  authTag: varchar("authTag", { length: 32 }).notNull(),
  keyVersion: varchar("keyVersion", { length: 64 }).default("v1").notNull(),
  previousKeyVersion: varchar("previousKeyVersion", { length: 64 }),
  status: mysqlEnum("status", ["active", "rotating", "retired"]).default("active").notNull(),
  rotatedAt: timestamp("rotatedAt"),
  expiresAt: timestamp("expiresAt"),
  metadata: json("metadata"),
  createdBy: int("createdBy"),
  updatedBy: int("updatedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmperorToolSecret = typeof emperorToolSecrets.$inferSelect;

export type InsertEmperorToolSecret = typeof emperorToolSecrets.$inferInsert;

export const emperorSecretKeyVersions = mysqlTable("emperor_secret_key_versions", {
  id: int("id").autoincrement().primaryKey(),
  scope: mysqlEnum("scope", ["tool", "model", "system"]).default("tool").notNull(),
  keyVersion: varchar("keyVersion", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["active", "deprecated", "retired"]).default("active").notNull(),
  activatedAt: timestamp("activatedAt"),
  deprecatedAt: timestamp("deprecatedAt"),
  retiredAt: timestamp("retiredAt"),
  metadata: json("metadata"),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmperorSecretKeyVersion = typeof emperorSecretKeyVersions.$inferSelect;

export type InsertEmperorSecretKeyVersion = typeof emperorSecretKeyVersions.$inferInsert;

export const emperorAiOsMetrics = mysqlTable("emperor_ai_os_metrics", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  entityType: varchar("entityType", { length: 40 }).notNull(),
  entityId: varchar("entityId", { length: 128 }).notNull(),
  metricName: varchar("metricName", { length: 80 }).notNull(),
  metricValue: decimal("metricValue", { precision: 18, scale: 4 }),
  status: varchar("status", { length: 40 }),
  userId: int("userId"),
  projectId: int("projectId"),
  agentSlug: varchar("agentSlug", { length: 128 }),
  nodeId: varchar("nodeId", { length: 128 }),
  skillSlug: varchar("skillSlug", { length: 128 }),
  toolSlug: varchar("toolSlug", { length: 128 }),
  metadata: json("metadata"),
  retentionClass: mysqlEnum("retentionClass", ["hot", "warm", "cold", "archive"]).default("hot").notNull(),
  archiveAfter: timestamp("archiveAfter"),
  deleteAfter: timestamp("deleteAfter"),
  archivedAt: timestamp("archivedAt"),
  archiveBatchId: varchar("archiveBatchId", { length: 80 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EmperorAiOsMetric = typeof emperorAiOsMetrics.$inferSelect;

export type InsertEmperorAiOsMetric = typeof emperorAiOsMetrics.$inferInsert;

export const emperorAiOsEvaluations = mysqlTable("emperor_ai_os_evaluations", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  evaluationId: varchar("evaluationId", { length: 80 }).unique().notNull(),
  entityType: varchar("entityType", { length: 40 }).notNull(),
  entityId: varchar("entityId", { length: 128 }).notNull(),
  evaluationType: varchar("evaluationType", { length: 80 }).default("heuristic_quality").notNull(),
  score: decimal("score", { precision: 5, scale: 2 }).notNull(),
  grade: varchar("grade", { length: 20 }),
  status: varchar("status", { length: 40 }),
  evaluator: varchar("evaluator", { length: 80 }).default("system.heuristic").notNull(),
  userId: int("userId"),
  projectId: int("projectId"),
  agentSlug: varchar("agentSlug", { length: 128 }),
  nodeId: varchar("nodeId", { length: 128 }),
  skillSlug: varchar("skillSlug", { length: 128 }),
  toolSlug: varchar("toolSlug", { length: 128 }),
  rubric: json("rubric"),
  details: json("details"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EmperorAiOsEvaluation = typeof emperorAiOsEvaluations.$inferSelect;

export type InsertEmperorAiOsEvaluation = typeof emperorAiOsEvaluations.$inferInsert;

// Parameter-normalized snapshots from MySQL performance_schema.
export const databaseSlowQuerySamples = mysqlTable("database_slow_query_samples", {
  id: int("id").autoincrement().primaryKey(),
  sampleId: varchar("sampleId", { length: 80 }).unique().notNull(),
  databaseSchema: varchar("databaseSchema", { length: 128 }).notNull(),
  digest: varchar("digest", { length: 128 }).notNull(),
  digestText: text("digestText").notNull(),
  executionCount: bigint("executionCount", { mode: "number" }).default(0).notNull(),
  avgTimerWaitMs: decimal("avgTimerWaitMs", { precision: 18, scale: 3 }).default("0.000").notNull(),
  maxTimerWaitMs: decimal("maxTimerWaitMs", { precision: 18, scale: 3 }).default("0.000").notNull(),
  totalRowsExamined: bigint("totalRowsExamined", { mode: "number" }).default(0).notNull(),
  totalRowsSent: bigint("totalRowsSent", { mode: "number" }).default(0).notNull(),
  firstSeen: timestamp("firstSeen"),
  lastSeen: timestamp("lastSeen"),
  sampledAt: timestamp("sampledAt").defaultNow().notNull(),
  source: varchar("source", { length: 64 }).default("performance_schema").notNull(),
  metadata: json("metadata"),
});

export type DatabaseSlowQuerySample = typeof databaseSlowQuerySamples.$inferSelect;

export type InsertDatabaseSlowQuerySample = typeof databaseSlowQuerySamples.$inferInsert;

// Emperor 知识库（cc-haha 四分类记忆体系）
export const emperorKnowledge = mysqlTable("emperor_knowledge", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  userId: int("user_id").notNull(),
  projectId: varchar("project_id", { length: 128 }),
  title: varchar("title", { length: 512 }).notNull(),
  content: text("content").notNull(),
  // 记忆类型：feedback=用户反馈 fact=事实知识 project=项目记忆 reference=参考资料
  memoryType: mysqlEnum("memory_type", ["feedback", "fact", "project", "reference"]).default("fact").notNull(),
  source: varchar("source", { length: 1024 }),
  tags: json("tags"),
  isActive: int("is_active").default(1).notNull(),
  confidence: decimal("confidence", { precision: 4, scale: 3 }).default("1.000"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export type EmperorKnowledgeItem = typeof emperorKnowledge.$inferSelect;

export type InsertEmperorKnowledgeItem = typeof emperorKnowledge.$inferInsert;

// MCP 连接器配置表
export const emperorMcpConnectors = mysqlTable("emperor_mcp_connectors", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  slug: varchar("slug", { length: 128 }).unique().notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  connectionType: mysqlEnum("connectionType", ["http_api", "database", "webhook", "internal", "script"]).default("http_api").notNull(),
  // 连接配置 JSON（含 baseUrl、apiKey 等，敏感字段加密存储）
  config: json("config"),
  governancePolicy: json("governancePolicy"),
  secretRefs: json("secretRefs"),
  isActive: int("isActive").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmperorMcpConnector = typeof emperorMcpConnectors.$inferSelect;

export type InsertEmperorMcpConnector = typeof emperorMcpConnectors.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// 皇帝 · 通用对话式任务管理器（Conversation Task Manager）
// 对话仅编排既有Skill / Agent / Tool与Run，不复制附件二进制或密钥。
// ─────────────────────────────────────────────────────────────────────────────

export const emperorConversations = mysqlTable("emperor_conversations", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  conversationId: varchar("conversationId", { length: 80 }).notNull().unique(),
  userId: int("userId").notNull(),
  projectId: int("projectId"),
  title: varchar("title", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["draft", "planning", "awaiting_plan_confirmation", "running", "waiting_human", "completed", "failed", "canceled", "archived"]).default("draft").notNull(),
  activePlanId: varchar("activePlanId", { length: 80 }),
  lastTraceId: varchar("lastTraceId", { length: 80 }),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmperorConversation = typeof emperorConversations.$inferSelect;
export type InsertEmperorConversation = typeof emperorConversations.$inferInsert;

export const emperorConversationMessages = mysqlTable("emperor_conversation_messages", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  messageId: varchar("messageId", { length: 80 }).notNull().unique(),
  conversationId: varchar("conversationId", { length: 80 }).notNull(),
  role: mysqlEnum("role", ["user", "assistant", "system", "tool"]).notNull(),
  status: mysqlEnum("status", ["draft", "streaming", "completed", "failed", "canceled"]).default("completed").notNull(),
  content: text("content").notNull(),
  structuredContent: json("structuredContent"),
  skillRunId: varchar("skillRunId", { length: 80 }),
  planId: varchar("planId", { length: 80 }),
  stepId: varchar("stepId", { length: 80 }),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmperorConversationMessage = typeof emperorConversationMessages.$inferSelect;
export type InsertEmperorConversationMessage = typeof emperorConversationMessages.$inferInsert;

export const emperorConversationAttachments = mysqlTable("emperor_conversation_attachments", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  attachmentId: varchar("attachmentId", { length: 80 }).notNull().unique(),
  conversationId: varchar("conversationId", { length: 80 }).notNull(),
  messageId: varchar("messageId", { length: 80 }),
  storageObjectId: int("storageObjectId"),
  artifactId: varchar("artifactId", { length: 80 }),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  mimeType: varchar("mimeType", { length: 128 }).notNull(),
  sizeBytes: bigint("sizeBytes", { mode: "number" }),
  contentHash: varchar("contentHash", { length: 64 }),
  contextPolicy: mysqlEnum("contextPolicy", ["summary_only", "extracted_text", "image_vision", "blocked"]).default("summary_only").notNull(),
  scanStatus: mysqlEnum("scanStatus", ["pending", "ready", "blocked", "failed"]).default("pending").notNull(),
  contextSummary: text("contextSummary"),
  metadata: json("metadata"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmperorConversationAttachment = typeof emperorConversationAttachments.$inferSelect;
export type InsertEmperorConversationAttachment = typeof emperorConversationAttachments.$inferInsert;

export const emperorConversationPlans = mysqlTable("emperor_conversation_plans", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  planId: varchar("planId", { length: 80 }).notNull().unique(),
  conversationId: varchar("conversationId", { length: 80 }).notNull(),
  version: int("version").default(1).notNull(),
  status: mysqlEnum("status", ["draft", "proposed", "approved", "executing", "completed", "failed", "canceled", "superseded"]).default("draft").notNull(),
  goal: text("goal").notNull(),
  assumptions: json("assumptions"),
  planJson: json("planJson").notNull(),
  riskSummary: json("riskSummary"),
  approvedBy: int("approvedBy"),
  approvedAt: timestamp("approvedAt"),
  canceledAt: timestamp("canceledAt"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmperorConversationPlan = typeof emperorConversationPlans.$inferSelect;
export type InsertEmperorConversationPlan = typeof emperorConversationPlans.$inferInsert;

export const emperorConversationPlanSteps = mysqlTable("emperor_conversation_plan_steps", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  stepId: varchar("stepId", { length: 80 }).notNull().unique(),
  planId: varchar("planId", { length: 80 }).notNull(),
  sequence: int("sequence").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  capabilityType: mysqlEnum("capabilityType", ["skill", "agent", "tool"]).notNull(),
  capabilitySlug: varchar("capabilitySlug", { length: 128 }).notNull(),
  input: json("input"),
  riskLevel: mysqlEnum("riskLevel", ["L0", "L1", "L2", "L3"]).default("L1").notNull(),
  approvalRequired: int("approvalRequired").default(0).notNull(),
  approvalState: mysqlEnum("approvalState", ["not_required", "pending", "approved", "rejected", "skipped"]).default("not_required").notNull(),
  status: mysqlEnum("status", ["pending", "ready", "running", "waiting_human", "succeeded", "skipped", "failed", "canceled"]).default("pending").notNull(),
  stateVersion: int("stateVersion").default(0).notNull(),
  skillRunId: varchar("skillRunId", { length: 80 }),
  agentRunId: varchar("agentRunId", { length: 80 }),
  toolRunId: varchar("toolRunId", { length: 80 }),
  traceId: varchar("traceId", { length: 80 }),
  recoverySnapshotId: varchar("recoverySnapshotId", { length: 80 }),
  reviewRequestId: varchar("reviewRequestId", { length: 80 }),
  errorMessage: text("errorMessage"),
  metadata: json("metadata"),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmperorConversationPlanStep = typeof emperorConversationPlanSteps.$inferSelect;
export type InsertEmperorConversationPlanStep = typeof emperorConversationPlanSteps.$inferInsert;

export const emperorExecutionStateSnapshots = mysqlTable("emperor_execution_state_snapshots", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  snapshotId: varchar("snapshotId", { length: 80 }).notNull().unique(),
  workspaceId: int("workspaceId"),
  traceId: varchar("traceId", { length: 80 }),
  targetType: varchar("targetType", { length: 40 }).notNull(),
  targetId: varchar("targetId", { length: 128 }).notNull(),
  stateVersion: int("stateVersion").notNull(),
  status: varchar("status", { length: 40 }).default("captured").notNull(),
  planId: varchar("planId", { length: 80 }),
  planVersion: int("planVersion"),
  capabilityType: varchar("capabilityType", { length: 24 }),
  capabilitySlug: varchar("capabilitySlug", { length: 128 }),
  capabilityVersion: varchar("capabilityVersion", { length: 80 }),
  approvalState: varchar("approvalState", { length: 40 }),
  contextManifestHash: varchar("contextManifestHash", { length: 64 }),
  inputHash: varchar("inputHash", { length: 64 }),
  snapshot: json("snapshot").notNull(),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const emperorExecutionRecoveryRequests = mysqlTable("emperor_execution_recovery_requests", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  recoveryId: varchar("recoveryId", { length: 80 }).notNull().unique(),
  idempotencyKey: varchar("idempotencyKey", { length: 64 }).notNull().unique(),
  snapshotId: varchar("snapshotId", { length: 80 }).notNull(),
  traceId: varchar("traceId", { length: 80 }),
  targetType: varchar("targetType", { length: 40 }).notNull(),
  targetId: varchar("targetId", { length: 128 }).notNull(),
  requestedAction: varchar("requestedAction", { length: 40 }).notNull(),
  expectedStateVersion: int("expectedStateVersion").notNull(),
  status: varchar("status", { length: 40 }).default("requested").notNull(),
  reasonCode: varchar("reasonCode", { length: 80 }),
  result: json("result"),
  requestedBy: int("requestedBy"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmperorExecutionStateSnapshot = typeof emperorExecutionStateSnapshots.$inferSelect;
export type EmperorExecutionRecoveryRequest = typeof emperorExecutionRecoveryRequests.$inferSelect;

// 对话任务的跨系统知识引用：仅保存授权后的摘要与来源定位，不复制原始知识正文。
export const emperorConversationKnowledgeRefs = mysqlTable("emperor_conversation_knowledge_refs", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  referenceId: varchar("referenceId", { length: 80 }).notNull().unique(),
  conversationId: varchar("conversationId", { length: 80 }).notNull(),
  sourceKind: mysqlEnum("sourceKind", ["emperor_memory", "amz_ops_skill"]).notNull(),
  sourceId: int("sourceId").notNull(),
  title: varchar("title", { length: 512 }).notNull(),
  contextSummary: text("contextSummary").notNull(),
  tags: json("tags"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmperorConversationKnowledgeRef = typeof emperorConversationKnowledgeRefs.$inferSelect;
export type InsertEmperorConversationKnowledgeRef = typeof emperorConversationKnowledgeRefs.$inferInsert;

// 模型提供商配置表（多 LLM 路由）
export const emperorModelProviders = mysqlTable("emperor_model_providers", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId"),
  slug: varchar("slug", { length: 64 }).unique().notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  provider: mysqlEnum("provider", ["manus_builtin", "openai", "deepseek", "anthropic", "custom"]).default("manus_builtin").notNull(),
  baseUrl: varchar("baseUrl", { length: 512 }),
  // API Key 加密存储（AES 或直接存环境变量引用）
  apiKeyRef: varchar("apiKeyRef", { length: 256 }),
  modelId: varchar("modelId", { length: 128 }).notNull(),
  displayName: varchar("displayName", { length: 128 }),
  isDefault: int("isDefault").default(0).notNull(),
  isActive: int("isActive").default(1).notNull(),
  capabilityTags: json("capabilityTags"),
  costPer1kInputTokens: decimal("costPer1kInputTokens", { precision: 12, scale: 6 }).default("0").notNull(),
  costPer1kOutputTokens: decimal("costPer1kOutputTokens", { precision: 12, scale: 6 }).default("0").notNull(),
  maxContextTokens: int("maxContextTokens").default(128000).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmperorModelProvider = typeof emperorModelProviders.$inferSelect;

export type InsertEmperorModelProvider = typeof emperorModelProviders.$inferInsert;
