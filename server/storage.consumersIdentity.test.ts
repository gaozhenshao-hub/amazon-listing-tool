import { createHash } from "node:crypto";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiJobHandlerRegistration, AiJobSnapshot } from "./domains/ai_os/services/jobRunner";

// Exercise the real consumers and real storage helpers with synthetic ENV,
// persistence, SDK, HTTP, queue and model boundaries. No real service is used.
const fixture = vi.hoisted(() => ({
  env: {
    storageProvider: "oss", s3Endpoint: "https://oss.example.test", s3PublicEndpoint: "",
    s3Region: "synthetic", s3Bucket: "private-bucket", s3AccessKeyId: "fixture-key",
    s3SecretAccessKey: "fixture-secret", s3ForcePathStyle: false, storagePresignExpiresSeconds: 900,
    forgeApiUrl: "https://forge.example.test", forgeApiKey: "fixture-forge",
  },
  row: {} as Record<string, unknown>, body: "synthetic artifact", assetUri: "storage://oss/gallery/image.png" as string | null,
  client: vi.fn(), get: vi.fn(), put: vi.fn(), sign: vi.fn(), http: vi.fn(), execute: vi.fn(),
  getDb: vi.fn(), requireDb: vi.fn(), transaction: vi.fn(), feedback: vi.fn(), skill: vi.fn(),
  createJob: vi.fn(), schedule: vi.fn(), cancel: vi.fn(), listJobs: vi.fn(), progress: vi.fn(), ensureRun: vi.fn(),
  subject: vi.fn(), selection: vi.fn(), assets: vi.fn(), latest: vi.fn(), facts: vi.fn(), updateSubject: vi.fn(),
  upsertFact: vi.fn(), createAnalysis: vi.fn(), nextVersion: vi.fn(),
  registrations: [] as AiJobHandlerRegistration[],
}));
vi.mock("./_core/env", () => ({ ENV: fixture.env }));
vi.mock("@aws-sdk/client-s3", () => ({ S3Client: fixture.client, GetObjectCommand: fixture.get, PutObjectCommand: fixture.put }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: fixture.sign }));
vi.mock("./infrastructure/http/safeHttpClient", () => ({ safeHttpRequest: fixture.http }));
vi.mock("./repositories/dbClient", () => ({ getDb: fixture.getDb, requireDb: fixture.requireDb, withDbTransaction: fixture.transaction }));
vi.mock("./domains/ai_os/services/harnessCompletion", () => ({ recordHarnessFeedback: fixture.feedback }));
vi.mock("./domains/ai_os/services/jobRunner", () => ({
  registerAiJobHandler: (registration: AiJobHandlerRegistration) => fixture.registrations.push(registration),
  createAiJobRun: fixture.createJob, scheduleAiJobRun: fixture.schedule, cancelAiJob: fixture.cancel,
  listAiJobRunsForUser: fixture.listJobs, updateAiJobProgress: fixture.progress,
}));
vi.mock("./domains/image/imageWorkflowAgentBridge", () => ({ ensureImageWorkflowAgentRun: fixture.ensureRun, imageWorkflowSkillNodeId: () => "synthetic-node" }));
vi.mock("./domains/image/routerContext", () => ({ callImageWorkflowSkill: fixture.skill }));
vi.mock("./domains/image/competitorGalleryRepository", () => ({
  getCompetitorResearchSubject: fixture.subject, getCompetitorGallerySelectionById: fixture.selection,
  listConfirmedAssets: fixture.assets, getLatestCompetitorGalleryAnalysis: fixture.latest,
  listCompetitorAssetFacts: fixture.facts, updateCompetitorResearchSubject: fixture.updateSubject,
  upsertCompetitorAssetFact: fixture.upsertFact, createCompetitorGalleryAnalysisVersion: fixture.createAnalysis,
  nextCompetitorGalleryAnalysisVersion: fixture.nextVersion,
}));

import { resolveUnifiedArtifact } from "./domains/ai_os/services/artifactLifecycle";
import { readCompleteAttributeText } from "./domains/listing/services/listingRawAttributeSource";
import "./domains/image/services/competitorGalleryJob";

const signed = "https://private-bucket.oss.example.test/current-signature";
const expired = "https://private-bucket.oss.example.test/cached-key?X-Amz-Signature=expired";
const dialect = new MySqlDialect();
const queries: Array<{ sql: string; params: unknown[] }> = [];
const galleryJob: AiJobSnapshot = {
  runId: "synthetic-gallery", kind: "image.step0.competitor.gallery.analysis", module: "imageWorkflow",
  procedure: "imageWorkflow.startCompetitorGalleryAnalysis", status: "running", progress: 0, priority: 1,
  queueName: "synthetic", attempt: 1, maxAttempts: 1, timeoutSeconds: 60, workspaceId: 42, userId: 7,
  projectId: 12, skillSlug: null, input: { projectId: 12, subjectId: 21, selectionVersionId: 31,
    selectionHash: "a".repeat(64), agentRunId: "synthetic-run", agentNodeId: "synthetic-node" },
  output: null, error: null, nextRunAt: null, leaseUntil: null, lockedBy: null, claimedAt: null,
  lastHeartbeatAt: null, deadLetterAt: null, deadLetterReason: null, recoveryOfRunId: null,
  recoveryReason: null, startedAt: null, completedAt: null, createdAt: new Date(0), updatedAt: new Date(0),
};

