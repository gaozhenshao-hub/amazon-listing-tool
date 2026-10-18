import assert from "node:assert/strict";
import test from "node:test";
import {
  planSaihuReportScheduleSchema,
  saihuReportScheduleSchemaRequirements,
} from "./saihuReportScheduleSchemaPlan.mjs";
test("absent candidate remains non-executable, unregistered and never seeded/enabled", () => {
  const r = planSaihuReportScheduleSchema({
    complete: true,
    databaseVerified: true,
    table: { name: "ops_saihu_report_schedules", exists: false },
  });
  assert.equal(r.state, "candidate_create_required");
  for (const k of [
    "executable",
    "productionApproved",
    "registerMigration",
    "seed",
    "activate",
    "retireLingxing",
  ])
    assert.equal(r[k], false);
});
test("exact complete metadata is required; drift is not silently auto-repaired", () => {
  const table = { ...saihuReportScheduleSchemaRequirements(), exists: true };
  assert.equal(
    planSaihuReportScheduleSchema({
      complete: true,
      databaseVerified: true,
      table,
    }).state,
    "structurally_ready"
  );
  for (const patch of [
    { engine: "MyISAM" },
    { indexes: [] },
    { triggers: ["unreviewed"] },
    { columns: table.columns.slice(1) },
  ])
    assert.throws(
      () =>
        planSaihuReportScheduleSchema({
          complete: true,
          databaseVerified: true,
          table: { ...table, ...patch },
        }),
      /INCOMPATIBLE_NO_AUTOREPAIR/
    );
  assert.throws(
    () =>
      planSaihuReportScheduleSchema({
        complete: false,
        databaseVerified: true,
        table,
      }),
    /INCOMPLETE/
  );
});
