// Pure candidate planner. No filesystem, DB connection, DDL execution or seed.
const name = "ops_saihu_report_schedules",
  candidate = "config/integration/candidates/ops_saihu_report_schedules.sql";
const columns = [
  ...[
    ["plan_id", "char(36)"],
    ["workspace_id", "int"],
    ["user_id", "int"],
    ["revision", "int"],
    ["status", "varchar(20)"],
    ["next_run_at", "bigint"],
    ["body", "json"],
    ["body_hash", "char(64)"],
    ["created_at", "datetime(3)"],
    ["updated_at", "datetime(3)"],
  ].map(([name, type]) => ({
    name,
    type,
    nullable: name === "next_run_at",
    defaultValue: null,
    extra: "",
    generationExpression: "",
  })),
];
const indexes = [
  {
    name: "PRIMARY",
    unique: true,
    columns: ["plan_id"],
    prefixLengths: [null],
  },
  {
    name: "ops_saihu_report_plan_owner_idx",
    unique: false,
    columns: ["workspace_id", "user_id", "plan_id"],
    prefixLengths: [null, null, null],
  },
  {
    name: "ops_saihu_report_plan_due_idx",
    unique: false,
    columns: ["status", "next_run_at", "workspace_id", "plan_id"],
    prefixLengths: [null, null, null, null],
  },
];
export function saihuReportScheduleSchemaRequirements() {
  return structuredClone({
    name,
    engine: "InnoDB",
    collation: "utf8mb4_unicode_ci",
    columns,
    indexes,
    triggers: [],
    constraints: [{ name: "PRIMARY", type: "PRIMARY KEY" }],
  });
}
export function planSaihuReportScheduleSchema(snapshot) {
  const fail = code => {
    throw new Error(`SAIHU_REPORT_SCHEDULE_PLAN_${code}`);
  };
  if (
    !snapshot ||
    snapshot.complete !== true ||
    snapshot.databaseVerified !== true ||
    snapshot.table?.name !== name ||
    typeof snapshot.table.exists !== "boolean"
  )
    fail("INCOMPLETE");
  const table = snapshot.table;
  if (table.exists) {
    const expected = saihuReportScheduleSchemaRequirements();
    if (
      table.engine !== expected.engine ||
      table.collation !== expected.collation ||
      JSON.stringify(table.columns) !== JSON.stringify(expected.columns) ||
      JSON.stringify(table.indexes) !== JSON.stringify(expected.indexes) ||
      JSON.stringify(table.triggers) !== "[]" ||
      JSON.stringify(table.constraints) !== JSON.stringify(expected.constraints)
    )
      fail("INCOMPATIBLE_NO_AUTOREPAIR");
  }
  return {
    candidate,
    state: table.exists ? "structurally_ready" : "candidate_create_required",
    createCandidate: table.exists ? null : candidate,
    executable: false,
    productionApproved: false,
    registerMigration: false,
    seed: false,
    activate: false,
    retireLingxing: false,
    remaining: [
      "Physical snapshot provenance and source/audit schema admission",
      "Source contract and explicitly approved workspace/policies",
      "Complete history-window indexes, fair discovery and cross-process execution lock (next slice)",
      "Real DB concurrency, backup/rollback, deployment and business acceptance",
    ],
  };
}
