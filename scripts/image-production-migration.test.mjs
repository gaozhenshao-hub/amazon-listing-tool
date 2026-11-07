import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { loadImageProductionMigrationPlan } from "./run-database-migrations.mjs";
test("image production release selects only 0333 without touching historical migrations", () => {
  const plan = loadImageProductionMigrationPlan();
  assert.equal(plan.length, 1);
  assert.equal(plan[0].fileName, "0333_listing_image_production.sql");
});
test("dedicated production plan is available without a database connection", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/run-database-migrations.mjs",
      "--apply-image-production",
      "--plan",
    ],
    { encoding: "utf8", env: { ...process.env, DATABASE_URL: "" } }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0333_listing_image_production/);
  assert.doesNotMatch(result.stdout, /0232_design_studio/);
});
test("cannot accidentally combine the new release with another dedicated migration", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/run-database-migrations.mjs",
      "--apply-image-production",
      "--apply-image-plan-copy",
      "--plan",
    ],
    { encoding: "utf8", env: { ...process.env, DATABASE_URL: "" } }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exactly one dedicated/);
});
