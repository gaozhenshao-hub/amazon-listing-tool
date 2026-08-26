import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "mysql2/promise";
import { canRepairFailedMigrationChecksum } from "../server/services/migrationPolicy.mjs";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const drizzleDir = join(rootDir, "drizzle");
const args = new Set(process.argv.slice(2));

const supplementalMigrations = [
  "0059_product_weekly_ops.sql",
  "0099_budget_tracking.sql",
  "0100_data_import_center.sql",
  "ad_tracking_migration.sql",
  "dsp_migration.sql",
  "ops_plan_migration.sql",
  "review_migration.sql",
  "video_script_migration.sql",
  "video_script_v2_migration.sql",
  "0101_image_workflow_step5_runs.sql",
  "0102_ai_jobs.sql",
  "0102a_emperor_core_registry.sql",
  "0103_emperor_agent_workflow.sql",
  "0104_emperor_agent_artifacts.sql",
  "0105_emperor_tool_runs.sql",
  "0106_ai_os_runtime_hardening.sql",
  "0107_ai_os_observability.sql",
  "0108_ai_job_queue_system.sql",
  "0109_agent_job_retry_alignment.sql",
  "0110_agent_artifacts_v1.sql",
  "0111_tool_gateway_governance_v2.sql",
  "0112_template_observability_qa.sql",
  "0112a_listing_image_support_tables.sql",
  "0112b_ops_ads_base_tables.sql",
  "0112c_ad_dsp_product_link.sql",
  "0113_database_governance_v1.sql",
  "0114_security_tenant_governance_v1.sql",
  "0115_data_lifecycle_artifacts_v1.sql",
  "0116_ops_workspace_isolation.sql",
  "0117_database_runtime_observability.sql",
  "0118_listing_competitor_human_review.sql",
  "0119_listing_competitor_emperor_skills.sql",
  "0120_image_workflow_outline_contract.sql",
  "0121_dev_information_summary_emperor_skills.sql",
  "0122_image_outline_reliability.sql",
  "0123_dev_information_summary_jobs.sql",
  "0124_product_development_workspace_security.sql",
  "0125_dev_stage_consistency.sql",
  "0126_product_analysis_stage_jobs.sql",
  "0127_product_development_analysis_agent.sql",
  "0128_artifact_source_of_truth.sql",
  "0129_business_skill_governance.sql",
  "0130_ai_operations_runtime.sql",
  "0131_dev_panorama_market_insights.sql",
  "0132_dev_project_progress_list.sql",
  "0133_dev_panorama_competitor_selection.sql",
  "0134_round4_business_agent_bindings.sql",
  "0135_video_job_checkpoint_binder.sql",
  "0136_business_job_binding_qa.sql",
  "0137_dev_project_operator_stage.sql",
  "0138_dev_project_landing_stage.sql",
  "0139_step4_image_version_records.sql",
  "0140_dev_panorama_versions.sql",
  "0141_dev_import_batches_base.sql",
  "0142_ops_asin_daily_inventory_planning.sql",
  "0143_ops_inventory_parent_asin_parameters.sql",
  "0144_ops_asin_lifecycle_status.sql",
  "0145_ops_inventory_product_cost_parameters.sql",
  "0146_ops_inventory_size_weight_parameters.sql",
  "0147_ops_monthly_financial_profits.sql",
  "0148_knowledge_workspace_scope.sql",
  "0149_dev_import_batch_governance.sql",
  "0150_step5_complete_result_longtext.sql",
    "0151_step5_segment_run_status.sql",
    "0152_dev_panorama_competitor_selection_persistence.sql",
    "0153_emperor_run_ledger_v2.sql",
    "0154_emperor_skill_quality_gates.sql",
    "0155_emperor_skill_feedback_rollouts.sql",
    "0156_emperor_harness_completion.sql",
    "0157_ops_external_sync_drafts.sql",
    "0158_emperor_conversation_task_manager.sql",
    "0159_emperor_conversation_planner_skill.sql",
    "0160_emperor_conversation_knowledge_refs.sql",
    "0161_ai_storage_objects_oss_provider.sql",
    "0162_emperor_conversation_planner_model_policy.sql",
    "0163_emperor_conversation_message_skill_run.sql",
    "0164_emperor_execution_recovery_lifecycle.sql",
    "0165_emperor_agent_run_recovery_state.sql",
    "0166_emperor_skill_run_recovery_state.sql",
    "0167_emperor_conversation_plan_recovery_state.sql",
    "0168_emperor_context_provenance_projection.sql",
    "0171_listing_bullet_step_skill_v3.sql",
    "0172_ops_asin_daily_source_provenance.sql",
    "0173_ops_asin_daily_source_provenance_indexes.sql",
    "0174_ops_asin_daily_source_provenance_indexes.sql",
    "0175_ops_lingxing_sync_schedules.sql",
  ];

