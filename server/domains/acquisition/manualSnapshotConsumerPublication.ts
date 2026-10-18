import { z } from "zod";
import { acquisitionReviewCanonical, acquisitionReviewHash } from "../../../shared/acquisitionReview";
import type { DbExecutor } from "../../repositories/dbClient";
import { assertResourceAction } from "../../services/securityGovernance";
import { saveCollectedListing } from "../listing/collectedListing";
import { AmazonAcquisitionCapabilitySchema, NormalizedAmazonSnapshotSchema } from "./contracts";
import { parseLegacySnapshotConsumerRef } from "./legacyConsumerContracts";
import { getManualSnapshotPublication, type ManualSnapshotPublication } from "./manualSnapshotPublication";
import { manualSnapshotReviewStatement, type ManualSnapshotPublishContext } from "./manualSnapshotReviewRepository";

const id = z.number().int().positive().max(2147483647);
const origin = "manual_acquisition_review_v1";
type Row = Record<string, unknown>;
function fail(reason: string): never { throw new Error(`ACQUISITION_REVIEW_PUBLICATION_${reason}`); }
function dbJson(value: unknown): unknown {
  if (value instanceof Date) { if (!Number.isFinite(value.getTime())) fail("DATE_INVALID"); return value.toISOString(); }
  if (Array.isArray(value)) return value.map(dbJson);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, dbJson(item)]));
  return value;
}
const same = (a: unknown, b: unknown) => acquisitionReviewCanonical(dbJson(a)) === acquisitionReviewCanonical(dbJson(b));

/** Manual publication deliberately does not use the legacy activation chain:
 * that chain replaces old image rows and schedules paid analysis. A reviewed
 * revision is private, append-only, and current only for its exact consumer. */
