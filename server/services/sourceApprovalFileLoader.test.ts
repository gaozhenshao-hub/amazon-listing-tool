import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSourceApprovalFileLoader, SOURCE_APPROVAL_FILE_LIMITS, SourceApprovalFileError } from "./sourceApprovalFileLoader";

const paths: string[] = [];
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const env = { path: "ASSISTANT_CONVERSATION_APPROVAL_FILE", hash: "ASSISTANT_CONVERSATION_APPROVAL_SHA256" };
beforeEach(() => {
  vi.stubEnv(env.path, undefined); vi.stubEnv(env.hash, undefined);
  vi.stubEnv("PROFIT_ANALYSIS_APPROVAL_FILE", undefined); vi.stubEnv("PROFIT_ANALYSIS_APPROVAL_SHA256", undefined);
  vi.stubEnv("LISTING_DEEP_ANALYSIS_APPROVAL_FILE", undefined); vi.stubEnv("LISTING_DEEP_ANALYSIS_APPROVAL_SHA256", undefined);
  vi.stubEnv("LISTING_GENERATION_APPROVAL_FILE", undefined); vi.stubEnv("LISTING_GENERATION_APPROVAL_SHA256", undefined);
  vi.stubEnv("IMAGE_TAGGING_APPROVAL_FILE", undefined); vi.stubEnv("IMAGE_TAGGING_APPROVAL_SHA256", undefined);
  vi.stubEnv("IMAGE_PLANNING_APPROVAL_FILE", undefined); vi.stubEnv("IMAGE_PLANNING_APPROVAL_SHA256", undefined);
  vi.stubEnv("DEVELOPMENT_MARKET_APPROVAL_FILE", undefined); vi.stubEnv("DEVELOPMENT_MARKET_APPROVAL_SHA256", undefined);
  vi.stubEnv("KNOWLEDGE_QA_APPROVAL_FILE", undefined); vi.stubEnv("KNOWLEDGE_QA_APPROVAL_SHA256", undefined);
  vi.stubEnv("VIDEO_WORKFLOW_APPROVAL_FILE", undefined); vi.stubEnv("VIDEO_WORKFLOW_APPROVAL_SHA256", undefined);
});
afterEach(async () => { vi.unstubAllEnvs(); for (const path of paths.splice(0)) await rm(path, { recursive: true, force: true }); });
async function fixture(raw: unknown = { version: 1, kind: "assistant_conversation", records: [] }, bytes?: Buffer) {
  const directory = await mkdtemp(join(tmpdir(), "source-approval-unit-")); paths.push(directory);
  const path = join(directory, "approvals.json"), body = bytes ?? Buffer.from(JSON.stringify(raw));
  await writeFile(path, body, { mode: 0o600 }); vi.stubEnv(env.path, path); vi.stubEnv(env.hash, digest(body));
  return { directory, path, body };
}
const loader = (decode = vi.fn((records: unknown[]) => structuredClone(records))) => ({ load: createSourceApprovalFileLoader({ kind: "assistant_conversation", decode }), decode });

