import { describe, expect, it } from "vitest";
import { MySqlDialect, getTableConfig, type AnyMySqlTable } from "drizzle-orm/mysql-core";
import { createManualSnapshotReviewTestFixture } from "./manualSnapshotReview.testFixture";
import { createManualSnapshotReviewService } from "./manualSnapshotReviewService";
import { assertManualSnapshotReviewSchema, type ManualSnapshotReviewExecutor } from "./manualSnapshotReviewRepository";
import { AcquisitionReviewReadResultSchema, AcquisitionReviewWriteInputSchema, AcquisitionReviewImageInputSchema,
  acquisitionReviewCanonical, acquisitionReviewHash, acquisitionReviewImageRequestHash } from "../../../shared/acquisitionReview";
import * as acquisition from "../../../drizzle/schema/acquisition";
import { securityAuditLogs } from "../../../drizzle/schema/auth";

describe("manual review public service", () => {
  it("requires explicit matching workspace before DB work, with no null/default fallback", async () => {
    const f = createManualSnapshotReviewTestFixture();
    for (const workspaceId of [null, undefined, 8]) await expect(f.service.read({ ...f.ctx, workspaceId }, f.scope)).rejects.toThrow("SCOPE_CHANGED");
    expect(f.sqlCalls).toEqual([]);
  });
  it("read is complete, bounded, privacy-safe and performs no INSERT/UPDATE/DELETE", async () => {
    const f = createManualSnapshotReviewTestFixture(), read = await f.service.read(f.ctx, f.scope);
    expect(AcquisitionReviewReadResultSchema.safeParse(read).success).toBe(true); expect(read.assets).toHaveLength(1);
    expect(read.original.research).toEqual(f.state.snapshot.normalizedData.research);
    expect(JSON.stringify(read)).not.toContain("storage://"); expect(JSON.stringify(read)).not.toContain("requestedBy");
    expect(f.sqlCalls.every(call => call.sql.startsWith("SELECT"))).toBe(true);
  });
  it("flagoff preserves reads and unknown checks, prohibits new saves, and never advertises fake image availability", async () => {
    const f = createManualSnapshotReviewTestFixture(); f.control.enabled = false;
    const read = await f.service.read(f.ctx, f.scope);
    expect(Object.values(read.capabilities).every(value => !value.available)).toBe(true);
    await expect(f.service.execute(f.ctx, await f.save())).rejects.toThrow("WRITES_DISABLED");
    expect((await f.service.recover(f.ctx, { ...f.scope, operationId: f.operationId, decision: "check" })).status).toBe("unknown");
    f.control.enabled = true; expect((await f.service.read(f.ctx, f.scope)).capabilities.image.available).toBe(false);
  });
  it("image capability uses actual injected storage and is overridden by writes-off", async () => {
    const f = createManualSnapshotReviewTestFixture(); const service = createManualSnapshotReviewService({ repository: f.repository,
      previewUrl: async () => "https://example.invalid/a.png", imageCapability: () => ({ available: true, reasonCode: null }) });
    expect((await service.read(f.ctx, f.scope)).capabilities.image.available).toBe(true); f.control.enabled = false;
    expect((await service.read(f.ctx, f.scope)).capabilities.image.available).toBe(false);
  });
  it("asset preview failures remain explicit null, not a fake original URL", async () => {
    const f = createManualSnapshotReviewTestFixture(), service = createManualSnapshotReviewService({ repository: f.repository,
      previewUrl: async () => { throw new Error("private endpoint failed"); } });
    const read = await service.read(f.ctx, f.scope); expect(read.assets[0].previewUrl).toBeNull(); expect(read.assets[0].storageAvailable).toBe(true);
  });
  it("journal absence is unknown and cancel absence is durable cancelled, never failed", async () => {
    const f = createManualSnapshotReviewTestFixture(); const input = { ...f.scope, operationId: f.operationId, decision: "check" as const };
    expect((await f.service.recover(f.ctx, input)).status).toBe("unknown");
    expect((await f.service.recover(f.ctx, { ...input, decision: "cancel" })).status).toBe("cancelled");
    expect((await f.service.recover(f.ctx, input)).status).toBe("cancelled");
  });
  it("request scalar/UUID/field bounds remain strict and never silently truncate", async () => {
    const f = createManualSnapshotReviewTestFixture(), input = await f.save();
    for (const bad of [{ ...input, operationId: "ABCDEFAB-1111-4111-8111-111111111111" }, { ...input, note: "a".repeat(2001) },
      { ...input, patch: { description: "a".repeat(20001) } }, { ...input, unknown: true }]) expect(AcquisitionReviewWriteInputSchema.safeParse(bad).success).toBe(false);
  });
  it("image logical request hash omits bytes but binds exact decoded-content metadata", () => {
    const f = createManualSnapshotReviewTestFixture(); const input = AcquisitionReviewImageInputSchema.parse({ ...f.scope, operationId: f.operationId,
      expectedRevisionHash: "a".repeat(64), mode: "supplement", sourceAssetId: null, role: "secondary", fileName: "a.png", base64: "YQ==" });
    const first = acquisitionReviewImageRequestHash(f.identity, input, { contentHash: "b".repeat(64), byteSize: 1 });
    expect(first).not.toBe(acquisitionReviewImageRequestHash(f.identity, input, { contentHash: "c".repeat(64), byteSize: 1 }));
    if (input.mode !== "supplement") throw new Error("Expected supplemental fixture");
    const { base64: _body, ...rest } = input;
    expect(first).toBe(acquisitionReviewHash({ identity: f.identity, request: { ...rest, contentHash: "b".repeat(64), byteSize: 1 } }));
  });
  it("canonical refuses getters, Date, undefined, cycles and oversize complete responses", () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    for (const value of [{ a: undefined }, { a: new Date() }, { get secret() { throw new Error("getter must not run"); } }, cycle]) expect(() => acquisitionReviewCanonical(value)).toThrow();
    expect(() => acquisitionReviewCanonical({ a: "large" }, 3)).toThrow();
  });
  it("consumer project mismatch and malformed schema cannot be returned as an empty authorized result", async () => {
    const f = createManualSnapshotReviewTestFixture(); await expect(f.service.read(f.ctx, { ...f.scope, expectedProjectId: null })).rejects.toThrow("SCOPE_CHANGED");
    f.state.snapshot.normalizedData.assets[0].sourceUrlHash = "invalid";
    // Missing original schema must fail even before a manual draft exists.
    await expect(f.service.read(f.ctx, f.scope)).rejects.toThrow();
  });
});

