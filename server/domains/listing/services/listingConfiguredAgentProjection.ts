import { requireDb } from "../../../repositories/dbClient";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig, type AnyMySqlTable } from "drizzle-orm/mysql-core";
import { LISTING_CONFIGURED_KIND, LISTING_CONFIGURED_DEFINITIONS, listingConfiguredOperations,
  listingConfiguredCanonical as canonical, listingConfiguredHash as hash, type ListingConfiguredIdentity,
  type ListingConfiguredOperation } from "../../../../shared/listingConfiguredWorkflow";
import { listingConfiguredRows as rows, listingConfiguredJson as json,
  listingConfiguredWrite as write, listingConfiguredFail as fail, type ListingConfiguredExecutor } from "./listingConfiguredSource";
import { emperorAgentRuns, emperorAgentCheckpoints, emperorAgentArtifacts } from "../../../../drizzle/schema/ai_os";

const agentSlug = "listing.full.workflow";
type Row = Record<string, unknown>;
type Scope = { projectId: number; userId: number; workspaceId?: number | null };
type Database = { transaction<T>(body: (tx: ListingConfiguredExecutor) => Promise<T>): Promise<T> };
const object = (value: unknown): Row => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("AGENT_PROJECTION_INVALID");
  return value as Row;
};
const positive = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;

/** New projection values may use scalar JSON wire envelopes, while original
 * Agent rows remain untouched. Force textual JSON projection so IF/CASE driver
 * metadata cannot add or remove another decoding layer or rewrite a double. */
async function complete(tx: ListingConfiguredExecutor, table: AnyMySqlTable, where: string, params: unknown[], max: number) {
  const config = getTableConfig(table), entries = Object.entries(getTableColumns(table));
  const bytes = entries.map(([, column]) => `COALESCE(OCTET_LENGTH(\`${column.name}\`),0)`).join("+");
  const projection = entries.map(([key, column]) => {
    const name = `\`${column.name}\``, type = column.getSQLType();
    const value = type === "json" ? `CAST(CASE WHEN JSON_TYPE(${name})='STRING' AND JSON_VALID(JSON_UNQUOTE(${name})) THEN JSON_UNQUOTE(${name}) ELSE CAST(${name} AS CHAR CHARACTER SET utf8mb4) END AS CHAR CHARACTER SET utf8mb4)`
      : /^(?:timestamp|datetime)/u.test(type) ? `DATE_FORMAT(${name},'%Y-%m-%dT%H:%i:%s.%fZ')` : name;
    return `IF((${bytes})<=8388608,${value},NULL) AS \`${key}\``;
  }).join(",");
  const found = await rows(tx, `SELECT ${projection},(${bytes}) AS __bytes FROM \`${config.name}\` WHERE ${where} ORDER BY id LIMIT ${max + 1} FOR SHARE`, params, max);
  let total = 0;
  for (const row of found) {
    if (!Number.isSafeInteger(Number(row.__bytes)) || Number(row.__bytes) < 0 || (total += Number(row.__bytes)) > 8388608) fail("AGENT_PROJECTION_LIMIT");
    delete row.__bytes;
    for (const [key, column] of entries) if (column.getSQLType() === "json" && row[key] !== null) row[key] = json(row[key]);
  }
  if (new Set(found.map(row => row.id)).size !== found.length) fail("AGENT_PROJECTION_INVALID");
  return found;
}

async function lockProject(tx: ListingConfiguredExecutor, scope: Scope, legacyNullProject = false) {
  if (!positive(scope.projectId) || !positive(scope.userId)) fail("AGENT_PROJECTION_SCOPE_INVALID");
  const found = await rows(tx, "SELECT id,workspaceId FROM projects WHERE id=? FOR UPDATE", [scope.projectId], 1);
  if (found.length !== 1 || found[0].id !== scope.projectId
    || found[0].workspaceId !== (scope.workspaceId ?? null) && !(legacyNullProject && found[0].workspaceId === null)) fail("AGENT_PROJECTION_SCOPE_INVALID");
}