const retiredMigrationFiles = new Set([
  "0000_aberrant_black_panther.sql",
  "0006_chubby_hellion.sql",
  "0007_wakeful_flatman.sql",
  "0008_superb_blue_shield.sql",
  // Historical fallback for ops_plan_migration.sql, not a subsequent migration.
  "ops_plan_migration_fix.sql",
]);

export function loadMigrationPlan() {
  const journal = JSON.parse(readFileSync(join(drizzleDir, "meta/_journal.json"), "utf8"));
  const files = [
    ...journal.entries.map((entry) => `${entry.tag}.sql`),
    ...supplementalMigrations,
  ];
  if (new Set(files).size !== files.length) throw new Error("Migration plan contains duplicate files");
  const unmanagedFiles = readdirSync(drizzleDir)
    .filter((fileName) => fileName.endsWith(".sql"))
    .filter((fileName) => !files.includes(fileName) && !retiredMigrationFiles.has(fileName));
  if (unmanagedFiles.length > 0) {
    throw new Error(`Migration files are not registered in the release plan: ${unmanagedFiles.sort().join(", ")}`);
  }
  return files.map((fileName, order) => {
    const filePath = join(drizzleDir, fileName);
    if (!existsSync(filePath)) throw new Error(`Migration file is missing: ${fileName}`);
    const sql = readFileSync(filePath, "utf8");
    return {
      order,
      fileName,
      filePath,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
      official: order < journal.entries.length,
    };
  });
}

function printPlan(plan) {
  for (const item of plan) {
    console.log(`${String(item.order + 1).padStart(3, "0")}  ${item.fileName}  ${item.checksum.slice(0, 12)}`);
  }
  console.log(`\n${plan.length} migrations; no database changes were made.`);
}

function assertExecutionEnvironment() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_MIGRATIONS !== "true") {
    throw new Error("Production migrations require ALLOW_PRODUCTION_MIGRATIONS=true in the one-off migration process");
  }
}

