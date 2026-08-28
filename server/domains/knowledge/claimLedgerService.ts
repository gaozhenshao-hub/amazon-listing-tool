import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { registerUnifiedArtifact } from "../ai_os/services/artifactLifecycle";
import { rawExecute } from "../ai_os/routerContext";
import { normalizeDistillationProfile, type DistillationProfile } from "./skillDistillationContracts";

export type ClaimStatus = "candidate" | "confirmed" | "locked" | "invalidated";
export type ClaimTargetDomain = "listing" | "image" | "brand_story";
export type LedgerStatus = "draft" | "review" | "locked" | "superseded" | "archived";

export type ClaimLedgerClaim = {
  claimKey: string;
  statement: string;
  evidenceKeys: string[];
  status: ClaimStatus;
  risk: "low" | "medium" | "high";
  notes?: string;
};

const json = (value: unknown) => JSON.stringify(value ?? null);
const parse = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};
const key = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
const contentHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function normalizeClaims(claims: ClaimLedgerClaim[]) {
  const used = new Set<string>();
  return claims.map((claim, index) => {
    const claimKey = String(claim.claimKey || `claim_${index + 1}`).trim();
    if (!claimKey || used.has(claimKey)) throw new TRPCError({ code: "BAD_REQUEST", message: "每项主张必须具有唯一标识" });
    if (!String(claim.statement || "").trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "主张内容不能为空" });
    if (!Array.isArray(claim.evidenceKeys) || claim.evidenceKeys.length === 0) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "每项主张必须绑定至少一张已批准的证据卡" });
    used.add(claimKey);
    return { ...claim, claimKey, statement: String(claim.statement).trim(), evidenceKeys: [...new Set(claim.evidenceKeys)].sort() };
  });
}

async function getLedger(ledgerKey: string, workspaceId: number) {
  const ledger = (await rawExecute("SELECT * FROM knowledge_claim_ledgers WHERE ledgerKey=? AND workspaceId=? LIMIT 1", [ledgerKey, workspaceId]))[0];
  if (!ledger) throw new TRPCError({ code: "NOT_FOUND", message: "主张账本不存在或不属于当前工作空间" });
  return { ...ledger, profile: parse(ledger.profile, {}), claims: parse<ClaimLedgerClaim[]>(ledger.claims, []) };
}

async function assertEvidenceApproved(workspaceId: number, evidenceKeys: string[]) {
  const uniqueKeys = [...new Set(evidenceKeys)];
  const rows = await rawExecute(
    `SELECT evidenceKey FROM knowledge_distillation_evidence WHERE workspaceId=? AND status='approved' AND evidenceKey IN (${uniqueKeys.map(() => "?").join(",") || "NULL"})`,
    [workspaceId, ...uniqueKeys],
  );
  if (rows.length !== uniqueKeys.length) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "主张账本只能引用已批准且属于当前工作空间的证据卡" });
  }
}

export async function createClaimLedger(input: {
  workspaceId: number;
  userId: number;
  businessProjectId?: number | null;
  listingId?: number | null;
  imageWorkflowSessionId?: number | null;
  profile: Partial<DistillationProfile>;
  claims: ClaimLedgerClaim[];
}) {
  const claims = normalizeClaims(input.claims);
  await assertEvidenceApproved(input.workspaceId, claims.flatMap((claim) => claim.evidenceKeys));
  const ledgerKey = key("ledger");
  await rawExecute(
    `INSERT INTO knowledge_claim_ledgers (ledgerKey,workspaceId,businessProjectId,listingId,imageWorkflowSessionId,profile,claims,status,version,isCurrent,createdBy)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [ledgerKey, input.workspaceId, input.businessProjectId || null, input.listingId || null, input.imageWorkflowSessionId || null, json(normalizeDistillationProfile(input.profile)), json(claims), "draft", 1, 1, input.userId],
  );
  return { ledgerKey, status: "draft" as const, version: 1 };
}

export async function listClaimLedgers(input: { workspaceId: number; businessProjectId?: number | null; listingId?: number | null; imageWorkflowSessionId?: number | null }) {
  const clauses = ["workspaceId=?"];
  const params: unknown[] = [input.workspaceId];
  if (input.businessProjectId) { clauses.push("businessProjectId=?"); params.push(input.businessProjectId); }
  if (input.listingId) { clauses.push("listingId=?"); params.push(input.listingId); }
  if (input.imageWorkflowSessionId) { clauses.push("imageWorkflowSessionId=?"); params.push(input.imageWorkflowSessionId); }
  const rows = await rawExecute(`SELECT * FROM knowledge_claim_ledgers WHERE ${clauses.join(" AND ")} ORDER BY isCurrent DESC,version DESC,updatedAt DESC LIMIT 100`, params);
  return rows.map((row) => ({ ...row, profile: parse(row.profile, {}), claims: parse(row.claims, []) }));
}

export async function getClaimLedgerDetail(input: { workspaceId: number; ledgerKey: string }) {
  const ledger = await getLedger(input.ledgerKey, input.workspaceId);
  const links = await rawExecute("SELECT * FROM knowledge_claim_ledger_links WHERE workspaceId=? AND ledgerKey=? ORDER BY createdAt", [input.workspaceId, input.ledgerKey]);
  return { ledger, links };
}

export async function createClaimLedgerVersion(input: { workspaceId: number; userId: number; ledgerKey: string; claims: ClaimLedgerClaim[]; profile?: Partial<DistillationProfile> }) {
  const parent = await getLedger(input.ledgerKey, input.workspaceId);
  if (parent.status !== "locked") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "只可从已锁定账本创建修订版本，以保护当前工作流引用" });
  const claims = normalizeClaims(input.claims);
  await assertEvidenceApproved(input.workspaceId, claims.flatMap((claim) => claim.evidenceKeys));
  const nextKey = key("ledger");
  const nextProfile = normalizeDistillationProfile({ ...(parent.profile as DistillationProfile), ...input.profile });
  await rawExecute("UPDATE knowledge_claim_ledgers SET isCurrent=0,status='superseded',updatedAt=NOW() WHERE ledgerKey=? AND workspaceId=?", [input.ledgerKey, input.workspaceId]);
  await rawExecute(
    `INSERT INTO knowledge_claim_ledgers (ledgerKey,workspaceId,businessProjectId,listingId,imageWorkflowSessionId,profile,claims,status,version,isCurrent,parentLedgerKey,createdBy)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [nextKey, input.workspaceId, parent.businessProjectId || null, parent.listingId || null, parent.imageWorkflowSessionId || null, json(nextProfile), json(claims), "draft", Number(parent.version) + 1, 1, input.ledgerKey, input.userId],
  );
  return { ledgerKey: nextKey, parentLedgerKey: input.ledgerKey, status: "draft" as const, version: Number(parent.version) + 1 };
}

