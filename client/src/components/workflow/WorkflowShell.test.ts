import { describe, expect, it } from "vitest";
import { shouldRenderAgentRuntimePanel } from "./WorkflowShell";

describe("WorkflowShell业务托管运行控制", () => {
  it("业务页面关闭审核面板时不展示通用Agent推进控件", () => {
    expect(shouldRenderAgentRuntimePanel(false, true)).toBe(false);
    expect(shouldRenderAgentRuntimePanel(true, true)).toBe(true);
    expect(shouldRenderAgentRuntimePanel(true, false)).toBe(false);
  });
});
