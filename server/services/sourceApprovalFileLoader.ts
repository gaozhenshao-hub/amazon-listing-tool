import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import { TextDecoder } from "node:util";

/** Server-only, explicit deployment inputs. Constructing/importing this module
 * does not read environment values, files, a registry, credentials or a model. */
export const SOURCE_APPROVAL_FILE_LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, records: 1000, depth: 40, nodes: 200_000 });
const configuration = {
  assistant_conversation: { path: "ASSISTANT_CONVERSATION_APPROVAL_FILE", hash: "ASSISTANT_CONVERSATION_APPROVAL_SHA256" },
  profit_analysis: { path: "PROFIT_ANALYSIS_APPROVAL_FILE", hash: "PROFIT_ANALYSIS_APPROVAL_SHA256" },
  listing_deep_analysis: { path: "LISTING_DEEP_ANALYSIS_APPROVAL_FILE", hash: "LISTING_DEEP_ANALYSIS_APPROVAL_SHA256" },
  image_tagging: { path: "IMAGE_TAGGING_APPROVAL_FILE", hash: "IMAGE_TAGGING_APPROVAL_SHA256" },
  image_planning: { path: "IMAGE_PLANNING_APPROVAL_FILE", hash: "IMAGE_PLANNING_APPROVAL_SHA256" },
  development_market: { path: "DEVELOPMENT_MARKET_APPROVAL_FILE", hash: "DEVELOPMENT_MARKET_APPROVAL_SHA256" },
} as const;
export type SourceApprovalFileKind = keyof typeof configuration;
type ErrorCode = "CONFIGURATION_INVALID" | "FILE_UNAVAILABLE" | "FILE_UNSAFE" | "FILE_LIMIT" | "FILE_CHANGED" | "HASH_MISMATCH" | "DOCUMENT_INVALID" | "RECORDS_INVALID";
export class SourceApprovalFileError extends Error {
  constructor(readonly code: ErrorCode) { super(`SOURCE_APPROVAL_${code}`); this.name = "SourceApprovalFileError"; }
}
function fail(code: ErrorCode): never { throw new SourceApprovalFileError(code); }
function admitJson(value: unknown) {
  const pending = [{ value, depth: 0 }]; let nodes = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++nodes > SOURCE_APPROVAL_FILE_LIMITS.nodes || item.depth > SOURCE_APPROVAL_FILE_LIMITS.depth) fail("DOCUMENT_INVALID");
    if (typeof item.value === "number" && (!Number.isFinite(item.value) || Object.is(item.value, -0))) fail("DOCUMENT_INVALID");
    if (item.value && typeof item.value === "object") {
      for (const child of Object.values(item.value)) pending.push({ value: child, depth: item.depth + 1 });
    }
  }
}

export type SourceApprovalFileResult<T> = { status: "unavailable"; reasonCode: "not_configured" } | { status: "ready"; value: T };
/** The caller supplies its EXISTING schema and fixed resolver, including its
 * duplicate/source-policy validation. No file contents become approved merely
 * by passing a SHA check. Every invocation reopens/revalidates the file: no stale
 * approval cache survives removal, changed bytes, configuration or permissions. */
export function createSourceApprovalFileLoader<T>(input: { kind: SourceApprovalFileKind; decode: (records: unknown[]) => T }) {
  return async (): Promise<SourceApprovalFileResult<T>> => {
    try {
      const names = configuration[input.kind];
      const path = process.env[names.path], expectedHash = process.env[names.hash];
      if (path === undefined && expectedHash === undefined) return { status: "unavailable", reasonCode: "not_configured" };
      if (typeof path !== "string" || path.length > 4096 || !path || path.trim() !== path || /[\u0000-\u001f\u007f]/u.test(path)
        || !isAbsolute(path) || resolve(path) !== path || extname(path) !== ".json" || !/^[a-f0-9]{64}$/u.test(expectedHash ?? "")) fail("CONFIGURATION_INVALID");
      // O_NONBLOCK prevents an unexpected FIFO from hanging before fstat.
      // O_NOFOLLOW disallows symlink files; the configured parent directory must
      // also be deployment-controlled (not an upload/user-writable directory).
      if (typeof constants.O_NOFOLLOW !== "number" || typeof constants.O_NONBLOCK !== "number") fail("FILE_UNSAFE");
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      let bytes: Buffer;
      try {
        const before = await file.stat();
        if (!before.isFile() || (before.mode & 0o022) !== 0) fail("FILE_UNSAFE");
        if (!Number.isSafeInteger(before.size) || before.size < 1 || before.size > SOURCE_APPROVAL_FILE_LIMITS.bytes) fail("FILE_LIMIT");
        const buffer = Buffer.alloc(Math.min(before.size + 1, SOURCE_APPROVAL_FILE_LIMITS.bytes + 1)); let offset = 0;
        while (offset < buffer.length) {
          const result = await file.read(buffer, offset, buffer.length - offset, offset);
          if (result.bytesRead === 0) break; offset += result.bytesRead;
        }
        const after = await file.stat();
        if (offset > SOURCE_APPROVAL_FILE_LIMITS.bytes) fail("FILE_LIMIT");
        if (!after.isFile() || (after.mode & 0o022) !== 0) fail("FILE_UNSAFE");
        if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.size !== offset
          || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail("FILE_CHANGED");
        bytes = buffer.subarray(0, offset);
      } finally { await file.close(); }
      if (process.env[names.path] !== path || process.env[names.hash] !== expectedHash) fail("FILE_CHANGED");
      if (createHash("sha256").update(bytes).digest("hex") !== expectedHash) fail("HASH_MISMATCH");
      let raw: unknown;
      try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
      catch { return fail("DOCUMENT_INVALID"); }
      admitJson(raw);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("DOCUMENT_INVALID");
      const document = raw as Record<string, unknown>;
      if (Object.keys(document).length !== 3 || document.version !== 1 || document.kind !== input.kind
        || !Array.isArray(document.records) || document.records.length > SOURCE_APPROVAL_FILE_LIMITS.records) fail("DOCUMENT_INVALID");
      try { return { status: "ready", value: input.decode(document.records) }; }
      catch { return fail("RECORDS_INVALID"); }
    } catch (error) {
      // No raw filesystem/Zod/callback exception, path, file body, hash or cause
      // is retained in any public error object.
      if (error instanceof SourceApprovalFileError) throw error;
      return fail("FILE_UNAVAILABLE");
    }
  };
}