export async function lockClaimLedger(input: { workspaceId: number; userId: number; ledgerKey: string }) {
  const ledger = await getLedger(input.ledgerKey, input.workspaceId);
  if (ledger.status !== "draft" && ledger.status !== "review") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "只有草案或待审账本可以锁定" });
  const claims = normalizeClaims(ledger.claims);
  if (claims.some((claim) => claim.status !== "confirmed" && claim.status !== "locked")) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "所有主张必须先人工确认，才能锁定供Listing和图片共同使用" });
  }
  const artifact = await registerUnifiedArtifact({
    workspaceId: input.workspaceId,
    domain: "listing",
    artifactKey: "listing.image.claim-ledger",
    artifactType: "json",
    sourceType: "user_edit",
    sourceTable: "knowledge_claim_ledgers",
    sourceRowId: input.ledgerKey,
    projectId: ledger.businessProjectId || null,
    userId: input.userId,
    status: "final",
    content: { ledgerKey: input.ledgerKey, version: ledger.version, profile: ledger.profile, claims },
    metadata: { contentHash: contentHash({ profile: ledger.profile, claims }), lockedBy: input.userId },
    failOnError: true,
  });
  await rawExecute("UPDATE knowledge_claim_ledgers SET status='locked',claims=?,artifactId=?,lockedBy=?,lockedAt=NOW(),updatedAt=NOW() WHERE ledgerKey=? AND workspaceId=?", [json(claims.map((claim) => ({ ...claim, status: "locked" }))), artifact?.artifactId || null, input.userId, input.ledgerKey, input.workspaceId]);
  return { ledgerKey: input.ledgerKey, status: "locked" as const, artifactRef: artifact?.ref || null };
}

export async function linkLedgerClaim(input: { workspaceId: number; userId: number; ledgerKey: string; claimKey: string; targetDomain: ClaimTargetDomain; targetType: string; targetRef: string; targetPosition?: string | null; confirmed: boolean }) {
  const ledger = await getLedger(input.ledgerKey, input.workspaceId);
  if (ledger.status !== "locked") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "只有已锁定账本允许建立下游工作流链接" });
  if (!ledger.claims.some((claim) => claim.claimKey === input.claimKey)) throw new TRPCError({ code: "NOT_FOUND", message: "账本中不存在该主张" });
  const linkKey = key("claimlink");
  await rawExecute(
    `INSERT INTO knowledge_claim_ledger_links (linkKey,workspaceId,ledgerKey,claimKey,targetDomain,targetType,targetRef,targetPosition,status,createdBy,confirmedBy,confirmedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,IF(?='confirmed',NOW(),NULL))
     ON DUPLICATE KEY UPDATE targetPosition=VALUES(targetPosition),status=VALUES(status),confirmedBy=VALUES(confirmedBy),confirmedAt=VALUES(confirmedAt),updatedAt=NOW()`,
    [linkKey, input.workspaceId, input.ledgerKey, input.claimKey, input.targetDomain, input.targetType, input.targetRef, input.targetPosition || null, input.confirmed ? "confirmed" : "candidate", input.userId, input.confirmed ? input.userId : null, input.confirmed ? "confirmed" : "candidate"],
  );
  return { ledgerKey: input.ledgerKey, claimKey: input.claimKey, status: input.confirmed ? "confirmed" : "candidate" };
}

