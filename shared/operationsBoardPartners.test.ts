import { describe, expect, it } from "vitest";
import {
  OperationsBoardPartnerMemberSchema, OperationsBoardPartnerSchema, OperationsBoardPartnersExecuteInputSchema,
  OperationsBoardPartnersOptionsInputSchema, OperationsBoardPartnersOptionsResultSchema, OperationsBoardPartnersRecoverInputSchema,
  OperationsBoardPartnersWriteResultSchema, operationsBoardPartnersRequestHash,
} from "./operationsBoardPartners";

const operationId = "11111111-1111-4111-a111-111111111111";
const input = { expectedWorkspaceId: 7, operationId, firstUserId: 2, secondUserId: 3, isActive: true, expectedVersion: 0 };
const pair = { id: 91, workspaceId: 7, firstUserId: 2, secondUserId: 3, isActive: true, version: 1, updatedBy: 1, updatedAt: "2026-10-18 01:02:03.123000" };
const options = { identity: { workspaceId: 7, userId: 1 }, request: { expectedWorkspaceId: 7 }, members: [{ userId: 2, displayName: "SYNTHETIC 同名" }], pairs: [pair], capability: { available: true, reasonCode: null } };
const receipt = { identity: options.identity, operationId, status: "committed", requestHash: "a".repeat(64), pair, reasonCode: null };

describe("strict numeric direct-partner contracts", () => {
  it("accepts explicit ordered IDs without client names/owner and preserves booleans", () => {
    expect(OperationsBoardPartnersExecuteInputSchema.parse(input)).toEqual(input);
    expect(OperationsBoardPartnersExecuteInputSchema.parse({ ...input, isActive: false, expectedVersion: 2 }).isActive).toBe(false);
  });
  it.each([
    { firstUserId: 3, secondUserId: 2 }, { firstUserId: 2, secondUserId: 2 }, { firstUserId: "2" }, { secondUserId: 0 },
    { expectedWorkspaceId: 2147483648 }, { expectedVersion: -1 }, { expectedVersion: 1.5 }, { expectedVersion: 2147483648 },
    { isActive: 1 }, { isActive: "true" }, { operationId: operationId.toUpperCase() }, { operationId: "unsafe" },
    { firstUserName: "not authority" }, { owner: 1 }, { force: true }, { role: "admin" },
  ])("rejects malformed or extra execution fields %j", patch => {
    expect(OperationsBoardPartnersExecuteInputSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  it("options and recover accept only exact metadata", () => {
    expect(OperationsBoardPartnersOptionsInputSchema.parse({ expectedWorkspaceId: 7 })).toEqual({ expectedWorkspaceId: 7 });
    expect(OperationsBoardPartnersOptionsInputSchema.safeParse({ expectedWorkspaceId: 7, userId: 1 }).success).toBe(false);
    expect(OperationsBoardPartnersRecoverInputSchema.parse({ expectedWorkspaceId: 7, operationId, decision: "cancel" }).decision).toBe("cancel");
    expect(OperationsBoardPartnersRecoverInputSchema.safeParse({ expectedWorkspaceId: 7, operationId, decision: "check", pair }).success).toBe(false);
    expect(OperationsBoardPartnersRecoverInputSchema.safeParse({ expectedWorkspaceId: 7, operationId, decision: "retry" }).success).toBe(false);
  });
  it.each([
    { firstUserId: 3, secondUserId: 2 }, { version: 0 }, { isActive: 1 }, { updatedBy: null },
    { updatedAt: "2026-02-30 01:02:03.123000" }, { updatedAt: "2026-10-18 25:02:03.123000" },
    { updatedAt: "2026-10-18 01:02:03.123456" }, { updatedAt: "2026-10-18 01:02:03" }, { permissions: ["write"] },
  ])("rejects invalid persisted pair %j", patch => expect(OperationsBoardPartnerSchema.safeParse({ ...pair, ...patch }).success).toBe(false));
  it("validates real leap days, explicit millisecond precision and inactive history", () => {
    expect(OperationsBoardPartnerSchema.parse({ ...pair, isActive: false, updatedAt: "2024-02-29 01:02:03.000000" }).id).toBe(pair.id);
    expect(OperationsBoardPartnerSchema.safeParse({ ...pair, updatedAt: "2025-02-29 01:02:03.000000" }).success).toBe(false);
  });
  it.each(["", " trailing ", "line\nname", "\ud800", "a".repeat(201)])("rejects invalid member display name %j", displayName => {
    expect(OperationsBoardPartnerMemberSchema.safeParse({ userId: 2, displayName }).success).toBe(false);
  });
  it("retains historical pairs with no current eligible member and duplicate names with distinct IDs", () => {
    expect(OperationsBoardPartnersOptionsResultSchema.parse({ ...options, members: [] }).pairs).toEqual([pair]);
    expect(OperationsBoardPartnersOptionsResultSchema.parse({ ...options, members: [{ userId: 2, displayName: "同名" }, { userId: 3, displayName: "同名" }] }).members).toHaveLength(2);
  });
  it.each([
    { request: { expectedWorkspaceId: 8 } }, { pairs: [{ ...pair, workspaceId: 8 }] },
    { pairs: [pair, { ...pair, id: 92 }] }, { pairs: [pair, { ...pair, secondUserId: 4 }] },
    { members: [options.members[0], options.members[0]] }, { capability: { available: true, reasonCode: "disabled" } },
    { capability: { available: false, reasonCode: null } }, { members: Array.from({ length: 5001 }, (_, index) => ({ userId: index + 1, displayName: "SYNTHETIC" })) },
  ])("rejects ambiguous or unbounded options %#", patch => expect(OperationsBoardPartnersOptionsResultSchema.safeParse({ ...options, ...patch }).success).toBe(false));
  it("requires receipt content only on committed and binds workspace", () => {
    expect(OperationsBoardPartnersWriteResultSchema.parse(receipt).pair).toEqual(pair);
    for (const status of ["unknown", "cancelled"]) {
      expect(OperationsBoardPartnersWriteResultSchema.safeParse({ ...receipt, status }).success).toBe(false);
      expect(OperationsBoardPartnersWriteResultSchema.parse({ ...receipt, status, pair: null, requestHash: null, reasonCode: status }).pair).toBeNull();
    }
    expect(OperationsBoardPartnersWriteResultSchema.safeParse({ ...receipt, pair: null }).success).toBe(false);
    expect(OperationsBoardPartnersWriteResultSchema.safeParse({ ...receipt, pair: { ...pair, workspaceId: 8 } }).success).toBe(false);
    expect(OperationsBoardPartnersWriteResultSchema.safeParse({ ...receipt, pair: { ...pair, updatedBy: 2 } }).success).toBe(false);
  });
  it("hashes strict parsed command canonically without silently sorting member IDs", () => {
    expect(operationsBoardPartnersRequestHash(input)).toMatch(/^[a-f0-9]{64}$/u);
    expect(operationsBoardPartnersRequestHash({ expectedVersion: 0, isActive: true, secondUserId: 3, firstUserId: 2, operationId, expectedWorkspaceId: 7 })).toBe(operationsBoardPartnersRequestHash(input));
    expect(operationsBoardPartnersRequestHash({ ...input, isActive: false })).not.toBe(operationsBoardPartnersRequestHash(input));
    expect(() => operationsBoardPartnersRequestHash({ ...input, firstUserId: 3, secondUserId: 2 })).toThrow();
  });
});
