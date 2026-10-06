import { describe, expect, it } from "vitest";
import { getRuntimeDraining, setRuntimeDraining } from "./runtimeHealth";

describe("运行时排空状态", () => {
  it("可在优雅停止开始时拒绝新的就绪探针", () => {
    setRuntimeDraining(false);
    expect(getRuntimeDraining()).toBe(false);
    setRuntimeDraining(true);
    expect(getRuntimeDraining()).toBe(true);
    setRuntimeDraining(false);
  });
});
