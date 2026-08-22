import { createConnection } from "mysql2/promise";

if (!process.argv.includes("--confirm-existing-schema")) {
  throw new Error("Pass --confirm-existing-schema to reconcile the migration ledger");
}

const migrationName = process.env.MIGRATION_NAME || "0137_dev_project_operator_stage.sql";
const targets = {
  "0137_dev_project_operator_stage.sql": { table: "dev_project_progress", columns: ["operatorName"] },
  "0138_dev_project_landing_stage.sql": { table: "dev_project_progress", columns: ["landingStage"] },
  "0140_dev_panorama_versions.sql": { table: "dev_panorama_status", columns: ["currentVersionId"], requiredTable: "dev_panorama_versions" },
  "0145_ops_inventory_product_cost_parameters.sql": { table: "ops_inventory_planning_parameters", columns: ["product_cost", "estimated_first_leg_cost", "actual_first_leg_cost", "estimated_fba_fee", "actual_fba_fee", "selling_price", "currency"] },
  "0146_ops_inventory_size_weight_parameters.sql": { table: "ops_inventory_planning_parameters", columns: ["estimated_dimensions", "actual_dimensions", "estimated_weight", "actual_weight", "dimension_unit", "weight_unit"] },
  "0147_ops_monthly_financial_profits.sql": { table: "ops_monthly_financial_profits", columns: ["workspaceId", "id", "user_id", "parent_asin", "year_month", "financial_profit", "created_at", "updated_at"] },
  "0148_knowledge_workspace_scope.sql": { requirements: [["kb_product_innovations", "workspaceId"], ["kb_listing_copywriting", "workspaceId"], ["kb_operation_skills", "workspaceId"], ["kb_videos", "workspaceId"], ["kb_image_sets", "workspaceId"]] },
  "0149_dev_import_batch_governance.sql": { table: "dev_import_batches", columns: ["uploadedFileId", "fileType", "fileName", "fileHash", "totalRows", "validRows", "warningRows", "errorRows", "validationSummary", "normalizedRows", "appliedBy", "appliedAt", "rollbackReason", "rolledBackBy"], requiredTable: "dev_import_apply_snapshots" },
  "0151_step5_segment_run_status.sql": { table: "image_workflow_sessions", columns: ["step5RunSegments", "step5RunFailedGroup", "step5RunFailedModule"] },
  "0152_dev_panorama_competitor_selection_persistence.sql": { table: "dev_panorama_status", columns: ["selectedCompetitorAsins"] },
  "0156_emperor_harness_completion.sql": { table: "emperor_harness_review_requests", columns: ["reviewId", "workspaceId", "agentRunId", "nodeId", "requestType", "status"], requiredTables: ["emperor_harness_feedback_signals", "emperor_execution_presets", "emperor_parallel_plans", "emperor_parallel_branches"] },
};
const target = targets[migrationName];
if (!target) throw new Error(`Unsupported reconciliation target: ${migrationName}`);
const requirements = target.requirements || target.columns.map((column) => [target.table, column]);
const connection = await createConnection({ uri: process.env.DATABASE_URL });
try {
  const clauses = requirements.map(() => "(table_name = ? AND column_name = ?)").join(" OR ");
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS count
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND (${clauses})`,
    requirements.flat(),
  );
  if (Number(rows[0]?.count || 0) !== requirements.length) throw new Error(`Expected all required existing columns before reconciling ${migrationName}`);
  const requiredTables = target.requiredTables || (target.requiredTable ? [target.requiredTable] : []);
  for (const requiredTable of requiredTables) {
    const [tables] = await connection.execute(
      "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
      [requiredTable],
    );
    if (Number(tables[0]?.count || 0) !== 1) throw new Error(`Expected existing ${requiredTable} before reconciling ${migrationName}`);
  }
  await connection.execute(
    `UPDATE app_schema_migrations
        SET status='baselined', finishedAt=NOW(), error=NULL,
            metadata=JSON_OBJECT('reason','existing schema verified after duplicate-column failure','reconciledAt',UTC_TIMESTAMP())
      WHERE migrationName=? AND status='failed'`,
    [migrationName],
  );
  console.log(JSON.stringify({ migrationName, status: "baselined", verifiedColumns: requirements.map(([table, column]) => `${table}.${column}`), verifiedTables: requiredTables }));
} finally {
  await connection.end();
}