async function resolveArtifact() {
  const result = await resolveUnifiedArtifact({ artifactId: "synthetic-artifact", workspaceId: 42, domain: "file", artifactKey: "synthetic" });
  expect(queries).toHaveLength(1);
  expect(queries[0].sql).toMatch(/^SELECT a\.\*,s\.publicUrl/u);
  expect(queries[0].params).toEqual(["synthetic-artifact", 42]);
  return result;
}
function expectNoStorageEffects() {
  for (const spy of [fixture.client, fixture.get, fixture.put, fixture.sign, fixture.http]) expect(spy).not.toHaveBeenCalled();
}
function runGalleryHandler() {
  const registration = fixture.registrations.find(item => item.id === "imageWorkflow.competitorGalleryAnalysis");
  if (!registration) throw new Error("Real gallery job handler was not registered");
  return registration.handler(galleryJob, { signal: new AbortController().signal });
}
function sourceHash(value: string) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

beforeEach(() => {
  vi.resetAllMocks();
  queries.length = 0;
  fixture.env.storageProvider = "oss";
  fixture.body = "synthetic artifact";
  fixture.assetUri = "storage://oss/gallery/image.png";
  fixture.row = { artifactId: "synthetic-artifact", workspaceId: 42, domain: "file", artifactKey: "synthetic",
    version: 1, isCurrent: 1, status: "final", contentJson: null, artifactType: "text", storageUri: null, storagePublicUrl: null };
  fixture.client.mockImplementation(() => ({}));
  fixture.get.mockImplementation(input => ({ input }));
  fixture.sign.mockResolvedValue(signed);
  fixture.http.mockImplementation(async (input: URL | string) => {
    if (new URL(String(input)).pathname === "/v1/storage/downloadUrl") return { json: () => ({ url: signed }) };
    return { ok: true, status: 200, text: async () => fixture.body };
  });
  fixture.getDb.mockResolvedValue({ execute: fixture.execute });
  fixture.requireDb.mockResolvedValue({ synthetic: true });
  fixture.execute.mockImplementation(async (statement: Parameters<MySqlDialect["sqlToQuery"]>[0]) => {
    const query = dialect.sqlToQuery(statement);
    queries.push(query);
    if (!query.sql.startsWith("SELECT a.*,s.publicUrl") || !query.sql.includes("FROM ai_artifacts a")) {
      throw new Error("Only the artifact scoped SELECT is allowed in this fixture");
    }
    return [[fixture.row]];
  });
  fixture.subject.mockResolvedValue({ id: 21, confirmedSnapshotId: 41, asin: "B000000001", marketplace: "US" });
  fixture.selection.mockResolvedValue({ id: 31, status: "confirmed", selectionHash: "a".repeat(64), selectedAssetIds: [51] });
  fixture.assets.mockImplementation(async () => [{ id: 51, role: "main", positionIndex: 0, contentHash: "b".repeat(64), storageKey: fixture.assetUri }]);
  fixture.latest.mockResolvedValue(null);
  fixture.facts.mockResolvedValue([]);
  fixture.updateSubject.mockResolvedValue(undefined);
  fixture.skill.mockRejectedValue(new Error("Stopped at synthetic model boundary"));
});

