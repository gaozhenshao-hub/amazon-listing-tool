import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { listingFactRevisions } from "../../../../drizzle/schema/listingRevisions";
import { isTemplateOrEmptyFact } from "../../../../shared/listingFactSafety";
import { getDb, getProjectFilesByProject } from "../repository";
import { readCompleteAttributeText } from "./listingRawAttributeSource";
import { parseRawAttributeFacts } from "./listingRawFacts";

export async function getCurrentRawFactSuggestions(projectId: number, workspaceId: number) {
  const files = await getProjectFilesByProject(projectId);
  const file = files.filter((entry) => entry.fileType === "product_attributes")
    .sort((left, right) => Number(right.createdAt) - Number(left.createdAt) || right.id - left.id)[0];
  if (!file || file.lifecycleState === "deleted") return { status: "no_source" as const, file: null, suggestions: [] };
  if (file.workspaceId !== workspaceId) throw new Error("最新属性文件未绑定当前工作空间，请重新上传后审核");
  if (file.status !== "completed") return { status: "source_not_ready" as const, file: null, suggestions: [] };
  if (!file.rawContentHash) return { status: "legacy_unverified" as const, file: null, suggestions: [] };
  const raw = await readCompleteAttributeText(file, workspaceId);
  const hash = createHash("sha256").update(JSON.stringify(raw.replace(/\r\n?/gu, "\n").trim())).digest("hex");
  if (hash !== file.rawContentHash) throw new Error("属性文件原文已变化，请重新上传后再核对事实");
  return { status: "reviewable" as const, file: { id: file.id, rawHash: hash, createdAt: file.createdAt },
    suggestions: parseRawAttributeFacts(raw) };
}

function factLedgerUnavailable(message: string): never {
  throw new TRPCError({ code: "PRECONDITION_FAILED", message });
}

/**
 * Resolves the only facts that may be supplied to a fact-bound Listing model job.
 * The raw-file read is intentionally repeated here: a queued job must not inherit
 * a fact revision after its original upload has changed or become unavailable.
 */
export async function resolveCurrentConfirmedListingFacts(input: {
  projectId: number;
  workspaceId: number;
}) {
  let source: Awaited<ReturnType<typeof getCurrentRawFactSuggestions>>;
  try {
    source = await getCurrentRawFactSuggestions(input.projectId, input.workspaceId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "无法读取当前原始属性文件";
    return factLedgerUnavailable(`0204事实账本无法核验当前原始文件：${detail}`);
  }
  if (source.status !== "reviewable" || !source.file) {
    const reason = {
      no_source: "未找到当前原始属性文件",
      source_not_ready: "当前原始属性文件尚未解析完成",
      legacy_unverified: "当前原始属性文件缺少哈希，无法作为0204事实依据",
    }[source.status];
    return factLedgerUnavailable(`${reason}；请上传并人工确认至少一条真实产品事实后再生成`);
  }

  const db = await getDb();
  if (!db) return factLedgerUnavailable("0204事实账本暂不可用，无法核验已确认产品事实");
  try {
    const facts = await db.select().from(listingFactRevisions).where(and(
      eq(listingFactRevisions.workspaceId, input.workspaceId),
      eq(listingFactRevisions.projectId, input.projectId),
      eq(listingFactRevisions.status, "confirmed"),
      eq(listingFactRevisions.sourceFileId, source.file.id),
      eq(listingFactRevisions.rawHash, source.file.rawHash),
    ));
    const currentFacts = facts.filter((fact) => Boolean(fact.confirmedBy && fact.confirmedAt)
      && !isTemplateOrEmptyFact(fact.value));
    if (currentFacts.length === 0) {
      return factLedgerUnavailable("当前原始文件没有至少一条已人工确认、非模板的产品事实；请先完成0204事实审核");
    }
    return {
      source: { fileId: source.file.id, rawHash: source.file.rawHash },
      facts: currentFacts,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "查询失败";
    return factLedgerUnavailable(`0204事实账本暂不可用，无法核验已确认产品事实：${detail}`);
  }
}
