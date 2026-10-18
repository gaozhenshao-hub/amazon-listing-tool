import { createHash } from "node:crypto";
import { sql, getTableColumns, type SQL } from "drizzle-orm";
import { getTableConfig, type AnyMySqlTable } from "drizzle-orm/mysql-core";
import { z } from "zod";
import { projects, projectFiles, competitorAnalyses, competitorComparisonReports } from "../../../../drizzle/schema/project";
import { listings, keywords, buyerQuestions } from "../../../../drizzle/schema/listing";
import { listingFactRevisions, listingCoreRevisions, listingBulletCandidates } from "../../../../drizzle/schema/listingRevisions";
import { aiJobs, aiArtifacts, emperorSkillRuns, emperorAgentRuns, emperorAgentCheckpoints, emperorAgentEvents, emperorAgentArtifacts } from "../../../../drizzle/schema/ai_os";
import { assertAssistantRuleConfirmationJournalSchema } from "../../ai_os/repositories/assistantRuleConfirmationJournal";
import { isTemplateOrEmptyFact, sanitizeSelectedSellingPoint } from "../../../../shared/listingFactSafety";
import { listingConfiguredHash as hash, listingConfiguredCanonical as canonical, ListingConfiguredIdentitySchema, ListingConfiguredPreviewInputSchema,
  type ListingConfiguredIdentity, type ListingConfiguredPreviewInput, type ListingConfiguredStageOperation } from "../../../../shared/listingConfiguredWorkflow";