export async function ensureLedger(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS app_schema_migrations (
      migrationName varchar(255) NOT NULL,
      checksum varchar(64) NOT NULL,
      status enum('started','succeeded','failed','baselined') NOT NULL,
      executionId varchar(80),
      startedAt timestamp NULL,
      finishedAt timestamp NULL,
      error text,
      metadata json,
      createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (migrationName),
      KEY idx_app_schema_migrations_status (status, updatedAt)
    )
  `);
}

export async function importLegacyJournal(connection, plan) {
  let legacyRows = [];
  try {
    [legacyRows] = await connection.query("SELECT hash FROM __drizzle_migrations");
  } catch (error) {
    if (!/doesn't exist|unknown table/i.test(String(error?.message))) throw error;
  }
  const hashes = new Set(legacyRows.map((row) => String(row.hash)));
  for (const migration of plan.filter((item) => item.official && hashes.has(item.checksum))) {
    await connection.execute(
      `INSERT INTO app_schema_migrations
         (migrationName,checksum,status,executionId,startedAt,finishedAt,metadata)
       VALUES (?,?,'succeeded','legacy-drizzle-import',NOW(),NOW(),JSON_OBJECT('source','__drizzle_migrations'))
       ON DUPLICATE KEY UPDATE migrationName=migrationName`,
      [migration.fileName, migration.checksum],
    );
  }
}

export async function readLedger(connection) {
  const [rows] = await connection.query(
    "SELECT migrationName,checksum,status,error,updatedAt FROM app_schema_migrations ORDER BY createdAt",
  );
  return new Map(rows.map((row) => [String(row.migrationName), row]));
}

export async function prepareExecutableSql(connection, sql) {
  const ambiguousNoOpUpsertPattern =
    /INSERT\s+INTO\s+`?([A-Za-z0-9_$]+)`?[\s\S]*?ON\s+DUPLICATE\s+KEY\s+UPDATE\s+`updatedAt`\s*=\s*`updatedAt`/gi;
  const upsertSafeSql = sql.replace(ambiguousNoOpUpsertPattern, (statement, tableName) =>
    statement.replace(/`updatedAt`\s*=\s*`updatedAt`$/i, `\`updatedAt\` = \`${tableName}\`.\`updatedAt\``),
  );

  // Old tables use utf8mb4_unicode_ci while fresh MySQL 8 databases default to
  // utf8mb4_0900_ai_ci. Normalize the legacy artifact backfill comparison
  // without changing the checksum of an already published migration.
  const collationSafeSql = upsertSafeSql.replace(
    /ua\.`sourceRowId`\s*=\s*CAST\(aa\.`id`\s+AS\s+CHAR\)/gi,
    "CONVERT(ua.`sourceRowId` USING utf8mb4) COLLATE utf8mb4_unicode_ci = " +
      "CONVERT(CAST(aa.`id` AS CHAR) USING utf8mb4) COLLATE utf8mb4_unicode_ci",
  );

  const workspaceBackfillPattern =
    /UPDATE\s+`?([A-Za-z0-9_$]+)`?\s+t\s+LEFT\s+JOIN\s+`?users`?\s+u\b[\s\S]*?;/gi;
  const backfillMatches = [...collationSafeSql.matchAll(workspaceBackfillPattern)];
  let normalizedSql = "";
  let backfillCursor = 0;
  for (const match of backfillMatches) {
    const [statement, tableName] = match;
    const statementIndex = match.index ?? backfillCursor;
    let normalizedStatement = statement;
    if (/t\.`?userId`?/i.test(statement)) {
      const [rows] = await connection.execute(
        `SELECT column_name AS columnName
           FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = ? AND column_name IN ('userId','user_id')`,
        [tableName],
      );
      const columnNames = new Set(rows.map((row) => String(row.columnName)));
      if (!columnNames.has("userId") && columnNames.has("user_id")) {
        normalizedStatement = statement.replaceAll(/t\.`?userId`?/g, "t.`user_id`");
      }
    }
    normalizedSql += collationSafeSql.slice(backfillCursor, statementIndex) + normalizedStatement;
    backfillCursor = statementIndex + statement.length;
  }
  normalizedSql += collationSafeSql.slice(backfillCursor);

  const conditionalDropPattern =
    /ALTER\s+TABLE\s+`?([A-Za-z0-9_$]+)`?\s+DROP\s+COLUMN\s+IF\s+EXISTS\s+`?([A-Za-z0-9_$]+)`?\s*;/gi;
  const matches = [...normalizedSql.matchAll(conditionalDropPattern)];
  if (matches.length === 0) return normalizedSql.replaceAll("--> statement-breakpoint", "");

  let executableSql = "";
  let cursor = 0;
  for (const match of matches) {
    const [statement, tableName, columnName] = match;
    const [rows] = await connection.execute(
      `SELECT COUNT(*) AS columnCount
         FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
      [tableName, columnName],
    );
    const columnExists = Number(rows?.[0]?.columnCount ?? 0) > 0;
    const statementIndex = match.index ?? cursor;
    executableSql += normalizedSql.slice(cursor, statementIndex);
    executableSql += columnExists
      ? `ALTER TABLE \`${tableName}\` DROP COLUMN \`${columnName}\`;`
      : `-- skipped missing column ${tableName}.${columnName}`;
    cursor = statementIndex + statement.length;
  }
  executableSql += normalizedSql.slice(cursor);
  return executableSql.replaceAll("--> statement-breakpoint", "");
}

export async function baselineExistingSchema(connection, plan, options = {}) {
  const confirm = options.confirm ?? process.env.MIGRATION_BASELINE_CONFIRM;
  const allowProduction = options.allowProduction ?? process.env.ALLOW_PRODUCTION_MIGRATION_BASELINE === "true";
  const through = String(options.through ?? process.env.MIGRATION_BASELINE_THROUGH ?? "").trim();
  const reason = String(options.reason ?? process.env.MIGRATION_BASELINE_REASON ?? "").trim();
  if (confirm !== "I_UNDERSTAND_SCHEMA_BASELINE") {
    throw new Error("Baselining requires MIGRATION_BASELINE_CONFIRM=I_UNDERSTAND_SCHEMA_BASELINE");
  }
  if (process.env.NODE_ENV === "production" && !allowProduction) {
    throw new Error("Production baselining additionally requires ALLOW_PRODUCTION_MIGRATION_BASELINE=true");
  }
  if (!through || !reason) throw new Error("MIGRATION_BASELINE_THROUGH and MIGRATION_BASELINE_REASON are required");
  const endIndex = plan.findIndex((item) => item.fileName === through || item.fileName.replace(/\.sql$/, "") === through);
  if (endIndex < 0) throw new Error(`Unknown baseline migration: ${through}`);
  for (const migration of plan.slice(0, endIndex + 1)) {
    await connection.execute(
      `INSERT INTO app_schema_migrations
         (migrationName,checksum,status,executionId,startedAt,finishedAt,metadata)
       VALUES (?,?,'baselined',?,NOW(),NOW(),JSON_OBJECT('reason',?))
       ON DUPLICATE KEY UPDATE
         checksum=IF(status IN ('succeeded','baselined'),checksum,VALUES(checksum)),
         status=IF(status='succeeded','succeeded','baselined'),
         finishedAt=NOW(),error=NULL,metadata=VALUES(metadata)`,
      [migration.fileName, migration.checksum, `baseline-${randomUUID()}`, reason],
    );
  }
  console.log(`Baselined ${endIndex + 1} migrations through ${plan[endIndex].fileName}.`);
}

