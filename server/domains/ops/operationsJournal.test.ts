import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { createOperationsJournalRepository } from "./operationsJournal";
import { JournalReadSchema, JournalSaveSchema, journalMonday, shiftJournalDate } from "../../../shared/operationsJournal";
import type { TrpcContext } from "../../_core/context";

const content = { kind: "daily" as const, completed: "完成产品检查", issues: "", next: "广告复盘" };
const input = { expectedWorkspaceId: 7, ownerId: 3, date: "2026-10-21", expectedRevision: 0, requestId: "a0000000-0000-4000-8000-000000000001", content };
const read = { expectedWorkspaceId: 7, ownerId: 3, from: "2026-10-19", to: "2026-10-21", week: "2026-10-19" };
let rows: any[], role: string, status: string, statements: string[];
const permission = vi.fn(), directory = vi.fn();
const ctx = () => ({ user: { id: 3, role, status: "active", defaultWorkspaceId: 7 }, workspaceId: 7 }) as TrpcContext;
const tx = { execute: vi.fn(async (statement: any) => {
  const { sql, params: p } = new MySqlDialect().sqlToQuery(statement); statements.push(sql);
  if (sql.includes("FROM users WHERE")) return [[{ id: 3, role, status, defaultWorkspaceId: 7 }], []];
  if (sql.includes("SELECT DISTINCT u.id")) return [[{ id: 3, name: "本人" }, { id: 4, name: "搭档" }, { id: 5, name: "同事" }], []];
  if (sql.startsWith("INSERT")) { rows = [{ date: p[3], revision: 1, content: JSON.parse(String(p[4])), requestId: p[5], updatedAt: "2026-10-21 13:00" }]; return [{ affectedRows: 1 }, []]; }
  if (sql.startsWith("UPDATE")) { rows[0] = { ...rows[0], revision: rows[0].revision + 1, content: JSON.parse(String(p[0])), requestId: p[1] }; return [{ affectedRows: 1 }, []]; }
  if (sql.includes("FROM ops_work_journals")) return [rows, []];
  throw new Error("Unexpected SQL");
}) };
const repo = createOperationsJournalRepository({ database: async () => ({ transaction: async (f: any) => f(tx) }) as any, permission, directory, partners: async () => ({ available: true, ids: [3, 4] }) });
beforeEach(() => { rows = []; role = "member"; status = "active"; statements = []; vi.clearAllMocks(); permission.mockResolvedValue(undefined); directory.mockResolvedValue(undefined); });
describe("operating journals", () => {
  it("stores and reads daily content, retries once without duplicate updates", async () => {
    const saved = await repo.save(ctx(), input); expect(saved.revision).toBe(1);
    expect((await repo.read(ctx(), read)).daily[0].content).toEqual(content);
    expect((await repo.save(ctx(), input)).revision).toBe(1);
    expect(statements.filter(s => s.startsWith("INSERT"))).toHaveLength(1);
  });
  it("updates by revision and refuses stale overwrites", async () => {
    await repo.save(ctx(), input);
    const next = { ...input, requestId: "a0000000-0000-4000-8000-000000000002", content: { ...content, completed: "更新内容" } };
    await expect(repo.save(ctx(), next)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await repo.save(ctx(), { ...next, expectedRevision: 1 })).revision).toBe(2);
    await expect(repo.save(ctx(), { ...next, content })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("makes direct partners read only, hides unrelated colleagues", async () => {
    expect((await repo.options(ctx(), 7)).members.map(m => m.id)).toEqual([3, 4]);
    expect((await repo.read(ctx(), { ...read, ownerId: 4 })).canEdit).toBe(false);
    await expect(repo.save(ctx(), { ...input, ownerId: 4 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(repo.read(ctx(), { ...read, ownerId: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("allows administrator edits for active workspace members", async () => {
    role = "admin"; expect((await repo.options(ctx(), 7)).members).toHaveLength(3);
    expect((await repo.save(ctx(), { ...input, ownerId: 5 })).revision).toBe(1);
    await expect(repo.save(ctx(), { ...input, ownerId: 99 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("refuses cross workspace, inactive and revoked access before writes", async () => {
    await expect(repo.save(ctx(), { ...input, expectedWorkspaceId: 8 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    status = "disabled"; await expect(repo.save(ctx(), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    status = "active"; directory.mockRejectedValue(new Error("private SQL")); await expect(repo.save(ctx(), input)).rejects.toThrow("暂时无法读取或保存");
    expect(statements.some(s => /^(INSERT|UPDATE)/.test(s))).toBe(false);
  });
  it("stores a whole Monday to Sunday plan", async () => {
    const weekly = { ...input, date: "2026-10-19", content: { kind: "weekly" as const, days: ["优化", "", "", "", "", "", "复盘"] } };
    await repo.save(ctx(), weekly); expect((await repo.read(ctx(), read)).weekly?.content).toEqual(weekly.content);
  });
});
describe("calendar boundaries", () => {
  it("handles Sunday, year changes and leap dates", () => {
    expect(journalMonday("2026-01-04")).toBe("2025-12-29");
    expect(shiftJournalDate("2024-03-01", -1)).toBe("2024-02-29");
  });
  it("rejects invalid, oversized and mismatched periods", () => {
    expect(JournalReadSchema.safeParse({ ...read, from: "invalid" }).success).toBe(false);
    expect(JournalReadSchema.safeParse({ ...read, from: "2026-02-30" }).success).toBe(false);
    expect(JournalReadSchema.safeParse({ ...read, to: "2026-11-01" }).success).toBe(false);
    expect(JournalSaveSchema.safeParse({ ...input, content: { kind: "weekly", days: Array(7).fill("") } }).success).toBe(false);
    expect(JournalSaveSchema.safeParse({ ...input, content: { ...content, completed: "x".repeat(5001) } }).success).toBe(false);
  });
});
