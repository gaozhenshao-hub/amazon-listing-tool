#!/usr/bin/env node
// Metadata-only, local comparison. Never read blobs, inspect the working tree,
// run source scripts, recurse into submodules, load env files, or fetch objects.
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PINNED_REVISIONS } from "./migrationInventory.mjs";

export { PINNED_REVISIONS };
export const CORE_ROOTS = Object.freeze(["client", "server", "shared", "drizzle", "e2e"]);
export const EXPECTED_COUNTS = Object.freeze({ same: 1394, changed: 268, "source-only": 283, "baseline-only": 566 });
export const EXPECTED_CORE_COUNTS = Object.freeze({ changed: 258, "source-only": 185, "baseline-only": 226 });
const execFileAsync = promisify(execFile);
const LIMIT_BYTES = 8 * 1024 * 1024;
const GIT_ENV = Object.freeze({ PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1" });
const KINDS = Object.freeze({ "100644": "regular-file", "100755": "executable-file", "120000": "symbolic-link", "160000": "gitlink" });
const order = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const emptyCounts = () => ({ same: 0, changed: 0, "baseline-only": 0, "source-only": 0 });

class OwnershipError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new OwnershipError(code, message); };
function validatePath(path) {
  if (typeof path !== "string" || !path || path.includes("\0") || path.split("/").some(part => !part || part === "." || part === "..")) {
    fail("TREE_PATH_INVALID", "Git tree contains a noncanonical path.");
  }
}
function validateEntry(entry) {
  validatePath(entry?.path);
  if (!Object.hasOwn(KINDS, entry.mode) || entry.type !== (entry.mode === "160000" ? "commit" : "blob") || typeof entry.objectId !== "string" || !/^[a-f0-9]{40}$/.test(entry.objectId)) {
    fail("TREE_ENTRY_INVALID", "Git tree contains an unsupported object type, mode or ID.");
  }
}

// NUL records and the first TAB preserve tabs/newlines/Unicode in path names.
// Non-UTF8 paths fail explicitly instead of silently merging replacement names.
export function parseTree(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > LIMIT_BYTES) fail("TREE_OUTPUT_INVALID", "Git tree output is invalid or exceeds the bounded metadata size.");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { fail("TREE_PATH_ENCODING", "Git tree has non-UTF8 paths; lossless path review is required."); }
  if (text && !text.endsWith("\0")) fail("TREE_OUTPUT_INVALID", "Git tree output is not NUL terminated.");
  const paths = new Set();
  return (text ? text.slice(0, -1).split("\0") : []).map(record => {
    const tab = record.indexOf("\t");
    const header = /^(\d{6}) (blob|commit) ([a-f0-9]{40})$/.exec(record.slice(0, tab));
    if (tab < 0 || !header) fail("TREE_ENTRY_INVALID", "Unexpected Git tree record.");
    const entry = { path: record.slice(tab + 1), mode: header[1], type: header[2], objectId: header[3] };
    validateEntry(entry);
    if (paths.has(entry.path)) fail("TREE_PATH_DUPLICATE", "Git tree contains duplicate paths.");
    paths.add(entry.path);
    return entry;
  }).sort((left, right) => order(left.path, right.path));
}

