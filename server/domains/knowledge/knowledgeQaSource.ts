import { z } from "zod";
import { KNOWLEDGE_QA_LIMITS, KnowledgeQaSourceSchema, KnowledgeQaIdSchema, knowledgeQaHash, knowledgeQaCanonical,
  type KnowledgeQaIdentity, type KnowledgeQaPreviewInput, type KnowledgeQaSource, type KnowledgeQaItem } from "../../../shared/knowledgeQa";
import { smartRoute } from "../../kbContextEngine";
import { knowledgeQaRows as rows, knowledgeQaFail as fail, knowledgeQaJson, type KnowledgeQaExecutor, type KnowledgeQaAuthority } from "./knowledgeQaStorePrimitives";

const definitions = [
  { type: "product", table: "kb_product_innovations", directory: "kb_products", title: "productTitle", category: "category", fields: ["bulletPoints", "crawledData", "userEditedAnalysis", "aiAnalysis"], analysis: "aiAnalysis", edited: "userEditedAnalysis", score: "overallScore" },
  { type: "listing", table: "kb_listing_copywriting", directory: "kb_listings", title: "productTitle", category: "category", fields: ["titleText", "bulletPoints", "longDescription", "aPlusContent", "qaContent", "userEditedAnalysis", "aiAnalysis"], analysis: "aiAnalysis", edited: "userEditedAnalysis", score: "overallScore" },
  { type: "image", table: "kb_image_sets", directory: "kb_images", title: "productTitle", category: "category", fields: ["overallAnalysis", "userEditedOverallAnalysis"], analysis: "overallAnalysis", edited: "userEditedOverallAnalysis", score: "overallScore" },
  { type: "skill", table: "kb_operation_skills", directory: "kb_skills", title: "title", category: "categories", fields: ["extractedContent", "userEditedSummary", "aiSummary", "accessLevel", "allowedRoles"], analysis: "aiSummary", edited: "userEditedSummary", score: "practicalityScore" },
  { type: "video", table: "kb_videos", directory: "kb_videos", title: "videoTitle", category: "category", fields: ["transcriptText", "userEditedAnalysis", "aiAnalysis"], analysis: "aiAnalysis", edited: "userEditedAnalysis", score: "overallScore" },
] as const;
const text = (value: unknown) => value == null ? "" : typeof value === "string" ? value : knowledgeQaCanonical(value);
function finiteScore(value: unknown): number | null { if (value === null) return null; if (typeof value !== "string" && typeof value !== "number" || String(value).trim() === "" || !Number.isFinite(Number(value))) return fail("SOURCE_INVALID"); return Number(value); }
/** A complete bounded match set, not a page masquerading as the corpus. Source
 * data is frozen in one transaction and never grants access to private entries. */
