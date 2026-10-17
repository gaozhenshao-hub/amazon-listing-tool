import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { TrpcContext } from "../../../_core/context";
import type { CompetitorReviewCorpus, CompetitorReviewPage } from "../../../../shared/competitorReviewCorpus";
import { competitorRevision } from "../../../repositories/project/competitorWritePolicy";
import { competitorReviewReadRepository, reviewReadError, MAX_REVIEW_SOURCE_CANDIDATES,
  MAX_REVIEW_JOB_INPUT_BYTES, type CompetitorReviewReadSession, type ReviewJobCandidate, type ReviewJobScope } from "../../../repositories/listing/competitorReviewReadRepository";
import { assertResourceAction } from "../../../services/securityGovernance";
import { buildCompetitorReviewCorpus, CompetitorReviewCorpusError } from "./competitorReviewCorpus";

const id = z.number().int().positive().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const competitorReviewsPageSchema = z.object({
  projectId: id, analysisId: id, expectedWorkspaceId: id.nullable(),
  expectedCorpusHash: hash.optional(), page: z.number().int().min(1).max(20_001).default(1),
  pageSize: z.number().int().min(1).max(50).default(30),
}).strict().refine(value => value.page === 1 || value.expectedCorpusHash !== undefined, { message: "A fixed corpus is required after page one" });
type Request = z.infer<typeof competitorReviewsPageSchema>;
// Server-only complete read: pagination is a presentation concern, never the
// input boundary for research. Callers may pin both the row and original file.
export const competitorReviewSourceSchema = z.object({
  projectId: id, analysisId: id, expectedWorkspaceId: id.nullable(),
  expectedRevision: hash.optional(), expectedCorpusHash: hash.optional(),
}).strict();
type SourceRequest = z.infer<typeof competitorReviewSourceSchema>;
export type AuthorizedCompetitorReviewSource = {
  identity: { userId: number; workspaceId: number | null; sourceWorkspaceId: number | null;
    projectId: number; analysisId: number; asin: string; revision: string };
  listing: { title: string | null; bulletPoints: string | null };
  reviews: { status: "available"; authorizedCorpusHash: string;
    source: { runId: string; fileName: string; fileHash: string }; corpus: CompetitorReviewCorpus }
    | { status: "unavailable"; reason: string };
};
type Scope = ReviewJobScope & { analysisId: number };
const defaults = { repository: competitorReviewReadRepository, permission: assertResourceAction, parse: buildCompetitorReviewCorpus };
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function sourceMeta(raw: string | null): { fileHash: string; fileName: string } | null {
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return reviewReadError("PRECONDITION_FAILED", "COMPETITOR_REVIEWS_METADATA_INVALID"); }
  if (!object(parsed)) return reviewReadError("PRECONDITION_FAILED", "COMPETITOR_REVIEWS_METADATA_INVALID");
  if (parsed.reviewImport == null) return null;
  const meta = parsed.reviewImport;
  if (!object(meta) || typeof meta.sourceHash !== "string" || !hash.safeParse(meta.sourceHash).success
    || typeof meta.filename !== "string" || !meta.filename.trim() || meta.filename.length > 255)
    return reviewReadError("PRECONDITION_FAILED", "COMPETITOR_REVIEWS_METADATA_INVALID");
  return { fileHash: meta.sourceHash, fileName: meta.filename };
}
function decodeFile(payload: string, scope: Scope, fileName: string, candidate: ReviewJobCandidate): Buffer {
  if (Buffer.byteLength(payload, "utf8") !== candidate.inputBytes || digest(payload) !== candidate.inputHash)
    reviewReadError("CONFLICT", "COMPETITOR_REVIEWS_SOURCE_CHANGED");
  let value: unknown;
  try { value = JSON.parse(payload); } catch { return reviewReadError("PRECONDITION_FAILED", "COMPETITOR_REVIEWS_SOURCE_INVALID"); }
  const maximum = 20 * 1024 * 1024, maxBase64 = Math.ceil(maximum / 3) * 4;
  if (!object(value) || value.kind !== "reviews" || value.projectId !== scope.projectId || value.filename !== fileName
    || typeof value.fileBase64 !== "string" || !value.fileBase64 || value.fileBase64.length > maxBase64
    || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value.fileBase64)) reviewReadError("PRECONDITION_FAILED", "COMPETITOR_REVIEWS_SOURCE_INVALID");
  const bytes = Buffer.from(value.fileBase64, "base64");
  if (!bytes.length || bytes.length > maximum || bytes.toString("base64") !== value.fileBase64)
    reviewReadError("PRECONDITION_FAILED", "COMPETITOR_REVIEWS_SOURCE_INVALID");
  return bytes;
}
function safeError(error: unknown): never {
  if (error instanceof TRPCError && /^COMPETITOR_REVIEWS_[A-Z_]+$/u.test(error.message)) throw error;
  if (error instanceof z.ZodError) throw new TRPCError({ code: "BAD_REQUEST", message: "COMPETITOR_REVIEWS_INPUT_INVALID" });
  if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(error.code))
    throw new TRPCError({ code: error.code, message: "COMPETITOR_REVIEWS_ACCESS_DENIED" });
  // Parser errors are mapped without carrying cells, archive filenames or causes.
  if (error instanceof CompetitorReviewCorpusError)
    reviewReadError("PRECONDITION_FAILED", "COMPETITOR_REVIEWS_FILE_UNSUPPORTED_OR_INVALID");
  return reviewReadError("INTERNAL_SERVER_ERROR", "COMPETITOR_REVIEWS_READ_FAILED");
}
/** Read the exact authorized original, never reconstruct reviews from model quotes.
 * No model invocation, new database table, file upload or corpus write occurs. */
