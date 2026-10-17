import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ db: {} as { transaction?: ReturnType<typeof vi.fn> } }));
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: () => mocks.db }));
beforeEach(() => { vi.resetModules(); mocks.db = {}; vi.stubEnv("DATABASE_URL", "mysql://synthetic-never-connected/test"); });
afterEach(() => vi.unstubAllEnvs());
describe("required transaction admission", () => {
  it("never invokes capture admission against a nontransactional executor", async () => {
    const { withDbTransaction } = await import("./dbClient"); const callback = vi.fn();
    await expect(withDbTransaction("capture", callback, { required: true })).rejects.toThrow("real database transaction required");
    expect(callback).not.toHaveBeenCalled();
  });
  it("passes the real transaction executor to the entire admission callback", async () => {
    const tx = { tag: "transaction" }; mocks.db.transaction = vi.fn(async cb => cb(tx));
    const { withDbTransaction } = await import("./dbClient"); const callback = vi.fn().mockResolvedValue("saved");
    await expect(withDbTransaction("capture", callback, { required: true })).resolves.toBe("saved"); expect(callback).toHaveBeenCalledWith(tx);
  });
  it("does not silently change legacy opt-out callers", async () => {
    const { withDbTransaction } = await import("./dbClient"); const callback = vi.fn();
    await withDbTransaction("legacy", callback); expect(callback).toHaveBeenCalledWith(mocks.db);
  });
});