/** Serialize legacy acceptance with configured apply. The callback only inserts
 * the legacy job; it must not call the Agent bridge while this lock is held. */
export async function withListingLegacyJobEnqueueFence<T>(scope: Scope, body: () => Promise<T>, database: () => Promise<Database> = () => requireDb("Listing legacy enqueue fence")): Promise<T> {
  return (await database()).transaction(async tx => { await lockProject(tx, scope, true); return body(); });
}

/** Keep the project lock across the old, multi-transaction bridge helpers.
 * This does not change legacy provider retries or falsely make those helpers
 * atomic. A configured apply cannot interleave, and old callbacks cannot
 * overwrite a newer apply for the same node (including invalidated children). */
export async function withListingLegacyProjectionFence<T>(scope: Scope & { aiJobRunId: string; nodeId: string }, body: () => Promise<T>, database: () => Promise<Database> = () => requireDb("Listing legacy projection fence")): Promise<T | undefined> {
  return (await database()).transaction(async tx => {
    await lockProject(tx, scope, true);
    const jobs = await rows(tx, "SELECT id,runId,workspaceId,userId,projectId,kind,module,`procedure` FROM ai_jobs WHERE runId=? AND BINARY runId=BINARY ? LIMIT 2 FOR SHARE", [scope.aiJobRunId, scope.aiJobRunId], 1);
    const job = jobs[0];
    if (!job || !positive(job.id) || job.workspaceId !== (scope.workspaceId ?? null) || job.userId !== scope.userId || job.projectId !== scope.projectId
      || job.kind === LISTING_CONFIGURED_KIND || job.module !== "listing" || job.procedure !== "listing.startGenerationJob") fail("LEGACY_JOB_SCOPE_INVALID");
    const records = await rows(tx, "SELECT workspaceId,userId,projectId,artifactKey,sourceTable,sourceRowId,domain,status,isCurrent,version,IF(OCTET_LENGTH(JSON_UNQUOTE(contentJson))<=16777216,JSON_UNQUOTE(contentJson),NULL) AS contentJson,contentHash FROM ai_artifacts WHERE workspaceId <=> ? AND projectId=? AND artifactKey='listing.generation.apply.v1' AND JSON_CONTAINS(JSON_EXTRACT(JSON_UNQUOTE(contentJson),'$.agentProjection.fencedNodeIds'),JSON_QUOTE(?)) ORDER BY id DESC LIMIT 1 FOR SHARE", [scope.workspaceId ?? null, scope.projectId, scope.nodeId], 1);
    if (records.length) {
      const row = records[0], value = object(json(row.contentJson, 16777216)), identity = object(value.identity), projection = object(value.agentProjection);
      if (row.domain !== "listing" || row.status !== "draft" || row.isCurrent !== 0 || row.version !== 1 || row.sourceTable !== "projects" || row.sourceRowId !== String(scope.projectId)
        || row.workspaceId !== (scope.workspaceId ?? null) || row.projectId !== scope.projectId || identity.workspaceId !== row.workspaceId || identity.userId !== row.userId
        || value.version !== 1 || value.projectId !== scope.projectId || hash(value) !== row.contentHash || projection.version !== 1
        || !Array.isArray(projection.fencedNodeIds) || !projection.fencedNodeIds.includes(scope.nodeId) || !Number.isSafeInteger(value.legacyJobFence) || Number(value.legacyJobFence) < 0) fail("AGENT_PROJECTION_FENCE_INVALID");
      if (Number(job.id) <= Number(value.legacyJobFence)) return undefined;
    }
    return body();
  });
}

/** Only the immutable snapshot stored on this run defines its descendants.
 * Do not silently substitute today's template for an older run. */
