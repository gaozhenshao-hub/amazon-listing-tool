import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectQuery = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  selectQuery.from.mockReturnValue(selectQuery);
  selectQuery.where.mockReturnValue(selectQuery);

  const updateQuery = {
    set: vi.fn(),
    where: vi.fn(),
  };
  updateQuery.set.mockReturnValue(updateQuery);

  const db = {
    select: vi.fn(() => selectQuery),
    update: vi.fn(() => updateQuery),
  };

  return { db, selectQuery, updateQuery };
});

vi.mock("./repositories/dbClient", () => ({
  getDb: vi.fn(async () => mocks.db),
}));

// Field validation is independent of project authorization. Use the base protected
// procedure to keep this regression test hermetic and avoid any real database access.
vi.mock("./domains/product_development/security/productDevelopmentProcedure", async () => {
  const { protectedProcedure } = await import("./_core/trpc");
  return { protectedProcedure };
});

import { devPanoramaRouter } from "./routers/devPanorama";

const caller = devPanoramaRouter.createCaller({
  user: { id: 1, role: "admin" } as any,
  workspaceId: 1,
  req: {} as any,
  res: {} as any,
});

describe("devPanorama.updateProductField field allowlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectQuery.limit.mockResolvedValue([{ projectId: 42 }]);
    mocks.updateQuery.where.mockResolvedValue(undefined);
  });

  it.each(["projectId", "workspaceId", "id"]) (
    "rejects protected %s before issuing an update",
    async (field) => {
      await expect(caller.updateProductField({
        productId: 7,
        field: field as any,
        value: 999,
      })).rejects.toMatchObject({ code: "BAD_REQUEST" });

      expect(mocks.db.select).not.toHaveBeenCalled();
      expect(mocks.db.update).not.toHaveBeenCalled();
      expect(mocks.updateQuery.set).not.toHaveBeenCalled();
    },
  );

  it.each([
    { field: "monthlySales", value: "100" },
    { field: "sku", value: "x".repeat(101) },
    { field: "monthlySalesHistory", value: "not-json" },
  ] as const)("rejects an invalid value for $field before issuing an update", async ({ field, value }) => {
    await expect(caller.updateProductField({
      productId: 7,
      field,
      value,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(mocks.db.select).not.toHaveBeenCalled();
    expect(mocks.db.update).not.toHaveBeenCalled();
    expect(mocks.updateQuery.set).not.toHaveBeenCalled();
  });

  it("updates a currently editable business field and invalidates panorama confirmation", async () => {
    await expect(caller.updateProductField({
      productId: 7,
      field: "title",
      value: "Updated product title",
    })).resolves.toEqual({ success: true });

    expect(mocks.db.update).toHaveBeenCalledTimes(2);
    expect(mocks.updateQuery.set).toHaveBeenNthCalledWith(1, { title: "Updated product title" });
    expect(mocks.updateQuery.set).toHaveBeenNthCalledWith(2, { confirmed: 0, confirmedAt: null });
  });
});
