import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../deploy/aliyun/", import.meta.url);
const read = (name: string) => readFile(new URL(name, root), "utf8");

describe("Aliyun low-cost single-node deployment package", () => {
  it("keeps MySQL on the private Compose network with durable storage and health gating", async () => {
    const compose = await read("compose.yaml");

    expect(compose).toContain("mysql:");
    expect(compose).toContain("mysql:8.4");
    expect(compose).toContain("mysql-data:/var/lib/mysql");
    expect(compose).toContain("condition: service_healthy");
    const mysqlService = compose.match(/  mysql:\n([\s\S]*?)\n  web:/)?.[1] || "";
    expect(mysqlService).not.toContain("ports:");
  });

  it("provides an OSS-encrypted backup tool and an explicitly confirmed restore path", async () => {
    const [compose, backup, restore] = await Promise.all([
      read("compose.yaml"),
      read("scripts/backup-mysql.sh"),
      read("scripts/restore-mysql.sh"),
    ]);

    expect(compose).toContain("db-backup:");
    expect(compose).toContain("profiles: [\"tools\"]");
    expect(backup).toContain("openssl enc -aes-256-cbc -pbkdf2");
    expect(backup).toContain("aws s3 cp");
    expect(backup).toContain("BACKUP_RETENTION_DAYS");
    expect(restore).toContain("--confirm-restore");
    expect(restore).toContain("DROP DATABASE IF EXISTS");
    expect(restore).toContain("--user=root");
    expect(compose).toContain('MYSQL_ROOT_HOST: "%"');
  });

  it("requires the application to target the internal MySQL service and supplies backup configuration", async () => {
    const [env, preflight, readme] = await Promise.all([
      read("environment.template.txt"),
      read("preflight.sh"),
      read("README.md"),
    ]);

    expect(env).toContain("DATABASE_URL=mysql://amz_app:CHANGE_ME_URL_ENCODED_APP_PASSWORD@mysql:3306/amz_fullchain");
    expect(env).toContain("S3_ENDPOINT=https://oss-cn-qingdao-internal.aliyuncs.com");
    expect(env).toContain("S3_PUBLIC_ENDPOINT=https://oss-cn-qingdao.aliyuncs.com");
    expect(env).toContain("TOOL_SECRET_KEY=GENERATE_A_SEPARATE_LONG_TOOL_SECRET");
    expect(env).toContain("SCHEDULED_TASK_SECRET=GENERATE_A_SCHEDULED_TASK_SECRET");
    expect(env).toContain("BACKUP_ENCRYPTION_KEY=");
    expect(preflight).toContain("DATABASE_URL must target the private mysql Compose service");
    expect(preflight).toContain("TOOL_SECRET_KEY must contain at least 32 characters");
    expect(preflight).toContain("MySQL backup script must be executable");
    expect(readme).toContain("-e ALLOW_PRODUCTION_MIGRATIONS=true web node scripts/run-database-migrations.mjs");
    expect(env).not.toContain("ALLOW_PRODUCTION_MIGRATIONS=true");
  });
});