export function listingConfiguredProjectionDag(run: Row) {
  const inputs = object(json(run.inputs)), runtime = object(inputs.__agentRun), dag = object(runtime.dagSnapshot);
  // Legacy hashJson used insertion-order JSON.stringify, whereas MySQL JSON
  // may reorder keys. Validate the stored pair, not a fabricated reconstruction
  // of those lost bytes. The new apply journal captures a canonical SHA256;
  // that is an apply-time snapshot, not proof of historical byte integrity.
  if (runtime.agentSlug !== agentSlug || typeof runtime.dagHash !== "string" || !/^[a-f0-9]{16}$/u.test(runtime.dagHash)
    || run.dagHash !== runtime.dagHash || !Array.isArray(dag.nodes) || !Array.isArray(dag.edges)
    || !dag.nodes.length || dag.nodes.length > 200 || dag.edges.length > 1000) fail("AGENT_DAG_SNAPSHOT_INVALID");
  const nodes = dag.nodes.map(node => object(node));
  if (nodes.some(node => typeof node.id !== "string" || !node.id || node.id.length > 128) || new Set(nodes.map(node => node.id)).size !== nodes.length) fail("AGENT_DAG_SNAPSHOT_INVALID");
  const edges = dag.edges.map(raw => { const edge = object(raw), from = edge.source || edge.from, to = edge.target || edge.to;
    if (!nodes.some(node => node.id === from) || !nodes.some(node => node.id === to)) fail("AGENT_DAG_SNAPSHOT_INVALID"); return { from, to }; });
  const visited = new Set<unknown>(), active = new Set<unknown>();
  const visit = (id: unknown) => {
    if (active.has(id)) fail("AGENT_DAG_SNAPSHOT_INVALID");
    if (visited.has(id)) return;
    active.add(id); for (const edge of edges.filter(edge => edge.from === id)) visit(edge.to);
    active.delete(id); visited.add(id);
  };
  for (const node of nodes) visit(node.id);
  return { nodes, edges, legacyDagHash: runtime.dagHash, canonicalSnapshotHash: hash(dag), dagBinding: "legacy_hash_pair_canonical_snapshot_captured_at_apply" };
}
export function listingConfiguredProjectionAffected(run: Row, changed: string[]) {
  const dag = listingConfiguredProjectionDag(run), affected = new Set(changed), queue = [...changed];
  if (changed.some(id => !dag.nodes.some(node => node.id === id))) fail("AGENT_DAG_NODE_MISSING");
  while (queue.length) {
    const source = queue.shift();
    for (const edge of dag.edges.filter(edge => edge.from === source)) {
      const id = String(edge.to); if (!affected.has(id)) { affected.add(id); queue.push(id); }
    }
  }
  return [...affected].sort();
}

/** Caller holds the authorized project lock and the business draft CAS. All
 * projection changes and history are returned for the same immutable apply
 * artifact / final journal transaction; there is no global Agent runner call. */
