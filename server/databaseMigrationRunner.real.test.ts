import { createHash, randomUUID } from "node:crypto";
import { createConnection, type Connection } from "mysql2/promise";
import { beforeAll, describe, expect, it } from "vitest";

let runner: any;

beforeAll(async () => {
  runner = await import("../scripts/run-database-migrations.mjs");
});

function migration(fileName: string, sql: string, order: number) {
  return {
    fileName,
    filePath: fileName,
    sql,
    order,
    official: false,
    checksum: createHash("sha256").update(sql).digest("hex"),
  };
}

async function withSandbox(run: (connection: Connection, connectAgain: () => Promise<Connection>) => Promise<void>) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for real migration runner tests");
  const databaseName = `migration_runner_${randomUUID().replaceAll("-", "")}`;
  const admin = await createConnection({ uri: process.env.DATABASE_URL, multipleStatements: true });
  const connections: Connection[] = [];
  try {
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    const connectAgain = async () => {
      const connection = await createConnection({ uri: process.env.DATABASE_URL, multipleStatements: true });
      await connection.changeUser({ database: databaseName });
      connections.push(connection);
      return connection;
    };
    await run(await connectAgain(), connectAgain);
  } finally {
    await Promise.all(connections.map((connection) => connection.end().catch(() => undefined)));
    await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    await admin.end();
  }
}

describe("real MySQL migration runner", () => {
  it("migrates an empty database and is idempotent", async () => withSandbox(async (connection) => {
    const plan = [migration("9000_create_widget.sql", "CREATE TABLE widget (id int NOT NULL PRIMARY KEY)", 0)];
    await runner.ensureLedger(connection);
    await runner.applyMigrations(connection, plan);
    await runner.applyMigrations(connection, plan);

    const [tables] = await connection.query("SHOW TABLES LIKE 'widget'");
    expect(tables).toHaveLength(1);
    expect((await runner.readLedger(connection)).get(plan[0].fileName)?.status).toBe("succeeded");
  }));

  it("applies an upgrade after an earlier release", async () => withSandbox(async (connection) => {
    const first = migration("9001_create_release.sql", "CREATE TABLE release_test (id int NOT NULL PRIMARY KEY)", 0);
    const second = migration("9002_upgrade_release.sql", "ALTER TABLE release_test ADD COLUMN label varchar(64) NULL", 1);
    await runner.ensureLedger(connection);
    await runner.applyMigrations(connection, [first]);
    await runner.applyMigrations(connection, [first, second]);

    const [columns] = await connection.query("SHOW COLUMNS FROM release_test LIKE 'label'");
    expect(columns).toHaveLength(1);
  }));

  it("records failed migrations and refuses an implicit retry", async () => withSandbox(async (connection) => {
    const broken = migration("9003_broken.sql", "CREATE TABL broken (id int)", 0);
    await runner.ensureLedger(connection);
    await expect(runner.applyMigrations(connection, [broken])).rejects.toThrow("Migration failed");
    expect((await runner.readLedger(connection)).get(broken.fileName)?.status).toBe("failed");
    await expect(runner.applyMigrations(connection, [broken])).rejects.toThrow("previously failed");
  }));

  it("rejects checksum drift for an applied migration", async () => withSandbox(async (connection) => {
    const original = migration("9004_immutable.sql", "CREATE TABLE immutable_test (id int)", 0);
    const changed = migration("9004_immutable.sql", "CREATE TABLE immutable_test (id bigint)", 0);
    await runner.ensureLedger(connection);
    await runner.applyMigrations(connection, [original]);
    await expect(runner.applyMigrations(connection, [changed])).rejects.toThrow("Checksum mismatch");
  }));

  it("baselines an existing release and only executes later migrations", async () => withSandbox(async (connection) => {
    const baselined = migration("9005_existing.sql", "CREATE TABLE should_not_run (id int)", 0);
    const next = migration("9006_next.sql", "CREATE TABLE next_release (id int)", 1);
    const plan = [baselined, next];
    await runner.ensureLedger(connection);
    await runner.baselineExistingSchema(connection, plan, {
      confirm: "I_UNDERSTAND_SCHEMA_BASELINE",
      through: baselined.fileName,
      reason: "migration runner regression test",
    });
    await runner.applyMigrations(connection, plan);

    const [skipped] = await connection.query("SHOW TABLES LIKE 'should_not_run'");
    const [created] = await connection.query("SHOW TABLES LIKE 'next_release'");
    expect(skipped).toHaveLength(0);
    expect(created).toHaveLength(1);
    expect((await runner.readLedger(connection)).get(baselined.fileName)?.status).toBe("baselined");
  }));

  it("serializes concurrent migration processes with an advisory lock", async () => withSandbox(async (connection, connectAgain) => {
    const secondConnection = await connectAgain();
    const lockName = `migration_test_${randomUUID()}`;
    const release = await runner.acquireMigrationLock(connection, { lockName, timeoutSeconds: 0 });
    await expect(runner.acquireMigrationLock(secondConnection, { lockName, timeoutSeconds: 0 }))
      .rejects.toThrow("Could not acquire");
    await release();
    const secondRelease = await runner.acquireMigrationLock(secondConnection, { lockName, timeoutSeconds: 0 });
    await secondRelease();
  }));
});