export async function applyMigrations(connection, plan, options = {}) {
  const retryFailed = options.retryFailed ?? args.has("--retry-failed");
  let ledger = await readLedger(connection);
  let applied = 0;
  for (const migration of plan) {
    const existing = ledger.get(migration.fileName);
    if (!canRepairFailedMigrationChecksum(existing, migration.checksum, retryFailed) && existing && existing.checksum !== migration.checksum) {
      throw new Error(`Checksum mismatch for ${migration.fileName}; applied migrations are immutable`);
    }
    if (existing?.status === "succeeded" || existing?.status === "baselined") continue;
    if (existing?.status === "started") {
      throw new Error(`${migration.fileName} has an interrupted migration record; inspect the schema and create a forward repair`);
    }
    if (existing?.status === "failed" && !retryFailed) {
      throw new Error(`${migration.fileName} previously failed; inspect the error and rerun with --retry-failed after repair`);
    }

    const executionId = `migration-${randomUUID()}`;
    await connection.execute(
      `INSERT INTO app_schema_migrations
         (migrationName,checksum,status,executionId,startedAt,finishedAt,error,metadata)
       VALUES (?,?,'started',?,NOW(),NULL,NULL,JSON_OBJECT('order',?))
       ON DUPLICATE KEY UPDATE checksum=VALUES(checksum),status='started',executionId=VALUES(executionId),startedAt=NOW(),finishedAt=NULL,error=NULL`,
      [migration.fileName, migration.checksum, executionId, migration.order],
    );
    try {
      const executableSql = await prepareExecutableSql(connection, migration.sql);
      await connection.query(executableSql);
      await connection.execute(
        "UPDATE app_schema_migrations SET status='succeeded',finishedAt=NOW(),error=NULL WHERE migrationName=? AND executionId=?",
        [migration.fileName, executionId],
      );
      console.log(`applied ${migration.fileName}`);
      applied += 1;
    } catch (error) {
      const message = String(error?.message || error).slice(0, 8000);
      await connection.execute(
        "UPDATE app_schema_migrations SET status='failed',finishedAt=NOW(),error=? WHERE migrationName=? AND executionId=?",
        [message, migration.fileName, executionId],
      );
      throw new Error(`Migration failed at ${migration.fileName}: ${message}`, { cause: error });
    }
    ledger = await readLedger(connection);
  }
  console.log(applied === 0 ? "Database is already up to date." : `Applied ${applied} migrations.`);
}

export async function acquireMigrationLock(
  connection,
  { lockName = "amazon_listing_tool_schema_migrations", timeoutSeconds = 30 } = {},
) {
  const [rows] = await connection.execute("SELECT GET_LOCK(?, ?) AS acquired", [lockName, timeoutSeconds]);
  if (Number(rows?.[0]?.acquired) !== 1) {
    throw new Error("Could not acquire the database migration advisory lock");
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await connection.execute("SELECT RELEASE_LOCK(?)", [lockName]);
  };
}

async function main() {
  const plan = loadMigrationPlan();
  if (args.has("--plan")) return printPlan(plan);
  assertExecutionEnvironment();

  const connection = await createConnection({
    uri: process.env.DATABASE_URL,
    multipleStatements: true,
  });
  let releaseLock;
  try {
    releaseLock = await acquireMigrationLock(connection);
    await ensureLedger(connection);
    await importLegacyJournal(connection, plan);
    if (args.has("--baseline")) await baselineExistingSchema(connection, plan);
    else await applyMigrations(connection, plan);
  } finally {
    if (releaseLock) await releaseLock().catch(() => undefined);
    await connection.end();
  }
}


if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
