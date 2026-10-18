import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { S3ClientConfig } from "@aws-sdk/client-s3";

const state = vi.hoisted(() => ({
  env: { storageProvider: "s3", s3Region: "us-east-1", s3Bucket: "synthetic-test", s3AccessKeyId: "synthetic-key", s3SecretAccessKey: "synthetic-secret", s3Endpoint: "https://objects.example.test", s3PublicEndpoint: "", s3ForcePathStyle: true, storagePresignExpiresSeconds: 60, storagePrivateObjects: true, privateEvidencePreviewPresignExpiresSeconds: 60 },
  attempts: vi.fn(async (): Promise<never> => { const error = new Error("synthetic timeout; no network handler"); error.name = "TimeoutError"; throw error; }),
  clients: [] as S3ClientConfig[],
}));
vi.mock("./_core/env", () => ({ ENV: state.env }));
vi.mock("./infrastructure/http/safeHttpClient", () => ({ safeHttpRequest: vi.fn(async () => { throw new Error("Real network is forbidden in this test"); }) }));
vi.mock("@aws-sdk/client-s3", async importOriginal => {
  const sdk = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return { ...sdk, S3Client: class extends sdk.S3Client {
    constructor(config: S3ClientConfig) {
      state.clients.push(config);
      // This is the real SDK serialization/retry/signing middleware. Only its
      // final transport handler is replaced, so no DNS or network can occur.
      super({ ...config, requestHandler: { handle: state.attempts, destroy() {} } });
    }
  } };
});

import { storagePut, type StoragePutOptions } from "./storage";
import { createMonthlyFinancialImportStorage } from "./domains/ops/monthlyFinancialImportStorage";
import { monthlyFinancialWriteHash } from "../shared/monthlyFinancialWrite";
import { monthlyFinancialImportBytesHash } from "../shared/monthlyFinancialImport";

beforeEach(() => { state.attempts.mockClear(); state.clients.length = 0; state.env.storageProvider = "s3"; vi.stubEnv("AWS_MAX_ATTEMPTS", "3"); vi.stubEnv("AWS_RETRY_MODE", "standard"); });
afterEach(() => vi.unstubAllEnvs());

describe("S3/OSS opt-in single transport attempt", () => {
  it.each(["s3", "oss"])("%s explicit one-attempt override prevents SDK timeout retries", async provider => {
    state.env.storageProvider = provider;
    await expect(storagePut("test/original.csv", Buffer.from("test"), "text/csv", { maxAttempts: 1 })).rejects.toThrow("synthetic timeout");
    expect(state.attempts).toHaveBeenCalledTimes(1); expect(state.clients[0].maxAttempts).toBe(1);
  });
  it("old three-argument callers retain SDK/environment retry configuration", async () => {
    await expect(storagePut("test/legacy.csv", Buffer.from("test"), "text/csv")).rejects.toThrow("synthetic timeout");
    expect(state.attempts).toHaveBeenCalledTimes(3); expect(state.clients[0]).not.toHaveProperty("maxAttempts");
  });
  it("empty options preserve legacy behavior rather than implicitly disabling retries", async () => {
    await expect(storagePut("test/legacy.csv", Buffer.from("test"), "text/csv", {})).rejects.toThrow("synthetic timeout");
    expect(state.attempts).toHaveBeenCalledTimes(3); expect(state.clients[0]).not.toHaveProperty("maxAttempts");
  });
  it.each([0, 2, Infinity, NaN, "1"])("rejects unsupported maxAttempts %s before client/transport creation", async maxAttempts => {
    await expect(storagePut("test/original.csv", Buffer.from("test"), "text/csv", { maxAttempts } as StoragePutOptions)).rejects.toThrow("maxAttempts: 1");
    expect(state.clients).toHaveLength(0); expect(state.attempts).not.toHaveBeenCalled();
  });
  it("cannot promise single S3 attempt through the Forge provider", async () => {
    state.env.storageProvider = "forge";
    await expect(storagePut("test/original.csv", Buffer.from("test"), "text/csv", { maxAttempts: 1 })).rejects.toThrow("requires S3/OSS");
    expect(state.clients).toHaveLength(0); expect(state.attempts).not.toHaveBeenCalled();
  });
  it("monthly adapter reaches the real SDK once and reports an unknown PUT safely", async () => {
    const storage = createMonthlyFinancialImportStorage(), identity = { userId: 3, workspaceId: 7 }, operationId = "11111111-1111-4111-8111-111111111111", bytes = Buffer.from("synthetic monthly original"), file = { fileName: "a.csv", format: "csv" as const, fileHash: monthlyFinancialImportBytesHash(bytes), byteSize: bytes.length };
    const prepared = storage.prepare(identity, operationId, { ...file, requestHash: monthlyFinancialWriteHash({ action: "upload", expectedWorkspaceId: 7, operationId, ...file }) });
    await expect(storage.putOnce(prepared, bytes)).rejects.toThrow("MONTHLY_STORAGE_PUT_UNCONFIRMED");
    expect(state.attempts).toHaveBeenCalledTimes(1); expect(state.clients[0].maxAttempts).toBe(1);
  });
});
