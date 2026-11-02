import { describe, expect, it } from "vitest";
import { invokeEmperorTool } from "./domains/ai_os/services/toolGateway/executors";

const hasLingxingKey = Boolean(process.env.LINGXING_MCP_KEY);
const runLiveMcpTest = hasLingxingKey && process.env.RUN_LINGXING_MCP_E2E === "true";

describe("领星官方MCP Tool Gateway端到端只读验收", () => {
  it.runIf(runLiveMcpTest)("通过受治理Adapter读取店铺范围目录并保留Tool Run审计", async () => {
    const result = await invokeEmperorTool({
      toolSlug: "internal.lingxing.read",
      params: {
        capability: "get_my_sids",
        arguments: {},
      },
      userId: 1,
      userRole: "super_admin",
      workspaceId: 1,
    });

    expect(result.success).toBe(true);
    expect(result.metadata.toolRunId).toMatch(/^tool_/);
    expect(result.metadata.status).toBe(200);
  }, 45_000);
});