export async function projectListingConfiguredApplied(tx: ListingConfiguredExecutor, input: {
  identity: ListingConfiguredIdentity; projectId: number; operation: ListingConfiguredOperation; outputs: Record<string, Record<string, unknown>>;
  listingId: number | null; candidateIds: number[]; sourceHash: string; resultHash: string; applyOperationId: string;
}) {
  const { identity, projectId } = input;
  await lockProject(tx, { ...identity, projectId });
  const tableNames = ["emperor_agent_runs", "emperor_agent_checkpoints", "emperor_agent_artifacts", "emperor_agent_events"];
  const engines = await rows(tx, `SELECT TABLE_NAME AS name,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tableNames.map(() => "?").join(",")})`, tableNames, tableNames.length);
  if (engines.length !== tableNames.length || new Set(engines.map(row => row.name)).size !== tableNames.length || engines.some(row => !tableNames.includes(String(row.name)) || row.engine !== "InnoDB")) fail("AGENT_PROJECTION_UNAVAILABLE");
  const maximum = await rows(tx, "SELECT COALESCE(MAX(id),0) AS maximum FROM ai_jobs WHERE workspaceId=? AND projectId=? AND module='listing' AND `procedure`='listing.startGenerationJob' AND kind<>?", [identity.workspaceId, projectId, LISTING_CONFIGURED_KIND], 1);
  const legacyJobFence = maximum[0]?.maximum;
  if (!Number.isSafeInteger(legacyJobFence) || Number(legacyJobFence) < 0) fail("AGENT_PROJECTION_FENCE_INVALID");
  const operations = listingConfiguredOperations(input.operation), nodeOutputs: Record<string, unknown> = {};
  for (const operation of operations) nodeOutputs[LISTING_CONFIGURED_DEFINITIONS[operation].node] = input.outputs[operation];
  if (input.outputs.sellingPoints && input.outputs.bullets) nodeOutputs.G1 = { sellingPoints: input.outputs.sellingPoints, bullets: input.outputs.bullets };
  const changed = Object.keys(nodeOutputs), fenced = new Set(changed), history: Row[] = [];
  const runs = await complete(tx, emperorAgentRuns, "workspaceId=? AND projectId=? AND agentSlug=? AND status IN ('running','waiting_human','failed')", [identity.workspaceId, projectId, agentSlug], 20);
  const binding = { version: 1, source: "listing_configured_apply", projectId, applyOperationId: input.applyOperationId,
    sourceHash: input.sourceHash, resultHash: input.resultHash, listingId: input.listingId, candidateIds: input.candidateIds, legacyJobFence };
  for (const selected of runs) {
    // complete() uses shared locks; upgrade the selected run before its CAS.
    const locked = await rows(tx, "SELECT id,stateVersion FROM emperor_agent_runs WHERE id=? FOR UPDATE", [selected.id], 1);
    if (locked.length !== 1 || locked[0].stateVersion !== selected.stateVersion || !Number.isInteger(selected.stateVersion) || Number(selected.stateVersion) >= 2147483647) fail("AGENT_PROJECTION_CHANGED");
    const affected = listingConfiguredProjectionAffected(selected, changed); affected.forEach(id => fenced.add(id));
    const checkpoints = await complete(tx, emperorAgentCheckpoints, "runId=?", [selected.runId], 200);
    const target = checkpoints.filter(row => affected.includes(String(row.nodeId)));
    if (new Set(checkpoints.map(row => row.nodeId)).size !== checkpoints.length || affected.some(id => !target.some(row => row.nodeId === id))
      || target.some(row => row.workspaceId !== identity.workspaceId || row.agentSlug !== agentSlug || row.status === "running" || row.lockToken != null)) fail("AGENT_PROJECTION_BUSY_OR_INVALID");
    const artifacts = await complete(tx, emperorAgentArtifacts, "runId=? AND isCurrent=1", [selected.runId], 200);
    for (const row of artifacts.filter(row => affected.includes(String(row.nodeId)))) {
      await write(tx, "UPDATE emperor_agent_artifacts SET isCurrent=0,status='superseded' WHERE id=? AND isCurrent=1", [row.id]);
    }
    for (const row of target) {
      const direct = Object.hasOwn(nodeOutputs, String(row.nodeId)), output = direct ? nodeOutputs[String(row.nodeId)] : null;
      const metadata = row.metadata == null ? {} : object(json(row.metadata));
      await write(tx, "UPDATE emperor_agent_checkpoints SET status=?,output=JSON_QUOTE(?),userEdit=NULL,metadata=?,aiJobRunId=NULL,aiJobAttempt=0,aiJobClaimedAt=NULL,skillRunId=NULL,lockToken=NULL,lockedAt=NULL,timeoutAt=NULL,retryScheduledAt=NULL,lastFailureKind=NULL,reviewerUserId=NULL,confirmedAt=NULL,errorMessage=NULL,completedAt=NULL,updatedAt=NOW() WHERE id=? AND status=? AND lockToken IS NULL",
        [direct ? "waiting_human" : "pending", output === null ? null : canonical(output), canonical({ ...metadata, listingConfiguredProjection: binding,
          businessJobStatus: direct ? "waiting_human" : "invalidated", businessProgress: direct ? 100 : 0 }), row.id, row.status]);
      if (direct) await write(tx, "INSERT INTO emperor_agent_artifacts (workspaceId,runId,agentSlug,nodeId,artifactKey,artifactType,status,version,isCurrent,userId,projectId,content,contentHash,metadata,mimeType,fileSizeBytes) VALUES (?,?,?, ?,?,'json','draft',?,0,?,?,JSON_QUOTE(?),?,?,'application/json',?)",
        [identity.workspaceId, selected.runId, agentSlug, row.nodeId, row.nodeId, Number(selected.stateVersion) + 1, identity.userId, projectId,
          canonical(output), hash(output), canonical({ listingConfiguredProjection: binding }), Buffer.byteLength(canonical(output))]);
    }
    const afterCheckpoints = await complete(tx, emperorAgentCheckpoints, "runId=?", [selected.runId], 200);
    const previousOutputs = selected.outputs == null ? {} : object(json(selected.outputs));
    const nextOutputs = Object.fromEntries(Object.entries(previousOutputs).filter(([nodeId]) => !affected.includes(nodeId)));
    const confirmed = afterCheckpoints.filter(row => ["confirmed", "skipped"].includes(String(row.status))).length;
    await write(tx, "UPDATE emperor_agent_runs SET status='waiting_human',currentNodeId=?,progress=?,outputs=JSON_QUOTE(?),stateVersion=stateVersion+1,recoverySnapshotId=NULL,errorMessage=NULL,completedAt=NULL,updatedAt=NOW() WHERE id=? AND stateVersion=?",
      [changed[0], Math.floor(confirmed / Math.max(1, afterCheckpoints.length) * 100), canonical(nextOutputs), selected.id, selected.stateVersion]);
    await write(tx, "INSERT INTO emperor_agent_events (workspaceId,runId,agentSlug,eventType,message,payload) VALUES (?,?,?,'listing.configured_applied',?,?)",
      [identity.workspaceId, selected.runId, agentSlug, "Listing 候选已显式应用，等待原流程人工确认", canonical({ ...binding, changed, affected })]);
    const afterRuns = await complete(tx, emperorAgentRuns, "id=?", [selected.id], 1);
    if (afterRuns.length !== 1 || afterRuns[0].stateVersion !== Number(selected.stateVersion) + 1 || afterRuns[0].status !== "waiting_human"
      || hash(afterRuns[0].outputs) !== hash(nextOutputs) || target.some(row => {
        const saved = afterCheckpoints.find(item => item.id === row.id), direct = Object.hasOwn(nodeOutputs, String(row.nodeId));
        return !saved || saved.status !== (direct ? "waiting_human" : "pending") || saved.confirmedAt !== null || saved.reviewerUserId !== null
          || hash(object(saved.metadata).listingConfiguredProjection) !== hash(binding) || hash(saved.output) !== hash(direct ? nodeOutputs[String(row.nodeId)] : null);
      })) fail("AGENT_PROJECTION_READBACK_INVALID");
    const dag = listingConfiguredProjectionDag(selected);
    history.push({ runId: selected.runId, dagBinding: dag.dagBinding, legacyDagHash: dag.legacyDagHash, canonicalSnapshotHash: dag.canonicalSnapshotHash,
      before: { run: selected, checkpoints, artifacts }, after: { run: afterRuns[0], checkpoints: afterCheckpoints } });
  }
  return { legacyJobFence: Number(legacyJobFence), agentProjection: { version: 1, fencedNodeIds: [...fenced].sort(), runIds: runs.map(row => String(row.runId)), history } };
}