describe("T25 artifact durable URI precedence", () => {
  it.each(["s3", "oss", "forge"])("resolves the matching %s URI instead of its expired cached URL", async provider => {
    fixture.env.storageProvider = provider;
    fixture.row.storageUri = `storage://${provider}/durable-key`;
    fixture.row.storagePublicUrl = expired;
    fixture.row.publicUrl = "https://external.example.test/also-cached";
    expect((await resolveArtifact())?.content).toBe(fixture.body);
    expect(fixture.http.mock.calls.map(call => String(call[0]))).not.toContain(expired);
    expect(String(fixture.http.mock.calls.at(-1)![0])).toBe(signed);
    if (provider !== "forge") expect(fixture.get).toHaveBeenCalledWith({ Bucket: "private-bucket", Key: "durable-key" });
  });

  it.each(["s3", "oss"])("loads %s artifacts with a durable URI and no cached public URL", async provider => {
    fixture.env.storageProvider = provider;
    fixture.row.storageUri = `storage://${provider}/durable-key`;
    expect((await resolveArtifact())?.content).toBe(fixture.body);
    expect(fixture.sign).toHaveBeenCalledOnce();
  });

  it.each(["s3", "forge", "unknown"])("fails closed for a mismatched %s URI even when a cached URL is available", async provider => {
    fixture.row.storageUri = `storage://${provider}/durable-key`;
    fixture.row.storagePublicUrl = expired;
    await expect(resolveArtifact()).rejects.toThrow(/provider does not match/);
    expectNoStorageEffects();
    expect(queries).toHaveLength(1);
  });

  it.each(["storagePublicUrl", "publicUrl", "storageUri"])("refreshes a same-bucket legacy URL in %s only when there is no durable URI", async field => {
    fixture.row[field] = expired;
    expect((await resolveArtifact())?.content).toBe(fixture.body);
    expect(fixture.get).toHaveBeenCalledWith({ Bucket: "private-bucket", Key: "cached-key" });
    expect(fixture.http.mock.calls.map(call => String(call[0]))).toEqual([signed]);
  });

  it("keeps existing external URL fallback without signing it as the current private object", async () => {
    const external = "https://other-bucket.oss.example.test/cached-key?X-Amz-Signature=external";
    fixture.row.publicUrl = external;
    expect((await resolveArtifact())?.content).toBe(fixture.body);
    expect(fixture.sign).not.toHaveBeenCalled();
    expect(fixture.http.mock.calls.map(call => String(call[0]))).toEqual([external]);
  });

  it("leaves inline JSON content unchanged and never resolves its stale storage fields", async () => {
    fixture.row.contentJson = '{"inline":true}';
    fixture.row.storageUri = "storage://unknown/unused";
    fixture.row.storagePublicUrl = expired;
    expect((await resolveArtifact())?.content).toEqual({ inline: true });
    expectNoStorageEffects();
  });

  it("retains null content when no inline data or storage reference exists", async () => {
    expect((await resolveArtifact())?.content).toBeNull();
    expectNoStorageEffects();
  });
});

describe("T25 complete Listing attribute source provider", () => {
  it.each(["s3", "oss", "forge"])("reads and hash-verifies a matching %s source", async provider => {
    fixture.env.storageProvider = provider;
    fixture.body = "A".repeat(4_000) + "\ncomplete source";
    await expect(readCompleteAttributeText({ rawContent: fixture.body.slice(0, 4_000),
      rawContentHash: sourceHash(fixture.body), rawStorageUri: `storage://${provider}/attributes/source` }, 42)).resolves.toBe(fixture.body);
    expect(String(fixture.http.mock.calls.at(-1)![0])).toBe(signed);
    expect(fixture.http.mock.calls.at(-1)![1]).toMatchObject({ auditContext: { workspaceId: 42, operation: "listing.product_attribute_source.read" } });
  });

  it.each(["s3", "forge"])("does not strip a mismatched %s provider before signing or reading source text", async provider => {
    fixture.body = "A".repeat(4_000) + "\ncomplete source";
    await expect(readCompleteAttributeText({ rawContent: fixture.body.slice(0, 4_000),
      rawContentHash: sourceHash(fixture.body), rawStorageUri: `storage://${provider}/attributes/source` }, 42)).rejects.toThrow(/provider does not match/);
    expectNoStorageEffects();
  });

  it("keeps a short inline source independent of stored URLs", async () => {
    await expect(readCompleteAttributeText({ rawContent: "inline source", rawStorageUri: "storage://unknown/unused" }, 42)).resolves.toBe("inline source");
    expectNoStorageEffects();
  });
});

describe("T25 competitor gallery confirmed asset provider", () => {
  it.each(["s3", "oss", "forge"])("uses the matching %s confirmed asset URI at the actual job handler", async provider => {
    fixture.env.storageProvider = provider;
    fixture.assetUri = `storage://${provider}/gallery/image.png`;
    await expect(runGalleryHandler()).rejects.toThrow("Stopped at synthetic model boundary");
    expect(fixture.skill).toHaveBeenCalledOnce();
    expect(fixture.skill.mock.calls[0][0]).toMatchObject({ workspaceId: 42,
      attachments: [{ type: "image_url", image_url: { url: signed, detail: "high" } }] });
    expect(fixture.upsertFact).not.toHaveBeenCalled();
    expect(fixture.createAnalysis).not.toHaveBeenCalled();
    expect(fixture.createJob).not.toHaveBeenCalled();
    expect(fixture.schedule).not.toHaveBeenCalled();
  });

  it.each(["s3", "forge", "unknown"])("rejects a mismatched %s confirmed asset before any signer/HTTP/model effect", async provider => {
    fixture.assetUri = `storage://${provider}/gallery/image.png`;
    await expect(runGalleryHandler()).rejects.toThrow(/provider does not match/);
    expectNoStorageEffects();
    expect(fixture.skill).not.toHaveBeenCalled();
    expect(fixture.upsertFact).not.toHaveBeenCalled();
    expect(fixture.createAnalysis).not.toHaveBeenCalled();
  });

  it.each([null, "https://external.example.test/image.png", "storage://oss/"])("rejects a missing or malformed confirmed storage reference %j", async reference => {
    fixture.assetUri = reference;
    await expect(runGalleryHandler()).rejects.toThrow(reference === null ? "竞品图片证据不完整" : "竞品图片缺少已确认S3证据");
    expectNoStorageEffects();
    expect(fixture.skill).not.toHaveBeenCalled();
  });
});
