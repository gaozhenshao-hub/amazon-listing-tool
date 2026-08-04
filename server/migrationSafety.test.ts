import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { repoPath } from "./testPaths";

describe("database migration safety", () => {
  it("disables legacy migration scripts that mutated or bypassed the journal", () => {
    for (const fileName of ["full_migrate.mjs", "run_all_migrations.mjs"]) {
      const source = fs.readFileSync(repoPath(fileName), "utf8");
      expect(source).toContain("已停用");
      expect(source).not.toMatch(/DELETE\s+FROM\s+__drizzle_migrations/i);
      expect(source).not.toMatch(/ER_DUP_FIELDNAME|ER_DUP_KEYNAME/);
    }
  });

  it("uses a locked, checksummed migration ledger and production opt-in", () => {
    const source = fs.readFileSync(repoPath("scripts/run-database-migrations.mjs"), "utf8");
    expect(source).toContain("GET_LOCK");
    expect(source).toContain("RELEASE_LOCK");
    expect(source).toContain("app_schema_migrations");
    expect(source).toContain("checksum");
    expect(source).toContain("ALLOW_PRODUCTION_MIGRATIONS");
    expect(source).toContain("status='failed'");
    expect(source).not.toMatch(/DELETE\s+FROM\s+__drizzle_migrations/i);
  });

  it("keeps the controlled migration plan complete and duplicate-free", async () => {
    const module = await import("../scripts/run-database-migrations.mjs");
    const plan = module.loadMigrationPlan();
    expect(plan.length).toBeGreaterThan(80);
    expect(new Set(plan.map((item: any) => item.fileName)).size).toBe(plan.length);
    expect(plan.at(-1)?.fileName).toBe("0120_image_workflow_outline_contract.sql");
    expect(plan.every((item: any) => /^[a-f0-9]{64}$/.test(item.checksum))).toBe(true);
  });

  it("rejects future SQL migrations that are omitted from the release plan", () => {
    const source = fs.readFileSync(repoPath("scripts/run-database-migrations.mjs"), "utf8");
    expect(source).toContain("Migration files are not registered in the release plan");
    expect(source).toContain("readdirSync(drizzleDir)");
  });
});
