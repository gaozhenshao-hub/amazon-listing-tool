import { describe, expect, it } from "vitest";
import { directTaskPartnerIds } from "./productTaskPartners";

describe("current shared-product task visibility", () => {
  it("includes direct co-owners once, without a transitive grant", () => {
    expect(directTaskPartnerIds(3, [{ ownerIds: [3, 6] }, { ownerIds: [6, 9] }, { ownerIds: [3, 6] }, { ownerIds: [] }])).toEqual([3, 6]);
  });
  it("does not infer ownership for unassigned products or other teams", () => {
    expect(directTaskPartnerIds(3, [{ ownerIds: [] }, { ownerIds: [9, 10] }])).toEqual([3]);
  });
  it("rejects invalid numeric ownership evidence", () => {
    expect(() => directTaskPartnerIds(3, [{ ownerIds: [3, -1] }])).toThrow("TASK_PARTNER_ID_INVALID");
  });
});
