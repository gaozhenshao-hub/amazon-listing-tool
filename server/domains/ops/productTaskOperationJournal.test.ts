import "../../../shared/productTaskWrite.test";
import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { createProductTaskOperationJournal, productTaskOperationAuditIds, productTaskOperationKey, productTaskOperationRequestHash, decodeProductTaskAttachment, ProductTaskPreparedUploadSchema, type ProductTaskPreparedUpload } from "./productTaskOperationJournal";
import type { ProductTaskWriteExecuteInput, ProductTaskWriteResult } from "../../../shared/productTaskWrite";

const identity = { userId: 3, workspaceId: 7 }, operationId = "11ad21b6-18f1-4d4f-8ddf-000000000001", version = "a".repeat(64);
const command: ProductTaskWriteExecuteInput = { expectedWorkspaceId: 7, operationId, action: "upload", taskId: 11, expectedVersion: version, name: "note.pdf", base64: Buffer.from("private content").toString("base64") };
function prepared(): ProductTaskPreparedUpload { const bytes = Buffer.from(command.action === "upload" ? command.base64 : "", "base64"), objectKey = `ops-tasks/7/11/${productTaskOperationKey(identity, operationId)}.pdf`; return { identity, operationId, action: "upload", requestHash: productTaskOperationRequestHash(command), taskId: 11, expectedVersion: version, name: "note.pdf", contentHash: createHash("sha256").update(bytes).digest("hex"), byteSize: bytes.length, provider: "oss", objectKey, storageUri: `storage://oss/${objectKey}` }; }
function fixture() {
  const rows: Record<string, unknown>[] = [], calls: { sql: string; params: unknown[] }[] = [];
  const execute = vi.fn(async (sql: SQL): Promise<unknown> => {
    const query = new MySqlDialect().sqlToQuery(sql); calls.push(query);
    if (query.sql.startsWith("SELECT")) return [rows.filter(row => query.params.includes(row.auditId)), []];
    const [auditId, workspaceId, actorUserId, actorRole, action, resourceId, metadataText] = query.params;
    if (rows.some(row => row.auditId === auditId)) throw new Error("duplicate");
    rows.push({ auditId, workspaceId, actorUserId, actorRole, action, resourceId, metadataText, resourceType: "ops_task_operation", status: "success" }); return [{ affectedRows: 1 }, []];
  });
  const journal = createProductTaskOperationJournal({ execute }, { ...identity, operationId, actorRole: "operator" });
  return { journal, rows, calls, execute };
}
const receipt = (patch: Partial<ProductTaskWriteResult> = {}): ProductTaskWriteResult => ({ identity, operationId, action: "create", status: "committed", taskId: 11, attachmentId: null, taskVersion: version, reasonCode: null, ...patch });
describe("task operation immutable transactional journal", () => {
  it("keeps operation identity separate from content and binds actor/workspace", () => {
    expect(productTaskOperationAuditIds(identity, operationId).final.length).toBeLessThanOrEqual(80);
    expect(productTaskOperationKey(identity, operationId)).not.toBe(productTaskOperationKey({ ...identity, userId: 4 }, operationId));
    expect(productTaskOperationKey(identity, operationId)).not.toBe(productTaskOperationKey({ ...identity, workspaceId: 8 }, operationId));
    expect(productTaskOperationRequestHash(command)).not.toBe(productTaskOperationRequestHash({ ...command, name: "different.pdf" }));
  });
  it("has no final on an untouched UUID, not a synthetic failed/success receipt", async () => expect(await fixture().journal.read()).toEqual({ final: null, prepared: null }));
  it("records prepare once and never stores the base64 body", async () => {
    const f = fixture(); expect((await f.journal.prepare(prepared())).created).toBe(true); expect((await f.journal.prepare(prepared())).created).toBe(false);
    expect(f.rows).toHaveLength(1); expect(JSON.stringify(f.rows)).not.toContain(command.action === "upload" ? command.base64 : ""); expect(JSON.stringify(f.rows)).not.toContain("private content");
    expect(f.calls.filter(call => call.sql.startsWith("SELECT")).every(call => call.sql.includes("FOR UPDATE") && call.sql.includes("32768"))).toBe(true);
  });
  it("same UUID with a different payload conflicts before storage", async () => {
    const f = fixture(); await f.journal.prepare(prepared()); const changed = prepared(); changed.name = "other.pdf";
    await expect(f.journal.prepare(changed)).rejects.toThrow(); expect(f.rows).toHaveLength(1);
  });
  it("commits and replays a fixed success receipt without duplicate effects", async () => {
    const f = fixture(); const saved = await f.journal.finalize(receipt(), version); expect(saved).toEqual(receipt()); expect(await f.journal.finalize(receipt(), version)).toEqual(saved); expect(f.rows).toHaveLength(1);
    await expect(f.journal.finalize(receipt(), "b".repeat(64))).rejects.toThrow("CONTENT_CONFLICT");
  });
  it("cancel before prepare is a permanent late submission fence", async () => {
    const f = fixture(); expect(await f.journal.cancel()).toMatchObject({ status: "cancelled", action: null, taskId: null });
    await expect(f.journal.prepare(prepared())).rejects.toThrow("CANCELLED"); await expect(f.journal.finalize(receipt(), version)).rejects.toThrow("CANCELLED"); expect(f.rows).toHaveLength(1);
  });
  it("cancel after prepare preserves only metadata and cannot become committed", async () => {
    const f = fixture(); await f.journal.prepare(prepared()); expect(await f.journal.cancel()).toMatchObject({ status: "cancelled", action: "upload", taskId: 11 });
    await expect(f.journal.finalize(receipt({ action: "upload", attachmentId: 22 }), prepared().requestHash)).rejects.toThrow("CANCELLED"); expect(f.rows).toHaveLength(2);
  });
  it("cannot cancel an already committed mutation", async () => { const f = fixture(); await f.journal.finalize(receipt(), version); expect(await f.journal.cancel()).toEqual(receipt()); });
  it("requires a matching prepare for upload finalization", async () => {
    const f = fixture(); await expect(f.journal.finalize(receipt({ action: "upload", attachmentId: 22 }), prepared().requestHash)).rejects.toThrow("RECEIPT_MISMATCH");
    await f.journal.prepare(prepared()); expect(await f.journal.finalize(receipt({ action: "upload", attachmentId: 22 }), prepared().requestHash)).toMatchObject({ status: "committed", attachmentId: 22 });
  });
  it.each(["workspace", "actor", "resource", "action", "body", "duplicate"])("rejects forged persisted %s", async kind => {
    const f = fixture(); await f.journal.finalize(receipt(), version);
    if (kind === "workspace") f.rows[0].workspaceId = 8; if (kind === "actor") f.rows[0].actorUserId = 4; if (kind === "resource") f.rows[0].resourceId = "different"; if (kind === "action") f.rows[0].action = "some_other_audit"; if (kind === "body") f.rows[0].metadataText = "{"; if (kind === "duplicate") f.rows.push({ ...f.rows[0] });
    await expect(f.journal.read()).rejects.toThrow();
  });
  it("refuses unknown receipts and never guesses a successful write acknowledgement", async () => {
    const f = fixture(); await expect(f.journal.finalize(receipt({ status: "unknown", taskVersion: null, reasonCode: "commit_unknown" }), version)).rejects.toThrow();
    const journal = createProductTaskOperationJournal({ execute: async sql => new MySqlDialect().sqlToQuery(sql).sql.startsWith("SELECT") ? [[], []] : [{ affectedRows: 0 }, []] }, { ...identity, operationId, actorRole: "operator" });
    await expect(journal.finalize(receipt(), version)).rejects.toThrow("WRITE_UNCONFIRMED");
  });
  it.each(["AA=", "AB==", "AA==\n", ""])("rejects noncanonical or empty base64 %j", value => expect(() => decodeProductTaskAttachment(value)).toThrow());
  it.each(["objectKey", "storageUri", "requestHash"])("verifies prepare %s binding", field => { const value = prepared(); (value as unknown as Record<string, unknown>)[field] = field === "requestHash" ? "b".repeat(64) : "forged"; expect(ProductTaskPreparedUploadSchema.safeParse(value).success).toBe(false); });
});
