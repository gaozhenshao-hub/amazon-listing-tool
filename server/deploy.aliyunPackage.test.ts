import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const deploymentDir = resolve(process.cwd(), "deploy", "aliyun");
const readDeploymentFile = (name: string) => readFileSync(resolve(deploymentDir, name), "utf8");

describe("阿里云独立部署包", () => {
  it("Docker镜像构建当前应用，并以生产Web入口运行", () => {
    const dockerfile = readDeploymentFile("Dockerfile");

    expect(dockerfile).toContain("FROM node:22-bookworm-slim AS build");
    expect(dockerfile).toContain("RUN pnpm run build && pnpm prune --prod");
    expect(dockerfile).toContain('CMD ["node", "dist/index.js"]');
    expect(dockerfile).not.toContain("BUILT_IN_FORGE_API_KEY=");
  });

  it("Compose编排Web、AI Worker和Scheduler，并且仅本机暴露Web端口", () => {
    const compose = readDeploymentFile("compose.yaml");

    expect(compose).toContain("web:");
    expect(compose).toContain('command: ["node", "dist/index.js"]');
    expect(compose).toContain("ai-worker:");
    expect(compose).toContain('command: ["node", "dist/aiWorker.js"]');
    expect(compose).toContain("scheduler:");
    expect(compose).toContain('command: ["node", "dist/scheduler.js"]');
    expect(compose).toContain('"127.0.0.1:3000:3000"');
  });

  it("环境模板启用本地认证、OSS和外部模型网关，且只含占位值", () => {
    const template = readDeploymentFile("environment.template.txt");

    expect(template).toContain("AUTH_MODE=local");
    expect(template).toContain("VITE_AUTH_MODE=local");
    expect(template).toContain("STORAGE_PROVIDER=oss");
    expect(template).toContain("LLM_PROVIDER=external");
    expect(template).toContain("REPLACE_WITH_RAM_ACCESS_KEY_ID");
    expect(template).toContain("REPLACE_WITH_MODEL_GATEWAY_KEY");
    expect(template).not.toMatch(/sk-[a-zA-Z0-9]{16,}/);
  });

  it("Nginx仅将公网HTTP请求反向代理给本机Web服务", () => {
    const nginx = readDeploymentFile("nginx.conf");

    expect(nginx).toContain("proxy_pass http://127.0.0.1:3000");
    expect(nginx).toContain("client_max_body_size 100m");
    expect(nginx).not.toContain("0.0.0.0:3000");
  });
});
