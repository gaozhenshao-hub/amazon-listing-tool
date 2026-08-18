import { describe, expect, it } from "vitest";
import { claimLazyRecovery } from "./lazyRecovery";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } as Storage;
}

describe("懒加载模块恢复", () => {
  it("首次模块加载失败时允许一次刷新，第二次失败时清理标记避免循环刷新", () => {
    const storage = createStorage();
    const key = "lazy-recovery:image-workflow";

    expect(claimLazyRecovery(storage, key)).toBe(true);
    expect(storage.getItem(key)).toBe("1");
    expect(claimLazyRecovery(storage, key)).toBe(false);
    expect(storage.getItem(key)).toBeNull();
  });
});