export function createManualSnapshotConsumerPublisher(dependencies: {
  permission?: typeof assertResourceAction;
  saveListing?: typeof saveCollectedListing;
  imageWorkflow?: (context: ManualSnapshotPublishContext) => Promise<unknown>;
} = {}) {
  return async function publish(context: ManualSnapshotPublishContext) {
    const proof = getManualSnapshotPublication(context.tx, context.confirmedSnapshotId);
    if (!proof || proof.tx !== context.tx || !same(proof.identity, context.identity)
      || proof.job.id !== context.job.id || proof.revision.id !== context.revision.id
      || proof.snapshot.id !== context.snapshot.id || !same(proof.envelope, context.envelope)) fail("PROOF_REQUIRED");
    const { tx, identity, job, snapshot } = proof;
    async function rows(query: string, values: unknown[], maximum = 301): Promise<Row[]> {
      const result = await tx.execute(manualSnapshotReviewStatement(query, values));
      if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].length > maximum
        || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) fail("READ_INVALID");
      acquisitionReviewCanonical(dbJson(result[0])); return result[0];
    }
    async function write(query: string, values: unknown[], insert = false): Promise<number> {
      const result = await tx.execute(manualSnapshotReviewStatement(query, values));
      if (!Array.isArray(result) || result[0]?.affectedRows !== 1 || result[0].warningStatus !== 0
        || insert && !id.safeParse(result[0].insertId).success) fail("WRITE_UNCONFIRMED");
      return insert ? result[0].insertId : 1;
    }
    const actors = await rows("SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", [identity.userId], 1);
    const actor = actors[0];
    if (!actor || actor.id !== identity.userId || actor.status !== "active" || actor.defaultWorkspaceId !== identity.workspaceId
      || actor.role !== proof.actor.role || job.requestedBy !== identity.userId || job.workspaceId !== identity.workspaceId) fail("ACTOR_CHANGED");
    const data = NormalizedAmazonSnapshotSchema.parse(proof.effectiveData);
    const capabilities = z.array(AmazonAcquisitionCapabilitySchema).min(1).max(20).parse(job.requestedCapabilities);
    if (new Set(capabilities).size !== capabilities.length || data.asin !== snapshot.asin || data.marketplace !== snapshot.marketplace) fail("SOURCE_INVALID");
    const source = await rows("SELECT id,workspace_id AS workspaceId,snapshot_id AS snapshotId,revision_id AS revisionId,confirmed_by AS confirmedBy,is_current AS isCurrent,content_hash AS contentHash,confirmed_data AS confirmedData,confirmed_asset_ids AS assetIds FROM acquisition_confirmed_snapshots WHERE id=? AND workspace_id=? FOR SHARE", [proof.confirmedSnapshotId, identity.workspaceId], 1);
    const confirmed = source[0];
    function json(value: unknown) { return typeof value === "string" ? JSON.parse(value) : value; }
    if (!confirmed || confirmed.id !== proof.confirmedSnapshotId || confirmed.workspaceId !== identity.workspaceId
      || confirmed.snapshotId !== snapshot.id || confirmed.revisionId !== proof.revision.id || confirmed.confirmedBy !== identity.userId
      || confirmed.isCurrent !== 0 || confirmed.contentHash !== proof.contentHash
      || !same(json(confirmed.confirmedData), proof.effectiveData) || !same(json(confirmed.assetIds), proof.assets.map(asset => asset.id))) fail("CONFIRMED_CHANGED");
    const permission = dependencies.permission ?? assertResourceAction;
    const projectId = proof.envelope.scope.expectedProjectId;
    await permission({ actor: proof.actor, resource: projectId === null ? "knowledge" : "project", action: "update",
      workspaceId: identity.workspaceId, projectId, resourceId: projectId ?? job.consumerRef, ownerUserId: identity.userId,
      authorizationRead: { executor: tx, strict: true, lock: true } });
    // Acquiring a transaction object does not make a legacy MyISAM target
    // transactional. Admit every actual branch target before its first write.
    const targetTables = job.consumerType === "kb_images" ? ["kb_image_sets", "kb_images"]
      : job.consumerType === "kb_listing" ? ["kb_listing_copywriting"]
        : job.consumerType === "kb_product" ? ["kb_product_innovations"]
          : job.consumerType === "project_competitor" ? ["projects", "competitorAnalyses", "competitorComparisonReports"]
            : job.consumerType === "image_workflow" ? ["projects", "image_competitor_research_subjects"] : [];
    if (targetTables.length) {
      const engines = await rows(`SELECT TABLE_NAME AS tableName,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${targetTables.map(() => "?").join(",")}) LIMIT 8`, targetTables, 7);
      if (engines.length !== targetTables.length || new Set(engines.map(row => row.tableName)).size !== targetTables.length
        || engines.some(row => !targetTables.includes(String(row.tableName)) || row.engine !== "InnoDB")) fail("TARGET_NOT_TRANSACTIONAL");
    }

    let projection: unknown;
    if (job.consumerType === "project_competitor") {
      const target = parseLegacySnapshotConsumerRef("project_competitor", job.consumerRef);
      if (target.type !== "project_competitor" || target.projectId !== projectId || target.asin !== snapshot.asin) fail("TARGET_INVALID");
      projection = await (dependencies.saveListing ?? saveCollectedListing)({ db: tx as DbExecutor,
        workspaceId: identity.workspaceId, userId: identity.userId, projectId: target.projectId,
        asin: snapshot.asin, confirmedSnapshotId: proof.confirmedSnapshotId });
    } else if (job.consumerType === "image_workflow") {
      if (proof.assets.some(asset => !["main", "secondary", "aplus", "brand_story"].includes(asset.role))) fail("IMAGE_ROLE_INVALID");
      if (!dependencies.imageWorkflow) fail("IMAGE_WORKFLOW_UNAVAILABLE");
      projection = await dependencies.imageWorkflow(context);
    } else if (job.consumerType === "kb_images") {
      if (projectId !== null || job.consumerRef !== `kb-images:${snapshot.marketplace}:${snapshot.asin}`) fail("TARGET_INVALID");
      projection = await projectImageVersion(proof, rows, write);
    } else if (job.consumerType === "kb_listing" || job.consumerType === "kb_product") {
      const target = parseLegacySnapshotConsumerRef(job.consumerType, job.consumerRef);
      if (target.type !== job.consumerType || !("recordId" in target) || projectId !== null) fail("TARGET_INVALID");
      const table = job.consumerType === "kb_listing" ? "kb_listing_copywriting" : "kb_product_innovations";
      const records = await rows(`SELECT * FROM ${table} WHERE id=? AND workspaceId=? FOR UPDATE`, [target.recordId, identity.workspaceId], 1);
      const before = records[0];
      if (!before || before.id !== target.recordId || before.userId !== identity.userId || before.workspaceId !== identity.workspaceId || before.asin !== snapshot.asin) fail("TARGET_CHANGED");
      // Bind the new reviewed source without overwriting generated copy, human
      // analysis, tags, review state, or claiming that an AI job has started.
      const reference = acquisitionReviewCanonical({ source: origin, confirmedSnapshotId: proof.confirmedSnapshotId,
        contentHash: proof.contentHash, revisionId: proof.revision.id, revisionVersion: proof.revision.version,
        sourceHash: proof.sourceHash, analysisStale: true });
      await write(`UPDATE ${table} SET crawledData=?,origin_instance_id=?,remote_id=?,sync_version=?,last_synced_at=CURRENT_TIMESTAMP,updatedAt=CURRENT_TIMESTAMP WHERE id=? AND workspaceId=? AND userId=?`,
        [reference, origin, proof.confirmedSnapshotId, proof.revision.version, target.recordId, identity.workspaceId, identity.userId]);
      const after = (await rows(`SELECT * FROM ${table} WHERE id=? AND workspaceId=? FOR UPDATE`, [target.recordId, identity.workspaceId], 1))[0];
      const changed = new Set(["crawledData", "origin_instance_id", "remote_id", "sync_version", "last_synced_at", "updatedAt"]);
      if (!after || after.crawledData !== reference || after.origin_instance_id !== origin || after.remote_id !== proof.confirmedSnapshotId
        || after.sync_version !== proof.revision.version || Object.keys(before).some(key => !changed.has(key) && !same(before[key], after[key]))) fail("TARGET_READBACK_FAILED");
      projection = { consumerType: job.consumerType, recordId: target.recordId };
    } else if (job.consumerType === "conversion_collector" || job.consumerType === "competitor_monitor") {
      if (projectId !== null || job.consumerRef !== (job.consumerType === "conversion_collector"
        ? `conversion-collector:${snapshot.marketplace}:${snapshot.asin}` : `manual:${snapshot.asin}`)) fail("TARGET_INVALID");
      projection = { consumerType: job.consumerType, metadataOnly: true };
    } else fail("TARGET_UNSUPPORTED");

    const linkSelect = "SELECT id,workspace_id AS workspaceId,confirmed_snapshot_id AS confirmedSnapshotId,consumer_type AS consumerType,consumer_ref AS consumerRef,capability_scope AS capabilityScope,projection_version AS projectionVersion,status,created_by AS createdBy FROM acquisition_consumer_links WHERE workspace_id=? AND consumer_type=? AND consumer_ref=?";
    const key = [identity.workspaceId, job.consumerType, job.consumerRef];
    const existing = await rows(`${linkSelect} AND status='active' ORDER BY id LIMIT 301 FOR UPDATE`, key, 300);
    if (new Set(existing.map(row => row.id)).size !== existing.length || new Set(existing.map(row => row.capabilityScope)).size !== existing.length) fail("ACTIVE_LINKS_INVALID");
    for (const row of existing) {
      if (!id.safeParse(row.id).success || row.workspaceId !== identity.workspaceId || row.consumerType !== job.consumerType
        || row.consumerRef !== job.consumerRef || row.status !== "active" || !AmazonAcquisitionCapabilitySchema.safeParse(row.capabilityScope).success) fail("ACTIVE_LINKS_INVALID");
      await write("UPDATE acquisition_consumer_links SET status='superseded',updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND consumer_type=? AND consumer_ref=? AND status='active'", [row.id, ...key]);
      const check = await rows(`${linkSelect} AND id=? FOR UPDATE`, [...key, row.id], 1);
      if (check.length !== 1 || !same({ ...row, status: "superseded" }, check[0])) fail("LINK_READBACK_FAILED");
    }
    const newIds: number[] = [];
    for (const capability of capabilities) newIds.push(await write("INSERT INTO acquisition_consumer_links (workspace_id,confirmed_snapshot_id,consumer_type,consumer_ref,capability_scope,projection_version,status,created_by) VALUES (?,?,?,?,?,?,'active',?)",
      [identity.workspaceId, proof.confirmedSnapshotId, job.consumerType, job.consumerRef, capability, proof.sourceHash, identity.userId], true));
    const saved = await rows(`${linkSelect} AND status='active' ORDER BY id LIMIT 301 FOR UPDATE`, key, 300);
    if (saved.length !== capabilities.length || new Set(saved.map(row => row.id)).size !== newIds.length || saved.some(row => !newIds.includes(Number(row.id))
      || row.workspaceId !== identity.workspaceId || row.confirmedSnapshotId !== proof.confirmedSnapshotId || row.consumerType !== job.consumerType
      || row.consumerRef !== job.consumerRef || row.projectionVersion !== proof.sourceHash || row.createdBy !== identity.userId || row.status !== "active")
      || capabilities.some(capability => saved.filter(row => row.capabilityScope === capability).length !== 1)) fail("LINK_READBACK_FAILED");
    return { projection, confirmedSnapshotId: proof.confirmedSnapshotId, sourceHash: proof.sourceHash };
  };
}