export async function captureKnowledgeQaSource(tx: KnowledgeQaExecutor, identity: KnowledgeQaIdentity, input: KnowledgeQaPreviewInput, authority: KnowledgeQaAuthority,
  history: KnowledgeQaSource["history"], historyAvailable: number, threadVersion: number, historySourceKeys: string[] = []): Promise<KnowledgeQaSource> {
  const route = smartRoute(input.question), keyword = input.question.replace(/帮我|请|找|一些|有没有|怎么|如何|什么|哪些|关于|的|吗|呢|吧|了|啊/gu, "").trim(), query = keyword.length < 2 ? "" : keyword.slice(0, 20);
  const selected = definitions.filter(def => route.suggestedTypes.includes(def.type) && authority.directories.has(def.directory));
  const items: KnowledgeQaItem[] = [];
  for (const def of selected) {
    const fields = [def.title, def.category, ...(def.type === "image" ? [] : ["tags"]), ...def.fields];
    const valueSql = fields.map(field => `IF(COALESCE(OCTET_LENGTH(\`${field}\`),0)<=${KNOWLEDGE_QA_LIMITS.fieldBytes},\`${field}\`,NULL) AS \`${field}\``).join(",");
    const overSql = fields.map(field => `COALESCE(OCTET_LENGTH(\`${field}\`),0)>${KNOWLEDGE_QA_LIMITS.fieldBytes}`).join(" OR ");
    const match = [def.title, def.category, ...(def.type === "skill" ? ["extractedContent"] : ["asin"]), ...(def.type === "image" ? [] : ["tags"])].map(field => `\`${field}\` LIKE ?`).join(" OR ");
    const data = await rows(tx, `SELECT id,userId,workspaceId,status,visibility,DATE_FORMAT(updatedAt,'%Y-%m-%dT%H:%i:%s.%fZ') AS updatedAt,${def.type === "skill" ? "''" : "asin"} AS asin,${def.score} AS score,(${overSql}) AS oversized,${valueSql} FROM \`${def.table}\` WHERE workspaceId=? AND status='confirmed' AND visibility IN ('team','public') AND (${match}) ORDER BY id LIMIT 1001 FOR SHARE`, [identity.workspaceId, ...Array(match.split("?").length - 1).fill(`%${query}%`)], KNOWLEDGE_QA_LIMITS.items);
    for (const row of data) {
      if (!KnowledgeQaIdSchema.safeParse(row.id).success || !KnowledgeQaIdSchema.safeParse(row.userId).success || row.workspaceId !== identity.workspaceId || row.status !== "confirmed" || !["team", "public"].includes(String(row.visibility)) || Number(row.oversized) !== 0 || typeof row.updatedAt !== "string") return fail("SOURCE_INVALID");
      if (def.type === "skill") {
        if (!["public", "team", "restricted"].includes(String(row.accessLevel))) return fail("SOURCE_INVALID");
        if (row.accessLevel === "restricted") { const roles = z.array(z.string().min(1)).max(100).parse(knowledgeQaJson(row.allowedRoles, 65536)); if (row.userId !== identity.userId && authority.role !== "super_admin" && !roles.includes(authority.role)) continue; }
      }
      // Manual private revisions cannot enter shared search. If someone has
      // externally changed one to shared, require a proper publication reader
      // rather than treating its generic row as verified evidence.
      if (def.type === "image") {
        const origins = await rows(tx, "SELECT id,origin_instance_id AS origin FROM kb_image_sets WHERE id=? AND workspaceId=? LIMIT 2 FOR SHARE", [row.id, identity.workspaceId], 1);
        if (origins.length !== 1 || origins[0].id !== row.id || origins[0].origin === "manual_acquisition_review_v1") return fail("MANUAL_IMAGE_SOURCE_REQUIRES_VERIFIED_PUBLICATION");
        const images = await rows(tx, "SELECT id,imageSetId,imagePosition,positionIndex,IF(COALESCE(OCTET_LENGTH(aiDimensionAnalysis),0)<=262144,aiDimensionAnalysis,NULL) AS analysis,COALESCE(OCTET_LENGTH(aiDimensionAnalysis),0) AS analysisBytes,singleImageScore,tagCategory,tagColorScheme,tagImageType,tagDesignStyle FROM kb_images WHERE imageSetId=? ORDER BY positionIndex,id LIMIT 301 FOR SHARE", [row.id], 300);
        if (images.some(image => !KnowledgeQaIdSchema.safeParse(image.id).success || image.imageSetId !== row.id || Number(image.analysisBytes) > KNOWLEDGE_QA_LIMITS.fieldBytes)) return fail("SOURCE_INVALID");
        row.images = images;
      }
      const analysis = text(row[def.edited] == null || row[def.edited] === "" ? row[def.analysis] : row[def.edited]);
      const fullContent = knowledgeQaCanonical(Object.fromEntries([...def.fields.filter(field => field !== def.analysis && field !== "allowedRoles" && field !== "accessLevel"), ...(def.type === "image" ? ["images"] : [])].map(field => [field, row[field] ?? null])));
      const summary = analysis.slice(0, 400), keyPoints = text(row.bulletPoints ?? row.extractedContent ?? row.transcriptText);
      items.push({ id: Number(row.id), type: def.type, key: `${def.type}:${row.id}`, title: text(row[def.title]), asin: text(row.asin), category: text(row[def.category]), tags: text(row.tags), score: finiteScore(row.score),
        summary, keyPoints, fullContent, aiAnalysis: analysis, revisionHash: knowledgeQaHash(row), summaryCoverage: { charactersAvailable: analysis.length, charactersIncluded: summary.length, truncated: summary.length < analysis.length } });
      if (items.length > KNOWLEDGE_QA_LIMITS.items || Buffer.byteLength(knowledgeQaCanonical(items)) > KNOWLEDGE_QA_LIMITS.sourceBytes) return fail("SOURCE_LIMIT");
    }
  }
  const body = { version: 1 as const, identity, scope: { expectedWorkspaceId: input.expectedWorkspaceId, threadId: input.threadId }, question: input.question, threadVersion, history, historySourceKeys, items, types: selected.map(def => def.type),
    coverage: { completeMatchingIndex: true as const, scope: "same_workspace_confirmed_shared" as const, historyIncluded: history.length, historyAvailable, pixelInputs: false as const, externalNetwork: false as const } };
  if (Buffer.byteLength(knowledgeQaCanonical(body)) > KNOWLEDGE_QA_LIMITS.sourceBytes) return fail("SOURCE_LIMIT");
  return KnowledgeQaSourceSchema.parse({ ...body, sourceHash: knowledgeQaHash(body) });
}
