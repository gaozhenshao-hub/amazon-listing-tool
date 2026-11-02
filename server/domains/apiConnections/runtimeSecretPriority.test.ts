import { describe, expect, it, vi } from "vitest";

vi.mock("../ai_os/services/toolGateway", () => ({
  resolveToolSecretReference: vi.fn(async () => "managed-value"),
}));

import { createConfiguredApifyAmazonProvider } from "../acquisition/apifyProvider";
import { createConfiguredApifyAmazonMonitorProvider } from "../acquisition/apifyMonitorProvider";
import { resolveToolSecretReference } from "../ai_os/services/toolGateway";

describe("受控连接Secret运行时优先级", () => {
  it("统一采集与监控Adapter均只在服务器端解析同一受控Apify Secret引用", async () => {
    const acquisition = await createConfiguredApifyAmazonProvider();
    const monitor = await createConfiguredApifyAmazonMonitorProvider();
    expect(resolveToolSecretReference).toHaveBeenCalledWith("secret://integration.apify.api_token", null);
    expect(acquisition).toBeTruthy();
    expect(monitor).toBeTruthy();
  });
});
