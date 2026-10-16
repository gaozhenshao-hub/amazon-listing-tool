import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import type { CompetitorAnalysis } from "../../../drizzle/schema/project";
import { getDb, type DbExecutor } from "../dbClient";

export const MAX_REVIEW_JOB_INPUT_BYTES = 32 * 1024 * 1024;
export const MAX_REVIEW_SOURCE_CANDIDATES = 20;
export type ReviewJobScope = { userId: number; projectId: number; workspaceId: number | null };
export type ReviewJobCandidate = { runId: string; inputBytes: number; inputHash: string };
export interface ReviewReadDatabase { transaction?<T>(callback: (tx: DbExecutor) => Promise<T>): Promise<T> }
export function reviewReadError(code: "CONFLICT" | "PRECONDITION_FAILED" | "FORBIDDEN" | "NOT_FOUND" | "INTERNAL_SERVER_ERROR", message: string): never {
  throw new TRPCError({ code, message });
}
function statement(text: string, values: unknown[]): SQL {
  const parts = text.split("?");
  if (parts.length !== values.length + 1) throw new Error("COMPETITOR_REVIEWS_SQL_BIND_INVALID");
  return sql.join(parts.flatMap((part, index) => index < values.length ? [sql.raw(part), sql`${values[index]}`] : [sql.raw(part)]), sql.raw(""));
}
function storageError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  let current = error;
  for (let i = 0; i < 5 && current && typeof current === "object"; i++) {
    const e = current as { errno?: number; cause?: unknown };
    if (e.errno === 1146 || e.errno === 1054) reviewReadError("PRECONDITION_FAILED", "COMPETITOR_REVIEWS_SCHEMA_UNAVAILABLE");
    current = e.cause;
  }
  // Do not expose SQL, original uploaded text or driver parameters in RPC errors.
  return reviewReadError("INTERNAL_SERVER_ERROR", "COMPETITOR_REVIEWS_STORAGE_FAILED");
}
export function competitorReviewReadSession(executor: DbExecutor) {
  async function rows(text: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
    try {
      const result = await executor.execute(statement(text, values));
      if (!Array.isArray(result) || !Array.isArray(result[0])) reviewReadError("INTERNAL_SERVER_ERROR", "COMPETITOR_REVIEWS_READ_INVALID");
      return result[0];
    } catch (error) { return storageError(error); }
  }
  const sourceWhere = "userId=? AND projectId=? AND workspaceId<=>? AND module='listing' AND kind='analysis.import.reviews'";
  // JSON_CONTAINS alone also accepts an object or a recursively nested array.
  // Require a producer-shaped direct results[] member, not an incidental match.
  const receiptWhere = `JSON_TYPE(output)='OBJECT' AND JSON_TYPE(JSON_EXTRACT(output,'$.results'))='ARRAY'
    AND EXISTS (SELECT 1 FROM JSON_TABLE(output,'$.results[*]' COLUMNS (item JSON PATH '$')) AS review_receipt
      WHERE JSON_TYPE(review_receipt.item)='OBJECT'
        AND JSON_TYPE(JSON_EXTRACT(review_receipt.item,'$.analysisId'))='INTEGER'
        AND JSON_UNQUOTE(JSON_EXTRACT(review_receipt.item,'$.analysisId'))=CAST(? AS CHAR)
        AND JSON_TYPE(JSON_EXTRACT(review_receipt.item,'$.asin'))='STRING'
        AND BINARY JSON_UNQUOTE(JSON_EXTRACT(review_receipt.item,'$.asin'))=BINARY ?
        AND BINARY JSON_UNQUOTE(JSON_EXTRACT(review_receipt.item,'$.status')) IN ('matched','new'))`;
  const scopeValues = (scope: ReviewJobScope) => [scope.userId, scope.projectId, scope.workspaceId];
  return {
    executor,
    async user(userId: number) { return (await rows("SELECT id,status,role,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", [userId]))[0] ?? null; },
    async project(projectId: number) { return (await rows("SELECT id,userId,workspaceId FROM projects WHERE id=? FOR SHARE", [projectId]))[0] ?? null; },
    async analysis(projectId: number, analysisId: number): Promise<CompetitorAnalysis | null> {
      return (await rows("SELECT * FROM competitorAnalyses WHERE projectId=? AND id=? FOR SHARE", [projectId, analysisId]))[0] as CompetitorAnalysis ?? null;
    },
    async candidates(scope: ReviewJobScope, fileName: string, analysisId: number, asin: string): Promise<ReviewJobCandidate[]> {
      // Only metadata crosses this first query. Exact successful per-ASIN receipt,
      // owner and parent scope precede LIMIT; never sort uploaded Base64 payloads.
      const result = await rows(`SELECT runId,OCTET_LENGTH(CAST(input AS CHAR CHARACTER SET utf8mb4)) AS inputBytes,
        SHA2(CAST(input AS CHAR CHARACTER SET utf8mb4),256) AS inputHash FROM ai_jobs WHERE ${sourceWhere}
        AND status IN ('succeeded','failed','canceled')
        AND BINARY JSON_UNQUOTE(JSON_EXTRACT(input,'$.filename'))=BINARY ?
        AND ${receiptWhere}
        ORDER BY id DESC LIMIT 21`, [...scopeValues(scope), fileName, analysisId, asin]);
      return result.map(row => {
        if (typeof row.runId !== "string" || !/^analysis_import_[a-f0-9]{48}(?:_\d{1,2})?$/u.test(row.runId)
          || !Number.isSafeInteger(Number(row.inputBytes)) || Number(row.inputBytes) <= 0
          || typeof row.inputHash !== "string" || !/^[a-f0-9]{64}$/u.test(row.inputHash)) reviewReadError("PRECONDITION_FAILED", "COMPETITOR_REVIEWS_SOURCE_INVALID");
        return { runId: row.runId, inputBytes: Number(row.inputBytes), inputHash: row.inputHash };
      });
    },
    async payload(scope: ReviewJobScope, candidate: ReviewJobCandidate): Promise<string | null> {
      if (candidate.inputBytes > MAX_REVIEW_JOB_INPUT_BYTES) reviewReadError("PRECONDITION_FAILED", "COMPETITOR_REVIEWS_SOURCE_TOO_LARGE");
      const found = await rows(`SELECT CAST(input AS CHAR CHARACTER SET utf8mb4) AS inputJson FROM ai_jobs WHERE ${sourceWhere}
        AND runId=? AND status IN ('succeeded','failed','canceled')
        AND OCTET_LENGTH(CAST(input AS CHAR CHARACTER SET utf8mb4))<=? AND SHA2(CAST(input AS CHAR CHARACTER SET utf8mb4),256)=?`,
      [...scopeValues(scope), candidate.runId, MAX_REVIEW_JOB_INPUT_BYTES, candidate.inputHash]);
      if (!found.length) return null;
      if (found.length !== 1 || typeof found[0].inputJson !== "string" || Buffer.byteLength(found[0].inputJson, "utf8") > MAX_REVIEW_JOB_INPUT_BYTES)
        reviewReadError("PRECONDITION_FAILED", "COMPETITOR_REVIEWS_SOURCE_INVALID");
      return found[0].inputJson;
    },
    async stillCurrent(scope: ReviewJobScope, candidate: ReviewJobCandidate, fileName: string, analysisId: number, asin: string) {
      const found = await rows(`SELECT runId FROM ai_jobs WHERE ${sourceWhere} AND runId=?
        AND status IN ('succeeded','failed','canceled') AND SHA2(CAST(input AS CHAR CHARACTER SET utf8mb4),256)=?
        AND BINARY JSON_UNQUOTE(JSON_EXTRACT(input,'$.filename'))=BINARY ?
        AND ${receiptWhere}`,
      [...scopeValues(scope), candidate.runId, candidate.inputHash, fileName, analysisId, asin]);
      return found.length === 1 && found[0].runId === candidate.runId;
    },
  };
}
export type CompetitorReviewReadSession = ReturnType<typeof competitorReviewReadSession>;
export function createCompetitorReviewReadRepository(load: () => Promise<ReviewReadDatabase | null> = getDb) {
  return { async transaction<T>(callback: (session: CompetitorReviewReadSession) => Promise<T>): Promise<T> {
    try {
      const database = await load();
      if (!database || typeof database.transaction !== "function") reviewReadError("PRECONDITION_FAILED", "COMPETITOR_REVIEWS_TRANSACTION_REQUIRED");
      return await database.transaction(tx => callback(competitorReviewReadSession(tx)));
    } catch (error) { return storageError(error); }
  } };
}
export const competitorReviewReadRepository = createCompetitorReviewReadRepository();