import { hydrateActiveCompetitorResearchForLockedRow, readActiveCompetitorResearch } from "./competitorActiveResearch";
import { assertActiveCompetitorResearchScope } from "../../../services/competitorActiveResearch";
import { buildSellingPointPlanningResearch, formatSellingPointPlanningContext } from "./sellingPointPlanning";
import { readCompleteAttributeText } from "./listingRawAttributeSource";
export interface ListingConfiguredExecutor { execute(statement: SQL): Promise<unknown> }
export class ListingConfiguredError extends Error { constructor(readonly code: string) { super(`LISTING_CONFIGURED_${code}`); } }
export function listingConfiguredFail(code: string): never { throw new ListingConfiguredError(code); }
export function listingConfiguredStatement(text: string, params: unknown[] = []) {
  const parts = text.split("?"); if (parts.length !== params.length + 1) listingConfiguredFail("SQL_INVALID");
  return sql.join(parts.flatMap((part, index) => index < params.length ? [sql.raw(part), sql`${params[index]}`] : [sql.raw(part)]), sql.raw(""));
}
export async function listingConfiguredRows(tx: ListingConfiguredExecutor, text: string, params: unknown[], max: number): Promise<Record<string, unknown>[]> {
  const result = await tx.execute(listingConfiguredStatement(text, params));
  if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].length > max || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) listingConfiguredFail("READ_INVALID");
  return result[0];
}
export function listingConfiguredJson(value: unknown, max = 8 * 1024 * 1024): unknown {
  try { const text = typeof value === "string" ? value : canonical(value); if (Buffer.byteLength(text) > max) listingConfiguredFail("SOURCE_LIMIT"); return JSON.parse(text); }
  catch (error) { if (error instanceof ListingConfiguredError) throw error; return listingConfiguredFail("JSON_INVALID"); }
}
export async function listingConfiguredWrite(tx: ListingConfiguredExecutor, text: string, params: unknown[]) {
  const result = await tx.execute(listingConfiguredStatement(text, params));
  if (!Array.isArray(result) || !result[0] || result[0].affectedRows !== 1 || result[0].warningStatus !== 0) listingConfiguredFail("WRITE_UNCONFIRMED");
  return result[0] as { insertId: number; affectedRows: number; warningStatus: number };
}
const tables = [projects, projectFiles, competitorAnalyses, competitorComparisonReports, listings, keywords, buyerQuestions, listingFactRevisions, listingCoreRevisions, listingBulletCandidates, aiJobs, aiArtifacts];
export async function assertListingConfiguredSchema(tx: ListingConfiguredExecutor) {
  const schemaTables = [...tables, emperorSkillRuns, emperorAgentRuns, emperorAgentCheckpoints, emperorAgentEvents, emperorAgentArtifacts];
  const names = [...schemaTables.map(table => getTableConfig(table).name), "users", "workspaces", "workspace_memberships", "role_permissions", "security_access_policies", "emperor_skills", "emperor_model_providers"];
  const engines = await listingConfiguredRows(tx, `SELECT TABLE_NAME AS name,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${names.map(() => "?").join(",")})`, names, names.length);
  if (engines.length !== names.length || names.some(name => engines.filter(row => row.name === name && row.engine === "InnoDB").length !== 1)) listingConfiguredFail("SCHEMA_UNAVAILABLE");
  for (const table of schemaTables) {
    const config = getTableConfig(table), columns = await listingConfiguredRows(tx, "SELECT COLUMN_NAME AS name,COLUMN_TYPE AS columnType,IS_NULLABLE AS nullable,EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION", [config.name], 200);
    const normalize = (value: string) => value.toLowerCase().replace(/int\(\d+\)/gu, "int").replace(/,\s+/gu, ",");
    if (columns.length !== config.columns.length || config.columns.some(column => { const row = columns.find(item => item.name === column.name);
      return !row || typeof row.columnType !== "string" || normalize(row.columnType) !== normalize(column.getSQLType()) || row.nullable !== (column.notNull ? "NO" : "YES") || typeof row.extra !== "string" || /(?:virtual|stored)\s+generated/iu.test(row.extra); })) listingConfiguredFail("SCHEMA_UNAVAILABLE");
  }
  for (const [table, key] of [["ai_jobs", "runId"], ["ai_artifacts", "artifactId"]]) {
    const keys = await listingConfiguredRows(tx, "SELECT INDEX_NAME AS name,COLUMN_NAME AS columnName,NON_UNIQUE AS nonUnique,SEQ_IN_INDEX AS sequence,SUB_PART AS subPart FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND NON_UNIQUE=0", [table], 20);
    if (keys.length !== 2 || !["id", key].every(column => keys.some(row => row.columnName === column && Number(row.sequence) === 1 && row.subPart === null))) listingConfiguredFail("SCHEMA_UNAVAILABLE");
  }
  const triggers = await listingConfiguredRows(tx, `SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE IN (${names.map(() => "?").join(",")}) LIMIT 1`, names, 1);
  if (triggers.length) listingConfiguredFail("SCHEMA_UNAVAILABLE");
  await assertAssistantRuleConfirmationJournalSchema(tx);
}
export async function listingConfiguredCompleteRows(tx: ListingConfiguredExecutor, table: AnyMySqlTable, where: string, params: unknown[], max = 1000) {
  const config = getTableConfig(table), entries = Object.entries(getTableColumns(table)), bytes = config.columns.map(column => `COALESCE(OCTET_LENGTH(\`${column.name}\`),0)`).join("+");
  const projection = entries.map(([key, column]) => { const name = `\`${column.name}\``, type = column.getSQLType();
    return `IF((${bytes})<=8388608,${/^(?:timestamp|datetime)/u.test(type) ? `DATE_FORMAT(${name},'%Y-%m-%dT%H:%i:%s.%fZ')` : name},NULL) AS \`${key}\``; }).join(",");
  const rows = await listingConfiguredRows(tx, `SELECT ${projection},(${bytes}) AS __bytes FROM \`${config.name}\` WHERE ${where} ORDER BY id LIMIT ${max + 1} FOR SHARE`, params, max);
  let total = 0;
  for (const row of rows) { if (!Number.isSafeInteger(Number(row.__bytes)) || Number(row.__bytes) < 0 || (total += Number(row.__bytes)) > 8388608) listingConfiguredFail("SOURCE_LIMIT"); delete row.__bytes;
    for (const [key, column] of entries) if (column.getSQLType() === "json" && row[key] !== null) row[key] = listingConfiguredJson(row[key]); }
  if (new Set(rows.map(row => row.id)).size !== rows.length) listingConfiguredFail("SOURCE_INVALID");
  return rows;
}
const object = z.record(z.string(), z.unknown());
export const ListingConfiguredSourceSchema = z.object({ version: z.literal(1), identity: ListingConfiguredIdentitySchema,
  request: ListingConfiguredPreviewInputSchema, tables: z.record(z.string(), z.array(object)), rawText: z.string(), confirmedFacts: z.array(object).min(1), cores: z.array(object).max(10),
  research: object, sourceHash: z.string().regex(/^[a-f0-9]{64}$/u), draftHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict().superRefine((value, context) => {
  const { sourceHash, draftHash, ...body } = value;
  if (value.identity.workspaceId !== value.request.expectedWorkspaceId || !Array.isArray(value.tables.listings)
    || sourceHash !== hash(body) || draftHash !== hash(value.tables.listings)
    || Buffer.byteLength(canonical(body)) > 8 * 1024 * 1024) context.addIssue({ code: "custom", message: "SOURCE_BINDING_INVALID" });
});
export type ListingConfiguredSource = z.infer<typeof ListingConfiguredSourceSchema>;
export async function captureListingConfiguredSource(tx: ListingConfiguredExecutor, identity: ListingConfiguredIdentity, request: ListingConfiguredPreviewInput,
  rawReader: typeof readCompleteAttributeText = readCompleteAttributeText): Promise<ListingConfiguredSource> {
  const scope = ListingConfiguredPreviewInputSchema.parse(request), result: Record<string, Record<string, unknown>[]> = {};
  for (const table of tables.filter(table => table !== aiJobs && table !== aiArtifacts)) {
    const name = getTableConfig(table).name;
    result[name] = await listingConfiguredCompleteRows(tx, table, table === projects ? "id=?" : table === buyerQuestions ? "project_id=?" : "projectId=?", [scope.projectId]);
  }
  const parent = result.projects[0];
  if (result.projects.length !== 1 || parent.workspaceId !== identity.workspaceId || parent.id !== scope.projectId) listingConfiguredFail("ACCESS_DENIED");
  const files = result.projectFiles.filter(file => file.fileType === "product_attributes").sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || Number(b.id) - Number(a.id)), file = files[0];
  if (!file || file.workspaceId !== identity.workspaceId || file.status !== "completed" || file.lifecycleState === "deleted" || typeof file.rawContentHash !== "string") listingConfiguredFail("FACT_SOURCE_UNAVAILABLE");
  let rawText: string;
  if (typeof file.rawContent === "string" && file.rawContent.length < 4000 && file.rawContent.length > 0) rawText = file.rawContent;
  else if (!file.rawStorageUri) {
    const raw = await listingConfiguredRows(tx, "SELECT workspaceId,projectId,userId,contentHash,IF(OCTET_LENGTH(contentJson)<=8388608,contentJson,NULL) AS contentJson FROM ai_artifacts WHERE workspaceId=? AND projectId=? AND userId=? AND artifactKey='project_file.product_attributes.raw' AND sourceTable='projectFiles' AND sourceRowId=? AND sourceId=? AND domain='listing' AND runId IS NULL AND nodeId IS NULL AND status='final' AND isCurrent=1 LIMIT 2 FOR SHARE", [identity.workspaceId, scope.projectId, file.userId, String(file.id), String(file.id)], 2);
    if (raw.length !== 1 || raw[0].contentHash !== file.rawContentHash) listingConfiguredFail("FACT_SOURCE_UNAVAILABLE");
    const content = listingConfiguredJson(raw[0].contentJson); if (typeof content !== "string") listingConfiguredFail("FACT_SOURCE_UNAVAILABLE"); rawText = content;
  } else rawText = await rawReader(file, identity.workspaceId);
  rawText = rawText.replace(/\r\n?/gu, "\n").trim();
  if (Buffer.byteLength(rawText) > 2097152 || createHash("sha256").update(JSON.stringify(rawText)).digest("hex") !== file.rawContentHash) listingConfiguredFail("FACT_SOURCE_CHANGED");
  const confirmedFacts = result.listing_fact_revisions.filter(fact => fact.workspaceId === identity.workspaceId && fact.status === "confirmed" && fact.confirmedBy && fact.confirmedAt && fact.sourceFileId === file.id && fact.rawHash === file.rawContentHash && !isTemplateOrEmptyFact(fact.value));
  if (!confirmedFacts.length) listingConfiguredFail("CONFIRMED_FACTS_REQUIRED");
  const cores = scope.coreRevisionIds.map(id => result.listing_core_revisions.find(core => core.id === id));
  if (cores.some(core => !core || core.workspaceId !== identity.workspaceId || core.status !== "confirmed" || !core.confirmedBy || !core.confirmedAt || !Array.isArray(core.factRevisionIdsJson)
    || !core.factRevisionIdsJson.length || core.factRevisionIdsJson.some(id => !confirmedFacts.some(fact => fact.id === id))
    || result.listing_core_revisions.some(other => other.coreId === core.coreId && Number(other.revision) > Number(core.revision)))) listingConfiguredFail("CONFIRMED_CORE_CHANGED");
  if (scope.operation === "singleBullet" ? cores.length !== 1 : ["bullets", "batch"].includes(scope.operation) && cores.length < 1) listingConfiguredFail("CONFIRMED_CORES_REQUIRED");
  const selected = scope.analysisIds.map(id => result.competitorAnalyses.find(row => row.id === id));
  if (selected.some(row => !row)) listingConfiguredFail("RESEARCH_SELECTION_CHANGED");
  for (const row of selected as Record<string, unknown>[]) {
    const typed = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, /(?:At)$/u.test(key) && typeof value === "string" ? new Date(value) : value])) as unknown as typeof competitorAnalyses.$inferSelect;
    await hydrateActiveCompetitorResearchForLockedRow(typed, tx, parent as { id: number; userId: number; workspaceId: number });
    const active = readActiveCompetitorResearch(typed);
    if (active.status === "unavailable") listingConfiguredFail("RESEARCH_UNAVAILABLE");
    if (active.status === "adopted_deep") assertActiveCompetitorResearchScope(typed, active, { ...identity, projectId: scope.projectId });
    else { const raw = typed.rawData ? listingConfiguredJson(typed.rawData) : {}; if (!raw || typeof raw !== "object" || Array.isArray(raw)) listingConfiguredFail("RESEARCH_UNAVAILABLE");
      for (const key of ["analysisStale", "captureOnly"]) if (Object.hasOwn(raw, key) && (typeof (raw as Record<string, unknown>)[key] !== "boolean" || (raw as Record<string, unknown>)[key] === true)) listingConfiguredFail("RESEARCH_UNAVAILABLE"); }
    // The exact persisted raw row is retained privately; the provider gets the
    // existing verified, explicitly bounded planning projection, never old AI.
    const index = selected.indexOf(row); selected[index] = typed as unknown as Record<string, unknown>;
  }
  const selectionKey = [...scope.analysisIds].sort((a, b) => a - b).join("-");
  const comparison = result.competitorComparisonReports.filter(row => row.selectionKey === selectionKey).sort((a, b) => Number(b.id) - Number(a.id))[0];
  if (comparison && comparison.workspaceId !== null && comparison.workspaceId !== identity.workspaceId) listingConfiguredFail("ACCESS_DENIED");
  const research = buildSellingPointPlanningResearch({ projectId: scope.projectId, competitors: selected as Record<string, unknown>[], reviewAggregation: null,
    keywords: result.keywords, buyerQuestions: result.buyer_questions, confirmedComparison: comparison?.status === "confirmed" ? comparison : null,
    researchSelection: { version: 1, projectId: scope.projectId, workspaceId: identity.workspaceId, mode: "explicit", analysisIds: [...scope.analysisIds].sort((a, b) => a - b), sourceHash: hash(result.competitorAnalyses) } });
  const body = { version: 1 as const, identity, request: scope, tables: result, rawText, confirmedFacts, cores: cores as Record<string, unknown>[], research };
  if (Buffer.byteLength(canonical(body)) > 8 * 1024 * 1024) listingConfiguredFail("SOURCE_LIMIT");
  return ListingConfiguredSourceSchema.parse({ ...body, sourceHash: hash(body), draftHash: hash(result.listings) });
}
export function listingConfiguredCorePoint(source: ListingConfiguredSource, core: Record<string, unknown>) {
  const facts = source.confirmedFacts.filter(fact => (core.factRevisionIdsJson as number[]).includes(Number(fact.id)));
  const text = facts.map(fact => `${fact.attributeKey}: ${fact.value}`).join("; ");
  const point = { index: Number(core.sellingPointIndex), theme: String(core.buyerReason), description: text,
    fabeDirection: { feature: text, advantage: "", benefit: String(core.buyerReason), evidence: text }, targetKeywords: [] as string[] };
  if (!sanitizeSelectedSellingPoint(point).canGenerate) listingConfiguredFail("CORE_FACTS_INVALID"); return point;
}
export function listingConfiguredBusinessContext(source: ListingConfiguredSource, operation: ListingConfiguredStageOperation) {
  const parent = source.tables.projects[0], identity = { productName: parent.productName ?? parent.name ?? "", brand: parent.brand ?? "", category: parent.category ?? "", targetMarket: parent.targetMarket ?? "" };
  const factContext = `Product identity is not proof: ${canonical(identity)}\nOnly current human-confirmed product facts are product-claim evidence:\n${canonical(source.confirmedFacts.map(fact => ({ id: fact.id, attributeKey: fact.attributeKey, value: fact.value })))}\nNever use competitor claims, keyword demand, old Listing content or model knowledge as our specifications. Missing evidence must remain unknown.`;
  if (operation === "sellingPoints") return formatSellingPointPlanningContext({ factContext, research: source.research as ReturnType<typeof buildSellingPointPlanningResearch>, emphasis: source.request.emphasis ?? undefined });
  return canonical({ factContext, operation, confirmedCores: source.cores.map(core => ({ coreRevisionId: core.id, inputHash: core.inputHash, point: listingConfiguredCorePoint(source, core) })),
    existingListing: source.tables.listings, keywords: source.tables.keywords, questions: source.tables.buyer_questions.filter(row => row.status === "active").map(row => ({ id: row.id, question: row.question, source: row.source })),
    constraints: { oldListingOnlyAvoidsRepetition: true, historicalClaimsAreNotEvidence: true, directionCandidateNeverConfirmsCore: true, allBulletsUseExistingHumanConfirmedCores: true, outputMatchesOriginalSkillContract: true } });
}
