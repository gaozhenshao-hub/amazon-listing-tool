import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../../_core/context";
import { createSkillReadonlyService } from "./skillReadonly";
import { EMPEROR_SKILL_READ_PROMPT_MAX_BYTES } from "../../../../shared/emperorSkillRead";

type Row = Record<string, unknown>;
const scope = { slug: "listing.title.research", expectedWorkspaceId: 7 };
const context = (patch: Record<string, unknown> = {}) => ({ user: { id: 3, role: "admin", status: "active", defaultWorkspaceId: 7 }, workspaceId: 7, ...patch }) as TrpcContext;
const registry = (patch: Row = {}): Row => ({ id: 9, workspaceId: null, slug: scope.slug, name: "标题研究", category: "Listing", status: "Released", scope: "global", version: 3,
  description: "说明", descriptionBytes: 6, manifestType: "OBJECT", implementationType: "OBJECT",
  systemPromptType: "STRING", systemPromptBytes: 11, systemPrompt: "exact\n text", userPromptTemplateType: null, userPromptTemplateBytes: null, userPromptTemplate: null, ...patch });
let actors: Row[], skills: Row[], policies: Row[], overrides: Row[], queries: { sql: string; params: unknown[] }[], nativeFailure: unknown;
const execute = vi.fn(async (statement: SQL) => {
  const query = new MySqlDialect().sqlToQuery(statement); queries.push(query);
  if (nativeFailure) throw nativeFailure;
  if (query.sql.includes("FROM users")) return [actors, []];
  if (query.sql.includes("FROM emperor_skills")) return [skills, []];
  if (query.sql.includes("FROM security_access_policies")) return [policies, []];
  if (query.sql.includes("FROM role_permissions")) return [overrides, []];
  throw new Error(`unexpected SQL: ${query.sql}`);
});
const transaction = vi.fn(async <T>(body: (tx: { execute: typeof execute }) => Promise<T>) => body({ execute }));
const database = vi.fn(async () => ({ transaction }));
const read = createSkillReadonlyService({ database }).read;
beforeEach(() => {
  vi.clearAllMocks(); nativeFailure = null; queries = [];
  actors = [{ id: 3, role: "admin", status: "active", defaultWorkspaceId: 7 }]; skills = [registry()];
  policies = [{ effect: "allow" }]; overrides = [];
});
describe("current registry exact read uses real transaction-bound governance", () => {
  it("returns only whitelisted fields, current provenance and lossless prompt", async () => {
    skills[0].manifest = { apiKey: "must-not-leak" }; skills[0].modelOverride = "secret-model";
    const output = await read(context(), scope);
    expect(output).toEqual({ identity: { userId: 3, workspaceId: 7 }, skill: { slug: scope.slug, name: "标题研究", description: "说明", category: "Listing", status: "Released", scope: "global",
      version: "3", sourceWorkspaceId: null, systemPrompt: "exact\n text", userPromptTemplate: null }, provenance: { kind: "current_registry", pinnedVersion: false } });
    expect(JSON.stringify(output)).not.toMatch(/must-not-leak|secret-model|manifest|modelOverride/);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(queries.find(query => query.sql.includes("security_access_policies"))?.params).toEqual(["emperor_skill", "read", 7, scope.slug, "3", "admin"]);
    expect(queries.every(query => /^SELECT /u.test(query.sql))).toBe(true);
    expect(queries.every(query => /FOR (SHARE|UPDATE)$/u.test(query.sql))).toBe(true);
  });
  it("binds exact case-sensitive slug + workspace; bounds only whitelist JSON paths without SELECT *", async () => {
    await read(context(), scope);
    const query = queries.find(query => query.sql.includes("FROM emperor_skills"))!;
    expect(query.params).toEqual([scope.slug, 7]);
    expect(query.sql).toContain("BINARY slug=BINARY ?");
    expect(query.sql).toContain("(workspaceId=? OR workspaceId IS NULL)");
    expect(query.sql).toContain("LIMIT 3 FOR SHARE");
    expect(query.sql).not.toMatch(/SELECT \*|status=|scope=|modelOverride|allowed_tools|apiKey|,manifest,/u);
    expect(query.sql).toContain("JSON_EXTRACT(manifest,'$.implementation.systemPrompt')");
    expect(query.sql).toContain("262144");
  });
  it("chooses exact workspace row over global regardless input order", async () => {
    skills = [registry(), registry({ id: 10, workspaceId: 7, scope: "private", name: "workspace", version: "12" })];
    const output = await read(context(), scope);
    expect(output.skill).toMatchObject({ name: "workspace", sourceWorkspaceId: 7, version: "12", scope: "private" });
  });
  it.each(["Draft", "Validated", "Approved", "Deprecated", "released", "unknown"])("selected workspace %s never falls back to Released global", async status => {
    skills = [registry(), registry({ id: 10, workspaceId: 7, status })];
    await expect(read(context(), scope)).rejects.toMatchObject({ code: "FORBIDDEN", message: "SKILL_READ_UNAVAILABLE" });
    expect(queries.filter(query => query.sql.includes("FROM emperor_skills"))).toHaveLength(1);
  });
  it("a selected denied workspace never returns the global entry", async () => {
    skills = [registry(), registry({ id: 10, workspaceId: 7 })]; policies = [{ effect: "deny" }];
    await expect(read(context(), scope)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(queries.filter(query => query.sql.includes("FROM emperor_skills"))).toHaveLength(1);
    expect(queries.some(query => /INSERT|UPDATE .*SET|DELETE/u.test(query.sql))).toBe(false);
  });
  it.each(["admin", "ops_manager", "ops_specialist"])("does not invent default emperor_skill permission for %s", async role => {
    actors[0].role = role; policies = [];
    await expect(read(context({ user: { ...context().user, role } }), scope)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("honors existing detailed configuration read grant, not broad module-only fallback", async () => {
    policies = []; overrides = [{ modules: '["emperor"]', detailedPermissions: JSON.stringify([{ moduleId: "emperor", operations: [], subModules: [{ subModuleId: "emperor_skills", operations: ["read"] }] }]) }];
    await expect(read(context(), scope)).resolves.toHaveProperty("skill.slug", scope.slug);
    overrides[0].detailedPermissions = "[]";
    await expect(read(context(), scope)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("retains existing super_admin permission without adding a new role exception", async () => {
    actors[0].role = "super_admin"; policies = [];
    await expect(read(context({ user: { ...context().user, role: "super_admin" } }), scope)).resolves.toHaveProperty("skill.slug", scope.slug);
  });
  it("legacy null scope binds only NULL rows and authorizes NULL rather than any foreign workspace", async () => {
    actors[0].defaultWorkspaceId = null;
    const output = await read(context({ user: { ...context().user, defaultWorkspaceId: null }, workspaceId: null }), { ...scope, expectedWorkspaceId: null });
    expect(output.identity.workspaceId).toBeNull();
    const query = queries.find(item => item.sql.includes("FROM emperor_skills"))!;
    expect(query.params).toEqual([scope.slug]); expect(query.sql).toContain("AND workspaceId IS NULL");
    expect(queries.find(item => item.sql.includes("security_access_policies"))?.params[2]).toBeNull();
  });
  it.each(["private", "shared"])("does not expose %s in a legacy global row", async scopeValue => {
    skills[0].scope = scopeValue; await expect(read(context(), scope)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("checks no-user and workspace precondition before database access", async () => {
    await expect(read(context({ user: null }), scope)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    for (const expectedWorkspaceId of [null, 8]) await expect(read(context(), { ...scope, expectedWorkspaceId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(database).not.toHaveBeenCalled();
  });
  it.each([{ status: "disabled" }, { id: 4 }, { defaultWorkspaceId: 8 }, { defaultWorkspaceId: null }, { role: "super_admin" }])("rejects changed/disabled actor %j before registry", async patch => {
    Object.assign(actors[0], patch);
    await expect(read(context(), scope)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(queries).toHaveLength(1);
  });
  it("rejects absent/duplicate actors", async () => {
    actors.push({ ...actors[0] }); await expect(read(context(), scope)).rejects.toMatchObject({ code: "FORBIDDEN" });
    actors = []; await expect(read(context(), scope)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("only returns not found after permission succeeds; denial conceals existence", async () => {
    skills = []; await expect(read(context(), scope)).rejects.toMatchObject({ code: "NOT_FOUND" });
    policies = [{ effect: "deny" }]; await expect(read(context(), scope)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each([{ workspaceId: 8 }, { slug: "other" }, { slug: "Listing.Title.Research" }, { id: null }, { workspaceId: "7" }])("rejects foreign/malformed returned identity %j", async patch => {
    skills = [registry(patch)]; await expect(read(context(), scope)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it.each([null, 7])("rejects duplicate matching scope %s without LIMIT luck", async workspaceId => {
    skills = [registry({ workspaceId }), registry({ id: 10, workspaceId })];
    await expect(read(context(), scope)).rejects.toMatchObject({ message: "SKILL_READ_REGISTRY_AMBIGUOUS" });
  });
  it("rejects an inconsistent duplicate primary key across scopes", async () => {
    skills = [registry(), registry({ workspaceId: 7 })];
    await expect(read(context(), scope)).rejects.toMatchObject({ message: "SKILL_READ_REGISTRY_AMBIGUOUS" });
  });
  it.each([{ manifestType: "ARRAY" }, { implementationType: "STRING" }, { version: 0 }, { version: "3oops" }, { version: 1.2 }, { scope: "foreign" }, { name: null }, { description: null, descriptionBytes: 70000 }])("rejects malformed selected record %j", async patch => {
    skills = [registry(patch)]; await expect(read(context(), scope)).rejects.toMatchObject({ message: "SKILL_READ_DATA_INVALID" });
  });
  it("returns absent/explicit null/empty prompts without manufacturing content", async () => {
    skills[0] = registry({ implementationType: null, systemPromptType: null, systemPromptBytes: null, systemPrompt: null });
    expect((await read(context(), scope)).skill.systemPrompt).toBeNull();
    skills[0] = registry({ systemPromptType: "NULL", systemPromptBytes: 4, systemPrompt: null });
    expect((await read(context(), scope)).skill.systemPrompt).toBeNull();
    skills[0] = registry({ systemPromptBytes: 0, systemPrompt: "" });
    expect((await read(context(), scope)).skill.systemPrompt).toBe("");
  });
  it("keeps complete multiline/markup prompt but rejects truncated or over-budget UTF8", async () => {
    const text = "<script>literal</script>\n" + "中".repeat(30000);
    skills[0] = registry({ systemPrompt: text, systemPromptBytes: Buffer.byteLength(text) });
    expect((await read(context(), scope)).skill.systemPrompt).toBe(text);
    skills[0].systemPromptBytes = EMPEROR_SKILL_READ_PROMPT_MAX_BYTES + 1; skills[0].systemPrompt = null;
    await expect(read(context(), scope)).rejects.toMatchObject({ message: "SKILL_READ_DATA_INVALID" });
  });
  it("accepts the exact prompt budget losslessly and rejects one byte over", async () => {
    const text = "x".repeat(EMPEROR_SKILL_READ_PROMPT_MAX_BYTES);
    skills[0] = registry({ systemPrompt: text, systemPromptBytes: text.length });
    expect((await read(context(), scope)).skill.systemPrompt).toHaveLength(text.length);
    skills[0] = registry({ systemPrompt: text + "x", systemPromptBytes: text.length + 1 });
    await expect(read(context(), scope)).rejects.toMatchObject({ message: "SKILL_READ_DATA_INVALID" });
  });
  it.each([{ systemPromptType: "OBJECT" }, { systemPromptBytes: 10 }, { systemPromptType: null }, { systemPromptBytes: "11" }])("rejects malformed prompt projection %j", async patch => {
    skills = [registry(patch)]; await expect(read(context(), scope)).rejects.toMatchObject({ message: "SKILL_READ_DATA_INVALID" });
  });
  it("requires a real transaction and sanitizes storage/authorization failures", async () => {
    await expect(createSkillReadonlyService({ database: async () => null }).read(context(), scope)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(createSkillReadonlyService({ database: async () => ({}) }).read(context(), scope)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    nativeFailure = new Error("mysql://secret prompt password");
    await expect(read(context(), scope)).rejects.toMatchObject({ message: "SKILL_READ_FAILED", code: "INTERNAL_SERVER_ERROR" });
    nativeFailure = null;
    const permission = vi.fn().mockRejectedValue(new TRPCError({ code: "FORBIDDEN", message: "secret permission details" }));
    await expect(createSkillReadonlyService({ database, permission }).read(context(), scope)).rejects.toMatchObject({ message: "SKILL_READ_ACCESS_DENIED" });
    expect(permission.mock.calls[0][0]).not.toHaveProperty("ownerUserId");
  });
  it.each([null, {}, [], [[null], []], [[[]], []]])("rejects malformed database row envelopes %j", async result => {
    execute.mockResolvedValueOnce(result as never);
    await expect(read(context(), scope)).rejects.toMatchObject({ message: "SKILL_READ_RESPONSE_INVALID" });
  });
  it("does not claim a successful read if transaction completion fails", async () => {
    const service = createSkillReadonlyService({ database: async () => ({ transaction: async body => {
      await body({ execute }); throw new Error("commit failed with connection secret");
    } }) });
    await expect(service.read(context(), scope)).rejects.toMatchObject({ message: "SKILL_READ_FAILED", code: "INTERNAL_SERVER_ERROR" });
  });
  it("does not fall back to role defaults when strict governance storage fails", async () => {
    execute.mockImplementationOnce(async statement => { queries.push(new MySqlDialect().sqlToQuery(statement)); return [actors, []]; })
      .mockImplementationOnce(async statement => { queries.push(new MySqlDialect().sqlToQuery(statement)); return [skills, []]; })
      .mockRejectedValueOnce(new Error("missing governance table"));
    await expect(read(context(), scope)).rejects.toMatchObject({ message: "SKILL_READ_FAILED" });
  });
  it("rejects malformed input before SQL and does not trim or wildcard match", async () => {
    for (const slug of [" x", "x ", "x%", "x' OR 1=1", "x/y", "x\n"]) await expect(read(context(), { ...scope, slug })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(database).not.toHaveBeenCalled();
  });
});