export function createCompetitorReviewReadService(dependencies: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...dependencies };
  async function authorized(session: CompetitorReviewReadSession, scope: Scope) {
    const user = await session.user(scope.userId);
    if (!user || user.id !== scope.userId || user.status !== "active" || user.defaultWorkspaceId !== scope.workspaceId || typeof user.role !== "string")
      reviewReadError("FORBIDDEN", "COMPETITOR_REVIEWS_ACTOR_CHANGED");
    // Omit ownerUserId: ownership must not bypass explicit project.read policy.
    await deps.permission({ actor: { id: scope.userId, role: user.role, defaultWorkspaceId: scope.workspaceId },
      resource: "project", action: "read", workspaceId: scope.workspaceId, projectId: scope.projectId, resourceId: scope.projectId,
      authorizationRead: { executor: session.executor, strict: true, lock: true } });
    const parent = await session.project(scope.projectId);
    if (!parent || parent.id !== scope.projectId || parent.userId !== scope.userId
      || (parent.workspaceId !== null && parent.workspaceId !== scope.workspaceId)) reviewReadError("NOT_FOUND", "COMPETITOR_REVIEWS_PROJECT_UNAVAILABLE");
    const row = await session.analysis(scope.projectId, scope.analysisId);
    if (!row || row.id !== scope.analysisId || row.projectId !== scope.projectId || !/^[A-Z0-9]{10}$/u.test(row.asin))
      reviewReadError("NOT_FOUND", "COMPETITOR_REVIEWS_ANALYSIS_UNAVAILABLE");
    return { revision: competitorRevision(row), asin: row.asin, meta: sourceMeta(row.rawData),
      listing: { title: row.title, bulletPoints: row.bulletPoints },
      jobScope: { userId: scope.userId, projectId: scope.projectId, workspaceId: parent.workspaceId as number | null } };
  }
  async function readFullCorpus(ctx: TrpcContext, raw: SourceRequest): Promise<AuthorizedCompetitorReviewSource> {
    try {
      const input = competitorReviewSourceSchema.parse(raw);
      const workspaceId = ctx.workspaceId !== undefined ? ctx.workspaceId : ctx.user?.defaultWorkspaceId;
      if (!ctx.user || !id.safeParse(ctx.user.id).success || (workspaceId !== null && !id.safeParse(workspaceId).success))
        reviewReadError("FORBIDDEN", "COMPETITOR_REVIEWS_ACTOR_INVALID");
      if (workspaceId !== input.expectedWorkspaceId) reviewReadError("PRECONDITION_FAILED", "COMPETITOR_REVIEWS_WORKSPACE_CHANGED");
      const scope: Scope = { userId: ctx.user.id, projectId: input.projectId, analysisId: input.analysisId, workspaceId: workspaceId as number | null };
      const initial = await deps.repository.transaction(async session => {
        const owned = await authorized(session, scope);
        if (input.expectedRevision !== undefined && input.expectedRevision !== owned.revision)
          reviewReadError("CONFLICT", "COMPETITOR_REVIEWS_SOURCE_CHANGED");
        const candidates = owned.meta ? await session.candidates(owned.jobScope, owned.meta.fileName, scope.analysisId, owned.asin) : [];
        if (candidates.length > MAX_REVIEW_SOURCE_CANDIDATES) reviewReadError("PRECONDITION_FAILED", "COMPETITOR_REVIEWS_SOURCE_HISTORY_LIMIT");
        return { ...owned, candidates };
      });
      async function revalidate(session: CompetitorReviewReadSession, candidate?: ReviewJobCandidate) {
        const now = await authorized(session, scope);
        if (now.revision !== initial.revision || now.jobScope.workspaceId !== initial.jobScope.workspaceId)
          reviewReadError("CONFLICT", "COMPETITOR_REVIEWS_SOURCE_CHANGED");
        if (candidate && (!initial.meta || !await session.stillCurrent(initial.jobScope, candidate, initial.meta.fileName, scope.analysisId, initial.asin)))
          reviewReadError("CONFLICT", "COMPETITOR_REVIEWS_SOURCE_CHANGED");
      }
      const binding = { identity: { ...scope, sourceWorkspaceId: initial.jobScope.workspaceId,
        asin: initial.asin, revision: initial.revision }, listing: initial.listing };
      const unavailable = async (reason: string): Promise<AuthorizedCompetitorReviewSource> => {
        await deps.repository.transaction(session => revalidate(session));
        if (input.expectedCorpusHash) reviewReadError("CONFLICT", "COMPETITOR_REVIEWS_SOURCE_CHANGED");
        return { ...binding, reviews: { status: "unavailable", reason } };
      };
      if (!initial.meta) return await unavailable("未记录可核验的评论原文件；已有 AI 摘要不等于原评论，商品累计评论数也不是可读取数量。");
      if (!initial.candidates.length) return await unavailable("未找到当前来源对应且有成功回执的原文件任务；旧同步导入或原任务已删除时，无法由摘要恢复原评论。");
      let bytesExamined = 0;
      for (const candidate of initial.candidates) {
        bytesExamined += candidate.inputBytes;
        if (candidate.inputBytes > MAX_REVIEW_JOB_INPUT_BYTES || bytesExamined > 64 * 1024 * 1024)
          reviewReadError("PRECONDITION_FAILED", "COMPETITOR_REVIEWS_SOURCE_HISTORY_LIMIT");
        const payload = await deps.repository.transaction(async session => {
          await revalidate(session, candidate);
          return session.payload(initial.jobScope, candidate);
        });
        if (payload === null) reviewReadError("CONFLICT", "COMPETITOR_REVIEWS_SOURCE_CHANGED");
        const bytes = decodeFile(payload, scope, initial.meta.fileName, candidate);
        if (digest(bytes) !== initial.meta.fileHash) continue;
        const corpus = deps.parse({ bytes, fileName: initial.meta.fileName, asin: initial.asin,
          projectId: scope.projectId, analysisId: scope.analysisId, sourceFileHash: initial.meta.fileHash });
        const corpusHash = digest(JSON.stringify({ version: 1, userId: scope.userId, workspaceId: scope.workspaceId,
          sourceWorkspaceId: initial.jobScope.workspaceId, runId: candidate.runId, corpusHash: corpus.corpusHash }));
        if (input.expectedCorpusHash !== undefined && input.expectedCorpusHash !== corpusHash)
          reviewReadError("CONFLICT", "COMPETITOR_REVIEWS_CORPUS_CHANGED");
        await deps.repository.transaction(session => revalidate(session, candidate));
        return { ...binding, reviews: { status: "available", authorizedCorpusHash: corpusHash,
          source: { runId: candidate.runId, fileName: initial.meta.fileName, fileHash: initial.meta.fileHash }, corpus } };
      }
      return await unavailable("当前有权访问的导入任务中未找到与评论来源哈希一致的原文件；同名文件不能替代原文证据。");
    } catch (error) { return safeError(error); }
  }
  async function list(ctx: TrpcContext, raw: Request): Promise<CompetitorReviewPage> {
    try {
      const { page, pageSize, ...input } = competitorReviewsPageSchema.parse(raw);
      const result = await readFullCorpus(ctx, input);
      const { projectId, analysisId, asin } = result.identity;
      if (result.reviews.status === "unavailable") return {
        status: "unavailable", reason: result.reviews.reason, projectId, analysisId, asin,
        parserVersion: null, corpusHash: null, source: null, coverage: null, items: [], page, pageSize, total: null,
      };
      const { corpus, source, authorizedCorpusHash: corpusHash } = result.reviews;
      const start = (page - 1) * pageSize;
      if (page > 1 && start >= corpus.items.length) reviewReadError("PRECONDITION_FAILED", "COMPETITOR_REVIEWS_PAGE_OUT_OF_RANGE");
      return { status: "available", reason: null, projectId, analysisId, asin, corpusHash, parserVersion: corpus.parserVersion,
        source, coverage: corpus.coverage, items: corpus.items.slice(start, start + pageSize), page, pageSize, total: corpus.items.length };
    } catch (error) { return safeError(error); }
  }
  return { list, readFullCorpus };
}
export const competitorReviewRead = createCompetitorReviewReadService();
