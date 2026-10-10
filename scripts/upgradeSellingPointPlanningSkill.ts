import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import mysql, { type Connection } from "mysql2/promise";
import { LISTING_OGILVY_ROLE_MARKER, type GovernedSkillManifest } from "../server/domains/ai_os/services/highQualitySkillGovernance";
import {
  buildSellingPointPlanningManifest, SELLING_POINT_PLANNING_SKILL_SLUG,
  SELLING_POINT_PLANNING_PROMPT_MARKER, SELLING_POINT_PLANNING_CONTRACT_VERSION,
} from "../server/domains/listing/services/sellingPointPlanningPromptPolicy";

export type UpgradeOptions = { apply: boolean; expectedVersion?: number };
export type PlanningSkillRow = {
  id: number; slug: string; workspaceId: number | null; version: number; status: string;
  manifest: unknown; modelOverride: string | null; timeout_seconds: number;
};
type UpgradeConnection = Pick<Connection, "execute" | "beginTransaction" | "commit" | "rollback">;

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => nested && typeof nested === "object" && !Array.isArray(nested)
    ? Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left.localeCompare(right))) : nested);
}

function parseManifest(value: unknown): GovernedSkillManifest {
  const manifest = typeof value === "string" ? JSON.parse(value) : value;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Skill manifest 必须为对象，停止升级");
  for (const key of ["implementation", "contract"]) {
    const item = (manifest as Record<string, unknown>)[key];
    if (item !== undefined && (!item || typeof item !== "object" || Array.isArray(item))) throw new Error(`Skill ${key} 必须为对象，停止升级`);
  }
  return manifest as GovernedSkillManifest;
}

export function parseUpgradeOptions(args: string[]): UpgradeOptions {
  const result: UpgradeOptions = { apply: false };
  let modeSeen = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--apply" || arg === "--preview") {
      if (modeSeen) throw new Error("只允许一个 --apply 或 --preview 参数");
      modeSeen = true;
      result.apply = arg === "--apply";
    } else if (arg === "--expected-version" || arg.startsWith("--expected-version=")) {
      if (result.expectedVersion !== undefined) throw new Error("预期版本参数重复");
      const value = arg === "--expected-version" ? args[++index] : arg.slice("--expected-version=".length);
      if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("--expected-version 必须为正整数");
      result.expectedVersion = Number(value);
    } else throw new Error(`未知参数: ${arg}`);
  }
  if (result.apply && result.expectedVersion === undefined) throw new Error("--apply 必须显式指定 --expected-version");
  return result;
}

export function buildSellingPointPlanningChange(row: PlanningSkillRow) {
  if (row.slug !== SELLING_POINT_PLANNING_SKILL_SLUG || row.status !== "Released") throw new Error("目标必须为已发布的七条卖点规划 Skill");
  if (!Number.isSafeInteger(row.version) || row.version < 1 || row.version === Number.MAX_SAFE_INTEGER) throw new Error("Skill 版本非法");
  const current = parseManifest(row.manifest);
  const manifest = buildSellingPointPlanningManifest(row.slug, current);
  const prompt = String(manifest.implementation?.systemPrompt || "");
  if (prompt.split(LISTING_OGILVY_ROLE_MARKER).length !== 2 || prompt.split(SELLING_POINT_PLANNING_PROMPT_MARKER).length !== 2) {
    throw new Error("七条卖点规划角色或任务合同标记不匹配");
  }
  return { current, manifest, changed: canonicalJson(current) !== canonicalJson(manifest) };
}

function snapshotHash(row: PlanningSkillRow, manifest: GovernedSkillManifest): string {
  return createHash("sha256").update(canonicalJson({ manifest, modelOverride: row.modelOverride, status: row.status })).digest("hex");
}

async function saveSnapshot(connection: UpgradeConnection, row: PlanningSkillRow, manifest: GovernedSkillManifest, version: number, source: string) {
  const hash = snapshotHash(row, manifest);
  const [inserted] = await connection.execute(
    `INSERT IGNORE INTO emperor_skill_version_snapshots
      (snapshotId,workspaceId,skillSlug,skillVersion,snapshotHash,source,status,manifest,modelOverride,createdBy)
     VALUES (?,?,?,?,?,?,?,?,?,NULL)`,
    [`skill_snapshot_${randomUUID().replace(/-/g, "").slice(0, 24)}`, row.workspaceId, row.slug, String(version), hash, source, row.status, JSON.stringify(manifest), row.modelOverride],
  );
  if ((inserted as { affectedRows: number }).affectedRows === 1) return 1;
  // INSERT IGNORE must not turn a non-duplicate database failure into success.
  const [existing] = await connection.execute(
    `SELECT snapshotId FROM emperor_skill_version_snapshots
     WHERE workspaceId <=> ? AND skillSlug=? AND skillVersion=? AND snapshotHash=? LIMIT 1`,
    [row.workspaceId, row.slug, String(version), hash],
  );
  if (!Array.isArray(existing) || existing.length !== 1) throw new Error(`Skill 版本 ${version} 快照未保存，停止升级`);
  return 0;
}

