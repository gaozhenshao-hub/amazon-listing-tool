import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { kbImageSets } from "../drizzle/schema";

const state = vi.hoisted(() => ({
  origin: "unified_amazon_acquisition", visibility: "private", userId: 3,
  projections: [] as Array<Record<string, unknown>>, conditions: [] as unknown[],
}));
vi.mock("./repositories/dbClient", () => ({ getDb: async () => ({
  select(projection: Record<string, unknown>) {
    state.projections.push(projection);
    return { from(table: Table) { return { where(condition: SQL) {
      state.conditions.push(condition);
      return { orderBy: async () => {
        const raw: Record<string, unknown> = getTableName(table) === "kb_image_sets"
          ? { id: 10, userId: state.userId, workspaceId: 7, asin: "B012345678", visibility: state.visibility, origin_instance_id: state.origin,
            remote_id: 41, sync_version: 2, status: "confirmed" }
          : { id: 20, imageSetId: 10, imageUrl: "storage://s3/acquisition/7/snapshots/21/main/original.png", imagePosition: "main", positionIndex: 0 };
        // Return only columns selected by the real repository. A hand-built
        // full-row mock would conceal a missing workspaceId projection.
        return [Object.fromEntries(Object.entries(projection).map(([key, field]) => {
          const columnName = field && typeof field === "object" && "name" in field ? String(field.name) : null;
          return [key, columnName === null ? null : raw[columnName] ?? null];
        }))];
      } };
    } }; } };
  },
}) }));
import { listImageSetsWithThumbnails } from "./kbDb";
import { createManualKbImageDeliveryGate } from "./domains/acquisition/kbManualImageDelivery";

beforeEach(() => { state.origin = "unified_amazon_acquisition"; state.visibility = "private"; state.userId = 3; state.projections.length = 0; state.conditions.length = 0; });
describe("real KB list projection retains server workspace identity", () => {
  it.each(["unified_amazon_acquisition", "manual_acquisition_review_v1"])("%s exposes the actual selected workspace column and reaches its correct delivery branch", async origin => {
    state.origin = origin;
    const [set] = await listImageSetsWithThumbnails(3, 7, "mine");
    expect(state.projections[0].workspaceId).toBe(kbImageSets.workspaceId);
    expect(set.workspaceId).toBe(7); expect(set.thumbnailImages).toHaveLength(1);
    const coverage = vi.fn(async () => ({ mode: "manual_revision" as const, status: "verified" as const, revisionVersion: 2, confirmedSnapshotId: 41, kept: 1, excluded: 0, total: 1 }));
    const images = vi.fn(async () => set.thumbnailImages.map(image => ({ ...image, aplusModuleType: null, aplusModuleClass: null })));
    const gate = createManualKbImageDeliveryGate({ userId: 3, workspaceId: 7 }, { images, coverage, database: vi.fn(async () => ({})) } as unknown as Parameters<typeof createManualKbImageDeliveryGate>[1]);
    expect((await gate.forSet(set, set.thumbnailImages)).images).toEqual(set.thumbnailImages);
    expect(coverage).toHaveBeenCalledTimes(origin === "manual_acquisition_review_v1" ? 1 : 0);
    const query = new MySqlDialect().sqlToQuery(state.conditions[0] as SQL);
    expect(query.sql).toContain("`kb_image_sets`.`workspaceId` = ?"); expect(query.sql).toContain("`kb_image_sets`.`userId` = ?"); expect(query.params).toEqual([7, 3]);
  });
  it("keeps shared-set scope predicates and returns the database owner's identity, not the caller's", async () => {
    state.visibility = "team"; state.userId = 4;
    const [set] = await listImageSetsWithThumbnails(3, 7, "shared");
    expect(set.userId).toBe(4); expect(set.workspaceId).toBe(7);
    const query = new MySqlDialect().sqlToQuery(state.conditions[0] as SQL);
    expect(query.sql).toContain("`kb_image_sets`.`workspaceId` = ?"); expect(query.sql).toContain("`kb_image_sets`.`visibility` <> ?");
    expect(query.params).toEqual([7, "confirmed", "private"]);
  });
});