describe("explicit bounded server approval file admission", () => {
  it("is lazy, clearly unavailable without configuration, and can be configured after construction", async () => {
    const h = loader(); expect(await h.load()).toEqual({ status: "unavailable", reasonCode: "not_configured" }); expect(h.decode).not.toHaveBeenCalled();
    await fixture(); expect(await h.load()).toEqual({ status: "ready", value: [] }); expect(h.decode).toHaveBeenCalledOnce();
  });
  it.each(["missing_hash", "missing_path", "relative", "url", "non_json", "bad_hash", "empty", "dot_segment", "control_character"])("fails closed on %s configuration", async kind => {
    const f = await fixture(), h = loader();
    if (kind === "missing_hash") vi.stubEnv(env.hash, undefined);
    if (kind === "missing_path") vi.stubEnv(env.path, undefined);
    if (kind === "relative") vi.stubEnv(env.path, "local/approvals.json");
    if (kind === "url") vi.stubEnv(env.path, "https://example.invalid/approvals.json");
    if (kind === "non_json") vi.stubEnv(env.path, join(f.directory, "secret.env"));
    if (kind === "bad_hash") vi.stubEnv(env.hash, "not-a-sha256");
    if (kind === "empty") vi.stubEnv(env.path, "");
    if (kind === "dot_segment") vi.stubEnv(env.path, `${f.directory}/../approvals.json`);
    if (kind === "control_character") vi.stubEnv(env.path, `${f.path}\n`);
    await expect(h.load()).rejects.toMatchObject({ code: "CONFIGURATION_INVALID" }); expect(h.decode).not.toHaveBeenCalled();
  });
  it("rejects missing files and symlinks without leaking a path or operating-system error", async () => {
    const f = await fixture(), h = loader(), link = join(f.directory, "link.json");
    await symlink(f.path, link); vi.stubEnv(env.path, link);
    await expect(h.load()).rejects.toEqual(new SourceApprovalFileError("FILE_UNAVAILABLE"));
    vi.stubEnv(env.path, join(f.directory, "SENSITIVE_NONEXISTENT.json"));
    try { await h.load(); throw new Error("Expected rejection"); } catch (error) {
      expect(error).toMatchObject({ code: "FILE_UNAVAILABLE" }); expect(String(error)).not.toContain(f.directory); expect(String(error)).not.toContain("SENSITIVE"); expect((error as Error).cause).toBeUndefined();
    }
  });
  it("rejects directories and group/world-writable files", async () => {
    const f = await fixture(), h = loader(), directory = join(f.directory, "directory.json");
    await mkdir(directory); vi.stubEnv(env.path, directory); await expect(h.load()).rejects.toMatchObject({ code: "FILE_UNSAFE" });
    vi.stubEnv(env.path, f.path); await chmod(f.path, 0o620); await expect(h.load()).rejects.toMatchObject({ code: "FILE_UNSAFE" });
    await chmod(f.path, 0o602); await expect(h.load()).rejects.toMatchObject({ code: "FILE_UNSAFE" });
    expect(h.decode).not.toHaveBeenCalled();
  });
  it("rejects empty/oversized files before record decoding", async () => {
    const f = await fixture(), h = loader(); await writeFile(f.path, ""); await expect(h.load()).rejects.toMatchObject({ code: "FILE_LIMIT" });
    await writeFile(f.path, Buffer.alloc(SOURCE_APPROVAL_FILE_LIMITS.bytes + 1, 0x20)); await expect(h.load()).rejects.toMatchObject({ code: "FILE_LIMIT" }); expect(h.decode).not.toHaveBeenCalled();
  });
  it.each(["malformed", "invalid_utf8", "wrong_kind", "extra_field", "wrong_version", "wrong_records", "too_many_records", "deep_json"])("rejects %s document", async kind => {
    let document: unknown = { version: 1, kind: "assistant_conversation", records: [] }, bytes: Buffer | undefined;
    if (kind === "malformed") bytes = Buffer.from('{"private":"DO_NOT_LEAK');
    if (kind === "invalid_utf8") bytes = Buffer.from([0xff, 0xfe]);
    if (kind === "wrong_kind") document = { version: 1, kind: "profit_analysis", records: [] };
    if (kind === "extra_field") document = { version: 1, kind: "assistant_conversation", records: [], secret: "DO_NOT_LEAK" };
    if (kind === "wrong_version") document = { version: 2, kind: "assistant_conversation", records: [] };
    if (kind === "wrong_records") document = { version: 1, kind: "assistant_conversation", records: {} };
    if (kind === "too_many_records") document = { version: 1, kind: "assistant_conversation", records: Array.from({ length: 1001 }, () => null) };
    if (kind === "deep_json") { let nested: unknown = null; for (let i = 0; i < 42; i++) nested = { nested }; document = { version: 1, kind: "assistant_conversation", records: [nested] }; }
    await fixture(document, bytes); const h = loader(); await expect(h.load()).rejects.toMatchObject({ code: "DOCUMENT_INVALID" }); expect(h.decode).not.toHaveBeenCalled();
  });
  it("checks the complete raw byte hash before decoding and never uses a previously valid cached value", async () => {
    const f = await fixture({ version: 1, kind: "assistant_conversation", records: [{ id: "first" }] }), h = loader();
    expect(await h.load()).toEqual({ status: "ready", value: [{ id: "first" }] });
    const next = JSON.stringify({ version: 1, kind: "assistant_conversation", records: [{ id: "second" }] }); await writeFile(f.path, next);
    await expect(h.load()).rejects.toMatchObject({ code: "HASH_MISMATCH" }); expect(h.decode).toHaveBeenCalledOnce();
    vi.stubEnv(env.hash, digest(next)); expect(await h.load()).toEqual({ status: "ready", value: [{ id: "second" }] });
    await rm(f.path); await expect(h.load()).rejects.toMatchObject({ code: "FILE_UNAVAILABLE" });
  });
  it("sanitizes all caller schema/duplicate validation errors", async () => {
    const f = await fixture({ version: 1, kind: "assistant_conversation", records: [{ key: 1 }, { key: 1 }] });
    const h = loader(vi.fn(() => { throw new Error(`PRIVATE_BODY PRIVATE_KEY ${f.path}`); }));
    await expect(h.load()).rejects.toEqual(new SourceApprovalFileError("RECORDS_INVALID"));
  });
  it("isolates all nine domain files and never treats another configured domain as fallback", async () => {
    await fixture(); const finance = createSourceApprovalFileLoader({ kind: "profit_analysis", decode: rows => rows });
    const listing = createSourceApprovalFileLoader({ kind: "listing_deep_analysis", decode: rows => rows });
    expect(await finance()).toMatchObject({ status: "unavailable" }); expect(await listing()).toMatchObject({ status: "unavailable" });
    expect(await createSourceApprovalFileLoader({ kind: "image_tagging", decode: rows => rows })()).toMatchObject({ status: "unavailable" });
    expect(await createSourceApprovalFileLoader({ kind: "image_planning", decode: rows => rows })()).toMatchObject({ status: "unavailable" });
    expect(await createSourceApprovalFileLoader({ kind: "development_market", decode: rows => rows })()).toMatchObject({ status: "unavailable" });
    expect(await createSourceApprovalFileLoader({ kind: "knowledge_qa", decode: rows => rows })()).toMatchObject({ status: "unavailable" });
    expect(await createSourceApprovalFileLoader({ kind: "video_workflow", decode: rows => rows })()).toMatchObject({ status: "unavailable" });
    expect(await createSourceApprovalFileLoader({ kind: "listing_generation", decode: rows => rows })()).toMatchObject({ status: "unavailable" });
  });
  it("loads tagging only from its explicitly hashed domain file without approving decoded records", async () => {
    const f = await fixture({ version: 1, kind: "image_tagging", records: [{ synthetic: true }] });
    vi.stubEnv("IMAGE_TAGGING_APPROVAL_FILE", f.path); vi.stubEnv("IMAGE_TAGGING_APPROVAL_SHA256", digest(f.body));
    const decode = vi.fn(records => records), load = createSourceApprovalFileLoader({ kind: "image_tagging", decode });
    expect(await load()).toEqual({ status: "ready", value: [{ synthetic: true }] }); expect(decode).toHaveBeenCalledOnce();
    await expect(loader().load()).rejects.toMatchObject({ code: "DOCUMENT_INVALID" });
  });
  it.each([
    ["image_planning", "IMAGE_PLANNING_APPROVAL_FILE", "IMAGE_PLANNING_APPROVAL_SHA256"],
    ["development_market", "DEVELOPMENT_MARKET_APPROVAL_FILE", "DEVELOPMENT_MARKET_APPROVAL_SHA256"],
    ["knowledge_qa", "KNOWLEDGE_QA_APPROVAL_FILE", "KNOWLEDGE_QA_APPROVAL_SHA256"],
    ["video_workflow", "VIDEO_WORKFLOW_APPROVAL_FILE", "VIDEO_WORKFLOW_APPROVAL_SHA256"],
    ["listing_generation", "LISTING_GENERATION_APPROVAL_FILE", "LISTING_GENERATION_APPROVAL_SHA256"],
  ] as const)("keeps %s independently hashed and domain-specific", async (kind, path, hash) => {
    const f = await fixture({ version: 1, kind, records: [{ synthetic: true }] });
    vi.stubEnv(path, f.path); vi.stubEnv(hash, digest(f.body));
    const decode = vi.fn(records => records), load = createSourceApprovalFileLoader({ kind, decode });
    expect(await load()).toEqual({ status: "ready", value: [{ synthetic: true }] }); expect(decode).toHaveBeenCalledOnce();
    await expect(loader().load()).rejects.toMatchObject({ code: "DOCUMENT_INVALID" });
    const other = ({ image_planning: "development_market", development_market: "image_planning",
      knowledge_qa: "video_workflow", video_workflow: "knowledge_qa", listing_generation: "listing_deep_analysis" } as const)[kind];
    expect(await createSourceApprovalFileLoader({ kind: other, decode: records => records })()).toMatchObject({ status: "unavailable" });
  });

  it("does not reuse deep-research approval as permission to generate Listing text", async () => {
    const f = await fixture({ version: 1, kind: "listing_deep_analysis", records: [] });
    vi.stubEnv("LISTING_GENERATION_APPROVAL_FILE", f.path);
    vi.stubEnv("LISTING_GENERATION_APPROVAL_SHA256", digest(f.body));
    const decode = vi.fn(records => records);
    await expect(createSourceApprovalFileLoader({ kind: "listing_generation", decode })()).rejects.toMatchObject({ code: "DOCUMENT_INVALID" });
    expect(decode).not.toHaveBeenCalled();
  });
});