// This is routing by name only, NOT code review or a declaration of ownership by
// a person. Broad entry points intentionally remain cross-cutting/manual review.
export function moduleForPath(path) {
  validatePath(path);
  if (path.startsWith("drizzle/")) return "database-schema-and-migrations";
  const domain = /^server\/domains\/([^/]+)\//.exec(path);
  if (domain) return `server-domain:${domain[1]}`;
  if (/^(?:client\/src\/(?:pages|components)\/listing\/)/.test(path) || /(?:^|\/)(?:GeneratePage|Listing|listing|reviewRecovery|useSellingPoint|useListing|sellingPoint|SellingPoint)/.test(path)) return "listing-planning-and-review";
  if (/^client\/src\/(?:pages|components)\/(?:analysis|acquisition)\//.test(path) || /(?:^|\/)(?:AnalysisPage|analysisImport|analysis-import|Acquisition|acquisition|Competitor|competitor|SellerSprite|sellerSprite)/.test(path)) return "analysis-import-and-acquisition";
  if (/^client\/src\/pages\/knowledge\//.test(path) || /(?:^|\/)(?:KBImages|AmazonStyleGallery|KnowledgeImage|ReviewImage|kbImage|kb-image|useBalancedPreview|imageAccess)/.test(path)) return "image-knowledge-and-gallery";
  if (/^client\/src\/pages\/emperor\//.test(path) || /(?:^|\/)(?:Agent|agent|Emperor|emperor|Skill|skill|Workflow|workflow)/.test(path)) return "agents-skills-and-workflows";
  if (/^client\/src\/(?:pages|components)\/ops\//.test(path) || /(?:^|\/)(?:lingxing|Lingxing|saihu|Saihu|localLingxing|parentAsin|ParentAsin|Ops|ops)/.test(path)) return "operations-and-source-sync";
  if (/(?:^|\/)(?:finance|Finance|financial|Financial)/.test(path)) return "finance";
  if (/(?:^|\/)(?:inventory|Inventory|purchase|Purchase|procurement|Procurement)/.test(path)) return "inventory-and-procurement";
  if (/(?:^|\/)(?:workspace|Workspace|permission|Permission|auth|Auth|rbac|RBAC)/.test(path)) return "identity-workspace-and-permissions";
  if (/(?:^|\/)(?:aiJob|AiJob|ai-job|aiRuntime|modelRegistry|modelRouter|llm)/.test(path)) return "ai-runtime-jobs-and-models";
  if (/^(?:scripts\/|deploy\/|\.github\/)/.test(path)) return "tooling-ci-and-release";
  if (/^(?:docs?\/|outputs\/|\.manus\/|attached_assets\/)/.test(path) || /\.(?:md|pdf|docx)$/i.test(path)) return "documentation-and-local-artifacts";
  if (!path.includes("/")) return "root-configuration-and-cross-cutting";
  const root = path.split("/")[0];
  return CORE_ROOTS.includes(root) ? `${root}-cross-cutting-manual-review` : "other-manual-review";
}

function entryMap(entries) {
  const result = new Map();
  for (const entry of entries) {
    validateEntry(entry);
    if (result.has(entry.path)) fail("TREE_PATH_DUPLICATE", "Git tree contains duplicate paths.");
    result.set(entry.path, entry);
  }
  return result;
}
const metadata = entry => entry ? { mode: entry.mode, type: entry.type, objectId: entry.objectId, kind: KINDS[entry.mode] } : null;
export function compareTrees(baselineEntries, sourceEntries) {
  const baseline = entryMap(baselineEntries), source = entryMap(sourceEntries);
  return [...new Set([...baseline.keys(), ...source.keys()])].sort(order).map(path => {
    const left = baseline.get(path), right = source.get(path);
    const delta = left && right ? {
      objectIdChanged: left.objectId !== right.objectId, typeChanged: left.type !== right.type, modeChanged: left.mode !== right.mode,
      blobContentChanged: left.type === "blob" && right.type === "blob" ? left.objectId !== right.objectId : null,
      gitlinkCommitChanged: left.type === "commit" && right.type === "commit" ? left.objectId !== right.objectId : null,
    } : null;
    const status = !left ? "source-only" : !right ? "baseline-only" : delta.objectIdChanged || delta.typeChanged || delta.modeChanged ? "changed" : "same";
    return { path, status, module: moduleForPath(path), coreRoot: CORE_ROOTS.find(root => path.startsWith(`${root}/`)) ?? null,
      baseline: metadata(left), source: metadata(right), delta,
      classification: status === "same" ? "unchanged-retain-baseline" : status === "baseline-only" ? "retain-baseline" : status === "changed" ? "retain-baseline-pending-module-review" : "pending-module-review-no-auto-port",
      reviewRequired: status !== "same", automaticPortAllowed: false,
    };
  });
}

export function summarizeEntries(entries) {
  const counts = emptyCounts(), objectIdentityCounts = emptyCounts();
  for (const entry of entries) {
    counts[entry.status]++;
    // This reproduces a blob-content comparison for these pinned trees. It also
    // labels non-blob IDs truthfully as object identity, never file contents.
    const status = entry.status === "changed" && !entry.delta.objectIdChanged && !entry.delta.typeChanged ? "same" : entry.status;
    objectIdentityCounts[status]++;
  }
  return { ...counts, baselineTotal: counts.same + counts.changed + counts["baseline-only"], sourceTotal: counts.same + counts.changed + counts["source-only"], unionTotal: entries.length,
    objectIdentityCounts,
    blobContentChanged: entries.filter(entry => entry.delta?.blobContentChanged).length,
    modeChanged: entries.filter(entry => entry.delta?.modeChanged).length,
    modeOnlyChanged: entries.filter(entry => entry.delta?.modeChanged && !entry.delta.objectIdChanged && !entry.delta.typeChanged).length,
    typeChanged: entries.filter(entry => entry.delta?.typeChanged).length,
    gitlinkCommitChanged: entries.filter(entry => entry.delta?.gitlinkCommitChanged).length,
    gitlinkPaths: entries.filter(entry => entry.baseline?.kind === "gitlink" || entry.source?.kind === "gitlink").length,
    symlinkPaths: entries.filter(entry => entry.baseline?.kind === "symbolic-link" || entry.source?.kind === "symbolic-link").length,
  };
}

export function buildReport(baselineEntries, sourceEntries) {
  const entries = compareTrees(baselineEntries, sourceEntries);
  const summary = summarizeEntries(entries), coreEntries = entries.filter(entry => entry.coreRoot), core = summarizeEntries(coreEntries);
  const compareExpected = comparisons => comparisons.flatMap(([scope, expected, actual]) => Object.entries(expected)
    .filter(([key, value]) => actual[key] !== value).map(([key, value]) => ({ scope, category: key, expected: value, actual: actual[key] })));
  const mismatches = compareExpected([["all", EXPECTED_COUNTS, summary.objectIdentityCounts], ["core", EXPECTED_CORE_COUNTS, core.objectIdentityCounts]]);
  const strictTreeMismatches = compareExpected([["all", EXPECTED_COUNTS, summary], ["core", EXPECTED_CORE_COUNTS, core]]);
  return { ok: true, schemaVersion: 1, mode: "pinned-git-tree-ownership", readOnly: true, pinnedRevisions: PINNED_REVISIONS,
    sourceContentsRead: false, workingTreeInspected: false, remoteAccessed: false, environmentFilesLoaded: false, automaticPortAllowed: false,
    limitations: [
      "Only immutable local commit trees are compared; HEAD, staged, unstaged and untracked changes are excluded.",
      "All tracked paths are included, including local artifacts and environment-file names; no blob bytes, symlink targets or credentials are read.",
      "same requires matching path, object ID, Git type and mode; blobContentChanged concerns blob IDs only, including symlink-target blobs.",
      "The plan's content counts are compared using object ID and type, excluding modes; strictTreeMismatches separately exposes mode-only differences.",
      "Gitlinks are commit pointers, not file contents; submodule trees are not traversed. Non-UTF8 paths fail closed.",
      "Module labels are path heuristics, not content review or a complete dependency graph. No common ancestor is assumed and renames are not inferred.",
      "All differences require module review; baseline-only files are retained, not deleted. A successful report is not integration or deployment approval.",
      "JSON includes private source path names. Keep stdout local; this command never writes a snapshot file.",
    ],
    summary, core: { roots: CORE_ROOTS, ...core,
      byRoot: Object.fromEntries(CORE_ROOTS.map(root => [root, summarizeEntries(entries.filter(entry => entry.coreRoot === root))])),
      baselineOnlyTestFiles: coreEntries.filter(entry => entry.status === "baseline-only" && /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.path)).length,
    },
    planComparison: { basis: "object-id-and-type-excluding-mode", matches: mismatches.length === 0,
      expectedAll: EXPECTED_COUNTS, expectedCore: EXPECTED_CORE_COUNTS, mismatches, strictTreeMismatches },
    modules: Object.fromEntries([...new Set(entries.map(entry => entry.module))].sort(order)
      .map(module => [module, summarizeEntries(entries.filter(entry => entry.module === module))])),
    entries,
  };
}

async function gitMetadata(directory, args) {
  try {
    const { stdout } = await execFileAsync("git", ["--no-replace-objects", "-c", "core.fsmonitor=false", "-c", "protocol.allow=never", "-C", directory, ...args],
      { encoding: "buffer", maxBuffer: LIMIT_BYTES, timeout: 15000, env: GIT_ENV });
    return stdout;
  } catch { fail("GIT_READ_FAILED", "Could not read the fixed local Git tree; no fetch, source script or blob read was performed."); }
}

// The injectable reader is for pure tests; the CLI always uses gitMetadata.
export async function readPinnedTree(directory, role, read = gitMetadata) {
  if (!Object.hasOwn(PINNED_REVISIONS, role)) fail("UNKNOWN_SOURCE_ROLE", "Unknown snapshot role.");
  const sha = PINNED_REVISIONS[role];
  if (String(await read(directory, ["rev-parse", "--verify", `${sha}^{commit}`])).trim() !== sha) fail("SOURCE_SHA_MISMATCH", "The exact pinned commit is not available locally.");
  return parseTree(await read(directory, ["ls-tree", "-r", "-z", "--full-tree", sha]));
}

export function parseArguments(args) {
  if (args.length === 1 && args[0] === "--help") return { help: true };
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    if (!["--baseline-dir", "--source-dir"].includes(name) || Object.hasOwn(options, name) || !value || value.startsWith("--") || value.includes("\0")) {
      fail("CLI_ARGUMENTS_INVALID", "Supply both local directories exactly once; apply, output-file and revision overrides do not exist.");
    }
    options[name] = resolve(value);
  }
  if (!options["--baseline-dir"] || !options["--source-dir"]) fail("CLI_ARGUMENTS_INVALID", "Both local source directories are required.");
  return { baselineDirectory: options["--baseline-dir"], sourceDirectory: options["--source-dir"] };
}

export async function main(args) {
  try {
    const options = parseArguments(args);
    if (options.help) return { exitCode: 0, output: { usage: "node scripts/integration/sourceOwnership.mjs --baseline-dir <local baseline repository> --source-dir <local source repository>",
      pinnedRevisions: PINNED_REVISIONS, readOnly: true, stdoutOnly: true, mismatchExitCode: 2 } };
    const [baseline, source] = await Promise.all([readPinnedTree(options.baselineDirectory, "baseline"), readPinnedTree(options.sourceDirectory, "source")]);
    const output = buildReport(baseline, source);
    return { exitCode: output.planComparison.matches ? 0 : 2, output };
  } catch (error) {
    return { exitCode: 1, output: { ok: false, readOnly: true, error: { code: error instanceof OwnershipError ? error.code : "OWNERSHIP_FAILED",
      message: error instanceof OwnershipError ? error.message : "Metadata comparison failed; source contents, path arguments and environment are not included." } } };
  }
}

if (process.argv[1]) {
  // Handles macOS /var -> /private/var without running when imported.
  if (realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
    const result = await main(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
    process.exitCode = result.exitCode;
  }
}