/** No job creation or workflow restart: this transaction only versions one runtime manifest. */
export async function runSellingPointPlanningUpgrade(connection: UpgradeConnection, options: UpgradeOptions) {
  if (options.apply && (!Number.isSafeInteger(options.expectedVersion) || Number(options.expectedVersion) < 1)) {
    throw new Error("--apply 必须显式指定有效的 --expected-version");
  }
  // Range-lock the active rollout index during apply, including the empty range.
  // This prevents a concurrent activation from silently making another prompt effective.
  if (options.apply) await connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  await connection.beginTransaction();
  try {
    const lock = options.apply ? " FOR UPDATE" : "";
    const [raw] = await connection.execute(
      `SELECT id,slug,workspaceId,version,status,manifest,modelOverride,timeout_seconds FROM emperor_skills WHERE slug=?${lock}`,
      [SELLING_POINT_PLANNING_SKILL_SLUG],
    );
    if (!Array.isArray(raw) || raw.length !== 1) throw new Error("目标 Skill 缺失或存在多个目标，停止升级");
    const row = raw[0] as PlanningSkillRow;
    if (options.expectedVersion !== undefined && row.version !== options.expectedVersion) throw new Error(`Skill 版本已改变：预期 ${options.expectedVersion}，实际 ${row.version}`);
    const [rollouts] = await connection.execute(
      `SELECT planId FROM emperor_skill_rollout_plans WHERE skillSlug=? AND status='active'${lock}`,
      [SELLING_POINT_PLANNING_SKILL_SLUG],
    );
    if (!Array.isArray(rollouts) || rollouts.length) throw new Error("该 Skill 存在 active rollout 或状态无法确认，停止升级");
    const next = buildSellingPointPlanningChange(row);
    const summary = {
      schema: SELLING_POINT_PLANNING_CONTRACT_VERSION,
      mode: options.apply ? "apply" : "preview",
      skillId: row.id, slug: row.slug, workspaceId: row.workspaceId,
      currentVersion: row.version, nextVersion: row.version + Number(next.changed), changed: next.changed,
      promptMarker: SELLING_POINT_PLANNING_PROMPT_MARKER,
      beforeHash: snapshotHash(row, next.current), afterHash: snapshotHash(row, next.manifest),
      modelOverride: row.modelOverride, modelPolicy: next.current.implementation?.modelPolicy,
      timeoutSeconds: row.timeout_seconds, snapshotsCreated: 0,
      rerunJobs: false,
    };
    if (options.apply && next.changed) {
      summary.snapshotsCreated += await saveSnapshot(connection, row, next.current, row.version, "sellingpoint_plan_before");
      const [updated] = await connection.execute(
        `UPDATE emperor_skills SET manifest=?,version=version+1,updatedAt=NOW()
         WHERE id=? AND slug=? AND workspaceId <=> ? AND version=? AND status='Released'`,
        [JSON.stringify(next.manifest), row.id, row.slug, row.workspaceId, row.version],
      );
      if ((updated as { affectedRows: number }).affectedRows !== 1) throw new Error("Skill 版本竞争，停止升级");
      summary.snapshotsCreated += await saveSnapshot(connection, row, next.manifest, row.version + 1, "sellingpoint_plan_after");
    }
    if (options.apply) await connection.commit(); else await connection.rollback();
    return summary;
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

export function isUpgradeEntryPoint(moduleUrl: string, argvEntry?: string): boolean {
  if (!argvEntry) return false;
  const entryPath = resolve(argvEntry);
  const modulePath = fileURLToPath(moduleUrl);
  if (entryPath === modulePath) return true;
  // Production often invokes /current/... while import.meta.url resolves to a
  // release directory. Comparing only the spelling would silently skip main.
  try { return realpathSync(entryPath) === realpathSync(modulePath); } catch { return false; }
}

async function main() {
  const options = parseUpgradeOptions(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("数据库运行环境未配置");
  const connection = await mysql.createConnection({ uri: process.env.DATABASE_URL, multipleStatements: false });
  try {
    console.log(JSON.stringify(await runSellingPointPlanningUpgrade(connection, options)));
  } finally {
    await connection.end();
  }
}

// Works for both tsx source execution and esbuild *.bundle.mjs execution.
if (isUpgradeEntryPoint(import.meta.url, process.argv[1])) {
  void main().catch(error => {
    console.error(JSON.stringify({ schema: SELLING_POINT_PLANNING_CONTRACT_VERSION, status: "failed", reason: error instanceof Error ? error.message : "unknown" }));
    process.exitCode = 1;
  });
}
