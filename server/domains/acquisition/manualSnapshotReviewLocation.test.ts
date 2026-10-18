import { describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../_core/context";
vi.mock("../../repositories/dbClient", () => ({ getDb: vi.fn(() => { throw new Error("REAL_DB_FORBIDDEN"); }) }));
vi.mock("../../services/securityGovernance", () => ({ assertResourceAction: vi.fn(() => { throw new Error("REAL_POLICY_FORBIDDEN"); }) }));
vi.mock("./imageWorkflowProjection", () => ({ parseImageWorkflowConsumerRef: (value: string) => {
  if (!/^project:[1-9]\d*:competitor-gallery$/u.test(value)) throw new Error("invalid reference"); return { projectId: Number(value.split(":")[1]) };
} }));
import { createManualSnapshotReviewLocation } from "./manualSnapshotReviewLocation";

function fixture() {
  const state = {
    users: [{ id: 3, role: "admin", status: "active", defaultWorkspaceId: 7 }], workspaces: [{ id: 7, status: "active" }],
    members: [{ userId: 3, workspaceId: 7, status: "active" }], parents: [{ id: 11, userId: 3, workspaceId: 7 }],
    jobs: [{ id: 31, workspaceId: 7, requestedBy: 3, consumerType: "project_competitor", consumerRef: "project-competitor:11:B012345678:capture-v1", asin: "B012345678", marketplace: "US", status: "confirmed", cacheHitSnapshotId: null as number | null }],
    sources: [{ id: 21, workspaceId: 7, jobId: 31, asin: "B012345678", marketplace: "US" }],
    confirmed: [{ id: 41, snapshotId: 21 }], originalJobs: [{ id: 30, workspaceId: 7, requestedBy: 3, consumerType: "project_competitor", consumerRef: "project-competitor:11:B012345678:capture-v1" }],
  };
  const calls: Array<{ sql: string; params: unknown[] }> = [], dialect = new MySqlDialect();
  const execute = vi.fn(async (statement: SQL) => {
    const query = dialect.sqlToQuery(statement); calls.push(query); const sql = query.sql;
    let rows: unknown[];
    if (sql.includes("FROM users ")) rows = state.users;
    else if (sql.includes("FROM workspaces ")) rows = state.workspaces;
    else if (sql.includes("FROM workspace_memberships ")) rows = state.members;
    else if (sql.includes("FROM projects ")) rows = state.parents;
    else if (sql.includes("FROM acquisition_confirmed_snapshots ")) rows = state.confirmed;
    else if (sql.includes("FROM acquisition_source_snapshots ")) rows = state.sources;
    else if (sql.includes("FROM acquisition_jobs ")) rows = sql.includes("cache_hit_snapshot_id") ? state.jobs : state.originalJobs;
    else throw new Error("Unexpected query");
    return [structuredClone(rows), []];
  });
  const transaction = vi.fn(async (body: (tx: { execute: typeof execute }) => Promise<unknown>) => body({ execute }));
  const database = vi.fn(async () => ({ transaction })), permission = vi.fn(async () => undefined);
  const service = createManualSnapshotReviewLocation({ database: database as never, permission: permission as never });
  const context = { user: { id: 3 }, workspaceId: 7 } as TrpcContext;
  return { state, calls, execute, transaction, database, permission, service, context, input: { expectedWorkspaceId: 7, jobId: 31 } };
}
describe("exact snapshot review location (mock transaction only)", () => {
  it("returns exact job and server-derived project metadata, without source/body/URL reads or writes", async () => {
    const f = fixture(); expect(await f.service.read(f.context, f.input)).toEqual({ identity: { userId: 3, workspaceId: 7 }, jobId: 31, status: "confirmed", snapshotId: 21, projectId: 11 });
    expect(f.calls.every(call => call.sql.startsWith("SELECT"))).toBe(true);
    expect(f.calls.map(call => call.sql).join(" ")).not.toMatch(/normalized_data|raw_artifact|storage_key|security_audit_logs|INSERT|UPDATE\s+\w+\s+SET/u);
    expect(f.permission).toHaveBeenCalledWith(expect.objectContaining({ resource: "project", action: "read", projectId: 11, workspaceId: 7,
      authorizationRead: expect.objectContaining({ strict: true, lockMode: "share" }) }));
  });
  it("uses the writer-compatible workspace-before-actor lock order", async () => {
    const f = fixture(); await f.service.read(f.context, f.input);
    expect(f.calls.findIndex(call => call.sql.includes("FROM workspaces "))).toBeLessThan(f.calls.findIndex(call => call.sql.includes("FROM users ")));
  });
  it("snapshot route finds project only through exact snapshot and owning job", async () => {
    const f = fixture(); const result = await f.service.read(f.context, { expectedWorkspaceId: 7, snapshotId: 21 });
    expect(result.projectId).toBe(11); expect(result.snapshotId).toBe(21);
    expect(f.calls.find(call => call.sql.includes("FROM acquisition_source_snapshots "))?.params).toEqual([21, 7]);
  });
  it.each(["queued", "running"])("%s has no editable snapshot and never guesses by ASIN", async status => {
    const f = fixture(); f.state.jobs[0].status = status;
    expect((await f.service.read(f.context, f.input)).snapshotId).toBeNull();
    expect(f.calls.some(call => call.sql.includes("FROM acquisition_source_snapshots "))).toBe(false);
  });
  it("terminal missing snapshot stays explicitly null instead of an empty source", async () => {
    const f = fixture(); f.state.sources = []; f.state.jobs[0].status = "failed";
    expect(await f.service.read(f.context, f.input)).toMatchObject({ status: "failed", snapshotId: null });
  });
  it.each([null, undefined, 8])("rejects context workspace %s before database access", async workspaceId => {
    const f = fixture(); await expect(f.service.read({ ...f.context, workspaceId } as TrpcContext, f.input)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(f.database).not.toHaveBeenCalled();
  });
  it.each(["missingActor", "inactiveActor", "actorWorkspace", "inactiveWorkspace", "duplicateMembership", "inactiveMembership", "foreignJob", "foreignParent", "foreignSnapshot"])("fails closed for %s", async mode => {
    const f = fixture();
    if (mode === "missingActor") f.state.users = [];
    if (mode === "inactiveActor") f.state.users[0].status = "inactive";
    if (mode === "actorWorkspace") f.state.users[0].defaultWorkspaceId = 8;
    if (mode === "inactiveWorkspace") f.state.workspaces[0].status = "inactive";
    if (mode === "duplicateMembership") f.state.members.push({ ...f.state.members[0] });
    if (mode === "inactiveMembership") f.state.members[0].status = "inactive";
    if (mode === "foreignJob") f.state.jobs[0].requestedBy = 4;
    if (mode === "foreignParent") f.state.parents[0].userId = 4;
    if (mode === "foreignSnapshot") f.state.sources[0].workspaceId = 8;
    await expect(f.service.read(f.context, f.input)).rejects.toThrow(/ACQUISITION_REVIEW_LOCATION_/u);
  });
  it("cached snapshot is permitted only for same original actor and exact consumer target", async () => {
    const f = fixture(); f.state.jobs[0].cacheHitSnapshotId = 41; f.state.sources[0].jobId = 30;
    expect((await f.service.read(f.context, f.input)).snapshotId).toBe(21);
    f.state.originalJobs[0].consumerRef = "project-competitor:12:B012345678:capture-v1";
    await expect(f.service.read(f.context, f.input)).rejects.toMatchObject({ code: "FORBIDDEN", message: "ACQUISITION_REVIEW_LOCATION_CACHE_TARGET_DIFFERS" });
    f.state.originalJobs[0].consumerRef = f.state.jobs[0].consumerRef; f.state.originalJobs[0].requestedBy = 4;
    await expect(f.service.read(f.context, f.input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("permission rejection cannot become an empty review source", async () => {
    const f = fixture(); f.permission.mockRejectedValue(new TRPCError({ code: "FORBIDDEN", message: "private policy detail" }));
    await expect(f.service.read(f.context, f.input)).rejects.toMatchObject({ code: "FORBIDDEN", message: "ACQUISITION_REVIEW_LOCATION_ACCESS_DENIED" });
  });
  it("database errors are safely redacted and never treated as a terminal job", async () => {
    const f = fixture(); f.execute.mockRejectedValue(new Error("private SQL credentials"));
    await expect(f.service.read(f.context, f.input)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "ACQUISITION_REVIEW_LOCATION_READ_FAILED" });
  });
  it.each([{ expectedWorkspaceId: 7, jobId: 31, snapshotId: 21 }, { expectedWorkspaceId: 7, jobId: 31, projectId: 11 }, { expectedWorkspaceId: 7, jobId: 0 }])("rejects unknown/ambiguous caller authority fields", async input => {
    const f = fixture(); await expect(f.service.read(f.context, input)).rejects.toThrow(); expect(f.database).not.toHaveBeenCalled();
  });
});
