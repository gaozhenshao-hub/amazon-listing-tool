import { getTableConfig, type AnyMySqlTable } from "drizzle-orm/mysql-core";
import { aiJobs, aiArtifacts } from "../../../../drizzle/schema/ai_os";
import { imageWorkflowSessions } from "../../../../drizzle/schema/image";
import { assertAssistantRuleConfirmationJournalSchema } from "../../ai_os/repositories/assistantRuleConfirmationJournal";
import { imagePlanningRows as rows, imagePlanningFail as fail, type ImagePlanningExecutor } from "./imagePlanningSource";

/** Existing tables only. No bootstrap, repair, DDL or permissive fallback. */
export async function assertImagePlanningSchema(tx: ImagePlanningExecutor): Promise<void> {
  const writes = [aiJobs, aiArtifacts, imageWorkflowSessions] as AnyMySqlTable[];
  const names = [...writes.map(table => getTableConfig(table).name), "projects", "users", "workspaces", "workspace_memberships", "role_permissions", "security_access_policies",
    "image_workflow_version_scopes", "image_workflow_stage_snapshots", "image_workflow_snapshot_state_events",
    "projectFiles", "competitorAnalyses", "competitorComparisonReports", "keywords", "listings", "reviewAggregations", "image_workflow_step0_artifacts"];
  const tables = await rows(tx, `SELECT TABLE_NAME AS name,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${names.map(() => "?").join(",")}) LIMIT ${names.length + 1}`, names, names.length);
  if (tables.length !== names.length || new Set(tables.map(row => row.name)).size !== names.length || tables.some(row => !names.includes(String(row.name)) || row.engine !== "InnoDB")) fail("SCHEMA_UNAVAILABLE");
  const expectedKeys: Record<string, string[][]> = { ai_jobs: [["id"], ["runId"]], ai_artifacts: [["id"], ["artifactId"]], image_workflow_sessions: [["id"]] };
  for (const table of writes) {
    const config = getTableConfig(table), columns = await rows(tx,
      "SELECT COLUMN_NAME AS name,COLUMN_TYPE AS columnType,IS_NULLABLE AS nullable,EXTRA AS extra,COLUMN_DEFAULT AS defaultValue FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION LIMIT 201", [config.name], 200);
    const normalize = (value: string) => value.toLowerCase().replace(/int\(\d+\)/gu, "int").replace(/,\s+/gu, ",");
    if (columns.length !== config.columns.length || new Set(columns.map(row => row.name)).size !== columns.length) fail("SCHEMA_UNAVAILABLE");
    for (const column of config.columns) {
      const actual = columns.find(row => row.name === column.name);
      if (!actual || typeof actual.columnType !== "string" || normalize(actual.columnType) !== normalize(column.getSQLType()) || actual.nullable !== (column.notNull ? "NO" : "YES")
        || typeof actual.extra !== "string" || /(?:virtual|stored)\s+generated/iu.test(actual.extra)) fail("SCHEMA_UNAVAILABLE");
      if (column.name === "id" && actual.extra !== "auto_increment" || !["id", "createdAt", "updatedAt"].includes(column.name) && actual.extra !== "") fail("SCHEMA_UNAVAILABLE");
      if (["createdAt", "updatedAt"].includes(column.name) && !/^current_timestamp(?:\(\d*\))?$/iu.test(String(actual.defaultValue))) fail("SCHEMA_UNAVAILABLE");
    }
    const indexes = await rows(tx, "SELECT INDEX_NAME AS name,NON_UNIQUE AS nonUnique,SEQ_IN_INDEX AS sequence,COLUMN_NAME AS columnName,SUB_PART AS subPart FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX LIMIT 257", [config.name], 256);
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const row of indexes) {
      if (typeof row.name !== "string" || ![0, 1].includes(Number(row.nonUnique)) || !Number.isSafeInteger(Number(row.sequence)) || Number(row.sequence) < 1 || row.subPart !== null || typeof row.columnName !== "string") fail("SCHEMA_UNAVAILABLE");
      groups.set(row.name, [...(groups.get(row.name) ?? []), row]);
    }
    const unique = [...groups.values()].filter(group => Number(group[0].nonUnique) === 0).map(group => {
      if (group.some((row, index) => Number(row.sequence) !== index + 1 || Number(row.nonUnique) !== 0)) fail("SCHEMA_UNAVAILABLE");
      return group.map(row => row.columnName);
    });
    if (unique.length !== expectedKeys[config.name].length || expectedKeys[config.name].some(key => !unique.some(actual => JSON.stringify(actual) === JSON.stringify(key)))) fail("SCHEMA_UNAVAILABLE");
  }
  await assertAssistantRuleConfirmationJournalSchema(tx);
  const triggers = await rows(tx, "SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE IN ('ai_jobs','ai_artifacts','image_workflow_sessions','security_audit_logs') LIMIT 1", [], 1);
  if (triggers.length) fail("SCHEMA_UNAVAILABLE");
}
