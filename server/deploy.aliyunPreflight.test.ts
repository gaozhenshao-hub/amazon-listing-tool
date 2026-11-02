import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = readFileSync(resolve(process.cwd(), "deploy", "aliyun", "preflight.sh"), "utf8");

describe("阿里云部署前置检查脚本", () => {
  it("仅检查环境和编排，不执行迁移、容器启动、DNS或防火墙变更", () => {
    expect(script).toContain("docker compose -f \"${COMPOSE_FILE}\" --env-file \"${ENV_FILE}\" config");
    expect(script).toContain("required_keys=(");
    expect(script).toContain("AUTH_MODE=local");
    expect(script).toContain("STORAGE_PROVIDER=oss");
    expect(script).toContain("LLM_PROVIDER=external");
    expect(script).toContain("--check-health");
    expect(script).toContain("http://127.0.0.1:3000/health");
    expect(script).toContain("Existing web health endpoint is reachable");
    expect(script).not.toMatch(/docker compose[^\n]*(up|run|down|restart)/);
    expect(script).not.toContain("run-database-migrations");
    expect(script).not.toMatch(/\b(ufw|iptables|certbot|aliyun)\b/);
  });
});