function admissionFixture() {
  const dialect = new MySqlDialect(), configs = new Map<string, ReturnType<typeof getTableConfig>>();
  for (const table of [acquisition.acquisitionJobs, acquisition.acquisitionSourceSnapshots, acquisition.acquisitionRawArtifacts,
    acquisition.acquisitionAssetCandidates, acquisition.acquisitionSnapshotRevisions, acquisition.acquisitionConfirmedSnapshots,
    acquisition.acquisitionConsumerLinks, securityAuditLogs] as AnyMySqlTable[]) { const config = getTableConfig(table); configs.set(config.name, config); }
  const engine = new Map([...configs.keys(), "users", "workspaces", "workspace_memberships", "role_permissions", "security_access_policies"].map(name => [name, "InnoDB"]));
  const columns = new Map([...configs].map(([name, config]) => [name, config.columns.map(column => {
    const type = column.getSQLType().replace(/,\s+/gu, ","), maximum = /^varchar\((\d+)\)$/u.exec(type);
    return { name: column.name, columnName: column.name, columnType: type, dataType: type.startsWith("enum(") ? "enum" : type.split("(")[0],
      nullable: column.notNull ? "NO" : "YES", isNullable: column.notNull ? "NO" : "YES",
      extra: column.name === "id" ? "auto_increment" : "", defaultValue: /^(?:created_at|updated_at|createdAt)$/u.test(column.name) ? "CURRENT_TIMESTAMP" : null,
      collation: /^(?:varchar|text|enum)/u.test(type) ? "utf8mb4_unicode_ci" : null, maxLength: maximum ? Number(maximum[1]) : null };
  })]));
  const keys: Record<string, string[][]> = { acquisition_asset_candidates: [["id"], ["snapshot_id", "role", "position_index"]], acquisition_snapshot_revisions: [["id"], ["snapshot_id", "version"]],
    acquisition_confirmed_snapshots: [["id"], ["snapshot_id", "confirmation_version"]], acquisition_consumer_links: [["id"], ["workspace_id", "consumer_type", "consumer_ref", "capability_scope", "confirmed_snapshot_id"]], security_audit_logs: [["id"], ["auditId"]] };
  const indexes = new Map(Object.entries(keys).map(([name, groups]) => [name, groups.flatMap((group, i) => group.map((columnName, n) => ({ name: i === 0 ? "PRIMARY" : `unique_${i}`, indexName: i === 0 ? "PRIMARY" : `unique_${i}`,
    columnName, sequence: n + 1, nonUnique: 0, subPart: null as number | null, prefixLength: null as number | null }))) ]));
  const tx: ManualSnapshotReviewExecutor = { execute: async statement => {
    const { sql, params } = dialect.sqlToQuery(statement);
    if (sql.includes("information_schema.TABLES")) return [[...engine].filter(([name]) => params.includes(name)).map(([tableName, value]) => ({ tableName, engine: value })), []];
    if (sql.includes("information_schema.COLUMNS")) return [structuredClone(columns.get(String(params[0])) ?? []), []];
    if (sql.includes("information_schema.STATISTICS")) return [structuredClone(indexes.get(String(params[0])) ?? []), []];
    throw new Error("Admission fixture forbids business SQL");
  } };
  return { tx, engine, columns, indexes };
}
describe("manual review existing schema admission (metadata fixtures only)", () => {
  it("accepts existing intended table types and actual audit enum/nullable metadata contract", async () => {
    const f = admissionFixture(); await expect(assertManualSnapshotReviewSchema(f.tx)).resolves.toBeUndefined();
  });
  it.each(["missing", "engine", "type", "nullable", "generated", "required-extra", "prefix", "extra-unique", "missing-unique", "audit-unique", "timestamp"])("rejects %s incompatibility without DDL", async mode => {
    const f = admissionFixture(), table = "acquisition_snapshot_revisions", column = f.columns.get(table)!.find(row => row.name === "patch")!;
    if (mode === "missing") f.engine.delete(table);
    if (mode === "engine") f.engine.set(table, "MyISAM");
    if (mode === "type") column.columnType = "text";
    if (mode === "nullable") column.nullable = "YES";
    if (mode === "generated") column.extra = "STORED GENERATED";
    if (mode === "required-extra") f.columns.get(table)!.push({ ...column, name: "unexpected", nullable: "NO", defaultValue: null });
    if (mode === "prefix") f.indexes.get(table)![1].subPart = 1;
    if (mode === "extra-unique") f.indexes.get(table)!.push({ ...f.indexes.get(table)![0], name: "other", indexName: "other", columnName: "created_by" });
    if (mode === "missing-unique") f.indexes.set(table, f.indexes.get(table)!.slice(0, 1));
    if (mode === "audit-unique") f.indexes.set("security_audit_logs", f.indexes.get("security_audit_logs")!.slice(0, 1));
    if (mode === "timestamp") f.columns.get(table)!.find(row => row.name === "created_at")!.defaultValue = null;
    await expect(assertManualSnapshotReviewSchema(f.tx)).rejects.toThrow(/SCHEMA_UNAVAILABLE/u);
  });
});