export async function reviewClaimLedgerCoherence(input: { workspaceId: number; ledgerKey: string }) {
  const { ledger, links } = await getClaimLedgerDetail(input);
  const activeClaims = ledger.claims.filter((claim: ClaimLedgerClaim) => claim.status === "locked" || claim.status === "confirmed");
  const confirmedLinks = links.filter((link: any) => link.status === "confirmed" || link.status === "locked");
  const missingListing = activeClaims.filter((claim: ClaimLedgerClaim) => !confirmedLinks.some((link: any) => link.claimKey === claim.claimKey && link.targetDomain === "listing"));
  const missingImage = activeClaims.filter((claim: ClaimLedgerClaim) => !confirmedLinks.some((link: any) => link.claimKey === claim.claimKey && link.targetDomain === "image"));
  const targetCounts = new Map<string, number>();
  for (const link of confirmedLinks) targetCounts.set(`${link.targetDomain}:${link.targetRef}`, (targetCounts.get(`${link.targetDomain}:${link.targetRef}`) || 0) + 1);
  const overloadedTargets = [...targetCounts.entries()].filter(([, count]) => count > 2).map(([target, count]) => ({ target, count }));
  return {
    ledgerKey: input.ledgerKey,
    status: ledger.status,
    healthy: missingListing.length === 0 && missingImage.length === 0 && overloadedTargets.length === 0,
    coverage: { activeClaims: activeClaims.length, confirmedLinks: confirmedLinks.length, missingListing: missingListing.map((claim: ClaimLedgerClaim) => claim.claimKey), missingImage: missingImage.map((claim: ClaimLedgerClaim) => claim.claimKey), overloadedTargets },
    advisory: "一致性检查只输出差异，不会自动修改Listing、A+、品牌故事或图片步骤。",
  };
}

export async function analyzeClaimLedgerChangeImpact(input: { workspaceId: number; ledgerKey: string }) {
  const { ledger, links } = await getClaimLedgerDetail(input);
  return {
    ledgerKey: input.ledgerKey,
    ledgerStatus: ledger.status,
    requiresNewVersion: ledger.status === "locked",
    impactedTargets: links.map((link: any) => ({ claimKey: link.claimKey, targetDomain: link.targetDomain, targetType: link.targetType, targetRef: link.targetRef, targetPosition: link.targetPosition, status: link.status })),
    advisory: ledger.status === "locked"
      ? "当前账本已锁定。请创建新版本；系统只标记受影响位置，不会解锁或覆盖下游内容。"
      : "当前草案可继续编辑；未锁定前不得作为Listing或图片步骤的正式输入。",
  };
}

export async function resolveWorkflowGuidance(input: { workspaceId: number; ledgerKey?: string | null; skillSlugs?: string[] | null }) {
  const skillSlugs = [...new Set((input.skillSlugs || []).map((slug) => String(slug).trim()).filter(Boolean))].slice(0, 12);
  let ledger: Record<string, unknown> | null = null;
  if (input.ledgerKey) {
    const resolved = await getLedger(input.ledgerKey, input.workspaceId);
    if (resolved.status !== "locked") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "工作流只能引用已锁定的Claim Ledger版本" });
    ledger = { ledgerKey: resolved.ledgerKey, version: resolved.version, profile: resolved.profile, claims: resolved.claims };
  }
  const available = await listPublishedDistilledSkills({ workspaceId: input.workspaceId });
  const selected = skillSlugs.length ? available.filter((skill) => skillSlugs.includes(String(skill.slug))) : [];
  if (selected.length !== skillSlugs.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "只能手动选择当前工作空间已发布的知识蒸馏Skill" });
  return {
    mode: "manual_selection_only" as const,
    claimLedger: ledger,
    selectedSkills: selected.map((skill) => ({ slug: skill.slug, name: skill.name, version: skill.version, profile: skill.profile })),
    advisory: "本指导上下文由用户显式选择，只读传入本次生成；不会修改、替换或解锁既有Listing和图片内容。",
  };
}

export async function listPublishedDistilledSkills(input: { workspaceId: number; profile?: Partial<DistillationProfile> }) {
  const requested = normalizeDistillationProfile(input.profile || {});
  const rows = await rawExecute(
    "SELECT slug,name,description,category,riskTier,status,scope,version,manifest,updatedAt FROM emperor_skills WHERE workspaceId=? AND owner='knowledge_distillation' AND status='Released' ORDER BY updatedAt DESC LIMIT 100",
    [input.workspaceId],
  );
  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    description: row.description,
    riskTier: row.riskTier,
    version: Number(row.version || 1),
    profile: parse((parse<any>(row.manifest, {})?.profile), requested),
    useMode: "user_select_only" as const,
  }));
}
