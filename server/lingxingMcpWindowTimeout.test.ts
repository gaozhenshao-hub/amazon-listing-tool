import { describe, expect, it } from "vitest";
import { withMcpStoreDateWindowTimeout } from "./routers/lingxingSync";

describe("领星店铺日期窗口超时", () => {
  it("在MCP调用未返回时转为可记录的窗口超时", async () => {
    await expect(withMcpStoreDateWindowTimeout(new Promise<never>(() => undefined), "7392|2026-04-23|0", 5))
      .rejects.toThrow("MCP店铺日期窗口超时：7392|2026-04-23|0");
  });

  it("正常返回不会被超时保护改变", async () => {
    await expect(withMcpStoreDateWindowTimeout(Promise.resolve({ ok: true }), "7392|2026-04-23|0", 50))
      .resolves.toEqual({ ok: true });
  });
});