async function projectImageVersion(proof: ManualSnapshotPublication,
  rows: (query: string, values: unknown[], maximum?: number) => Promise<Row[]>,
  write: (query: string, values: unknown[], insert?: boolean) => Promise<number>) {
  const data = NormalizedAmazonSnapshotSchema.parse(proof.effectiveData), { identity } = proof;
  const roles = new Set(["main", "secondary", "aplus", "brand_story"]);
  if (proof.assets.some(asset => !roles.has(asset.role) || typeof asset.storageKey !== "string" || asset.storageKey.length > 1024)) fail("IMAGE_ROLE_INVALID");
  for (const [value, maximum] of [[data.title, 512], [data.brand, 128], [data.category, 128]] as const) if (value !== null && value.length > maximum) fail("IMAGE_METADATA_TOO_LARGE");
  const duplicates = await rows("SELECT id FROM kb_image_sets WHERE workspaceId=? AND userId=? AND origin_instance_id=? AND remote_id=? LIMIT 2 FOR UPDATE", [identity.workspaceId, identity.userId, origin, proof.confirmedSnapshotId], 2);
  if (duplicates.length) fail("IMAGE_VERSION_EXISTS");
  const setId = await write("INSERT INTO kb_image_sets (workspaceId,userId,asin,productTitle,brand,category,status,reviewStatus,reviewedBy,reviewedAt,confirmedAt,visibility,origin_instance_id,remote_id,sync_version,last_synced_at) VALUES (?,?,?,?,?,?,'confirmed','approved',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'private',?,?,?,CURRENT_TIMESTAMP)",
    [identity.workspaceId, identity.userId, data.asin, data.title, data.brand, data.category, identity.userId, origin, proof.confirmedSnapshotId, proof.revision.version], true);
  const set = (await rows("SELECT id,workspaceId,userId,asin,productTitle,brand,category,status,reviewStatus,reviewedBy,visibility,origin_instance_id,remote_id,sync_version FROM kb_image_sets WHERE id=? AND workspaceId=? FOR UPDATE", [setId, identity.workspaceId], 1))[0];
  if (!set || set.id !== setId || set.workspaceId !== identity.workspaceId || set.userId !== identity.userId || set.asin !== data.asin
    || set.productTitle !== data.title || set.brand !== data.brand || set.category !== data.category || set.status !== "confirmed"
    || set.reviewStatus !== "approved" || set.reviewedBy !== identity.userId || set.visibility !== "private" || set.origin_instance_id !== origin
    || set.remote_id !== proof.confirmedSnapshotId || set.sync_version !== proof.revision.version) fail("IMAGE_SET_READBACK_FAILED");
  const expected: Row[] = [];
  for (const asset of proof.assets) {
    const belong = { main: "主图", secondary: "套图", aplus: "A+", brand_story: "品牌故事" }[asset.role as "main" | "secondary" | "aplus" | "brand_story"];
    const imageId = await write("INSERT INTO kb_images (imageSetId,imageUrl,imagePosition,positionIndex,tagImageBelong,aplusModuleType,aplusModuleClass,tagsConfirmed,analysisConfirmed) VALUES (?,?,?,?,?,?,?,0,0)",
      [setId, asset.storageKey, asset.role, asset.positionIndex, belong, asset.moduleType, asset.moduleClass], true);
    expected.push({ id: imageId, imageSetId: setId, imageUrl: asset.storageKey, imagePosition: asset.role, positionIndex: asset.positionIndex,
      tagImageBelong: belong, aplusModuleType: asset.moduleType, aplusModuleClass: asset.moduleClass, tagsConfirmed: 0, analysisConfirmed: 0 });
  }
  const saved = await rows("SELECT id,imageSetId,imageUrl,imagePosition,positionIndex,tagImageBelong,aplusModuleType,aplusModuleClass,tagsConfirmed,analysisConfirmed FROM kb_images WHERE imageSetId=? ORDER BY id LIMIT 301 FOR UPDATE", [setId], 300);
  if (acquisitionReviewHash(saved) !== acquisitionReviewHash(expected)) fail("IMAGE_ROWS_READBACK_FAILED");
  return { consumerType: "kb_images", imageSetId: setId, projectedImageCount: expected.length, versioned: true };
}
