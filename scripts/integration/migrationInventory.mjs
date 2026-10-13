#!/usr/bin/env node
// Read pinned Git objects only. Never import the runners being inspected: they
// load environment variables and database drivers even in their planning path.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

export const PINNED_REVISIONS = Object.freeze({
  baseline: "927a5d71f43e6a35e04c1fbd7a82a48244ab4141",
  source: "383b69e6bc9d8b3d2f1d380422390ea200541628",
});
const RUNNER = "scripts/run-database-migrations.mjs";
const JOURNAL = "drizzle/meta/_journal.json";
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*\.sql$/;
const execFileAsync = promisify(execFile);
const LIMIT_BYTES = 8 * 1024 * 1024;
const REGISTRIES = Object.freeze({
  supplementalMigrations: "general",
  retiredMigrationFiles: "retired",
  dedicatedMigrationFiles: "dedicated",
  unreleasedDraftMigrationFiles: "unreleased-draft",
  imageQualityDevelopmentMigrationFiles: "dedicated-development",
  imageQualityProductionMigrationFiles: "dedicated-production",
  legacyManuallyReleasedMigrationFiles: "legacy-manually-released",
});

class InventoryError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const fail = (code, message) => { throw new InventoryError(code, message); };
const sha256 = value => createHash("sha256").update(value).digest("hex");
const sorted = values => [...new Set(values)].sort();
const duplicates = values => sorted(values.filter((value, index) => values.indexOf(value) !== index));
const numberOf = name => /^(\d{4}[a-z]?)_/i.exec(name)?.[1] ?? null;

// This is deliberately a literal-list reader, not a JavaScript evaluator.
// Preserve quoted strings while removing comments so commented registrations
// cannot silently enter the inventory. Dynamic array expressions fail closed.
function withoutComments(source) {
  let result = "", quote = null;
  for (let i = 0; i < source.length; i++) {
    const char = source[i], next = source[i + 1];
    if (quote) {
      result += char;
      if (char === "\\") result += source[++i] ?? "";
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char; result += char;
    } else if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      result += "\n";
    } else if (char === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        result += source[i] === "\n" ? "\n" : " "; i++;
      }
      i++;
    } else result += char;
  }
  return result;
}

export function parseLiteralRegistry(source, name, required = false) {
  if (!Object.hasOwn(REGISTRIES, name)) fail("UNKNOWN_REGISTRY", "Unknown registry name.");
  const clean = withoutComments(source);
  const declaration = new RegExp(`(?:^|\\n)\\s*const\\s+${name}\\s*=`, "g");
  const declarations = [...clean.matchAll(declaration)];
  if (!declarations.length) {
    if (required) fail("REGISTRY_MISSING", "A required static registry is missing.");
    return [];
  }
  if (declarations.length !== 1) fail("REGISTRY_AMBIGUOUS", "Registry declaration is ambiguous.");
  const rest = clean.slice(declarations[0].index + declarations[0][0].length);
  const array = /^\s*(new\s+Set\s*\(\s*)?\[([\s\S]*?)\]\s*(\))?\s*;/.exec(rest);
  if (!array || Boolean(array[1]) !== Boolean(array[3])) {
    fail("REGISTRY_NOT_LITERAL", "Registry must be a static array or Set of file names.");
  }
  let body = array[2].trim();
  const values = [];
  while (body) {
    const entry = /^(?:"([^"\\]*)"|'([^'\\]*)')\s*(,|$)/.exec(body);
    const value = entry?.[1] ?? entry?.[2];
    if (!entry || !FILE_NAME.test(value)) {
      fail("REGISTRY_NOT_LITERAL", "Registry contains a non-literal or unsafe file name.");
    }
    values.push(value);
    body = body.slice(entry[0].length).trim();
  }
  return values;
}

function parseJournal(contents) {
  let journal;
  try { journal = JSON.parse(contents); } catch { fail("JOURNAL_INVALID", "Invalid migration journal."); }
  if (!Array.isArray(journal?.entries)) fail("JOURNAL_INVALID", "Journal entries are missing.");
  return journal.entries.map(entry => {
    if (typeof entry?.tag !== "string" || !FILE_NAME.test(`${entry.tag}.sql`)) {
      fail("JOURNAL_INVALID", "Journal contains an invalid migration tag.");
    }
    return `${entry.tag}.sql`;
  });
}

export function staticScriptWarnings(files) {
  const warnings = [];
  for (const [path, content] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^scripts\/[A-Za-z0-9_./-]+\.(?:[cm]?js|ts|sh)$/.test(path) || path === RUNNER || /\.test\./.test(path)) continue;
    const text = String(content);
    const referencedSqlFiles = sorted([...text.matchAll(/\bdrizzle\/([A-Za-z0-9_.-]+\.sql)\b/g)].map(match => match[1]));
    const createsTables = sorted([...text.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:\\?[`"])?([A-Za-z_][A-Za-z0-9_]*)/gi)].map(match => match[1]));
    const hasCreateTable = /\bCREATE\s+TABLE\b/i.test(text);
    if (referencedSqlFiles.length || hasCreateTable) warnings.push({
      path, sha256: sha256(content), referencedSqlFiles, createsTables,
      dynamicOrUnparsedCreateTable: hasCreateTable && createsTables.length === 0,
      classification: "static-reference-only-not-executed",
    });
  }
  return warnings;
}

// Pure entry point for synthetic tests. Production callers use the pinned Git
// reader below; no function imports repository code or connects to a database.
export function inventorySnapshot(files, commit) {
  if (!Object.hasOwn(files, RUNNER) || !Object.hasOwn(files, JOURNAL)) {
    fail("METADATA_MISSING", "Runner or journal is absent from the pinned snapshot.");
  }
  const runner = String(files[RUNNER]);
  const journalFiles = parseJournal(String(files[JOURNAL]));
  const registries = Object.fromEntries(Object.keys(REGISTRIES).map(name => [name,
    parseLiteralRegistry(runner, name, name === "supplementalMigrations" || name === "retiredMigrationFiles"),
  ]));
  const plan = [...journalFiles, ...registries.supplementalMigrations];
  const sqlFiles = Object.entries(files).filter(([path]) => /^drizzle\/[^/]+\.sql$/.test(path)).map(([path, content]) => {
    const name = path.slice("drizzle/".length);
    if (!FILE_NAME.test(name)) fail("FILE_NAME_INVALID", "A migration has an unsupported file name.");
    const memberships = [
      ...(journalFiles.includes(name) ? ["journal"] : []),
      ...Object.entries(registries).filter(([, names]) => names.includes(name)).map(([key]) => REGISTRIES[key]),
    ];
    return { name, number: numberOf(name), sha256: sha256(content), bytes: Buffer.byteLength(content),
      memberships, inGeneralPlan: plan.includes(name),
      executionBlocked: memberships.some(value => ["unreleased-draft", "legacy-manually-released", "retired"].includes(value)),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const available = new Set(sqlFiles.map(file => file.name));
  const registered = sorted([...journalFiles, ...Object.values(registries).flat()]);
  return {
    commit,
    runnerSha256: sha256(files[RUNNER]), journalSha256: sha256(files[JOURNAL]),
    sqlFileCount: sqlFiles.length, journalCount: journalFiles.length,
    generalPlan: plan.map((name, index) => ({ name, order: index + 1 })),
    files: sqlFiles,
    unregisteredSql: sqlFiles.filter(file => !file.memberships.length).map(file => file.name),
    missingRegisteredSql: registered.filter(name => !available.has(name)),
    duplicateGeneralPlanFiles: duplicates(plan),
    blockedFilesInGeneralPlan: sqlFiles.filter(file => file.executionBlocked && file.inGeneralPlan).map(file => file.name),
    nestedSqlOutsideRunner: Object.keys(files).filter(path => /^drizzle\/.*\/.*\.sql$/.test(path)).sort(),
    standaloneScriptWarnings: staticScriptWarnings(files),
  };
}

export function compareInventories(baseline, source) {
  const left = new Map(baseline.files.map(file => [file.name, file]));
  const right = new Map(source.files.map(file => [file.name, file]));
  const common = [...left.keys()].filter(name => right.has(name)).sort();
  const numbers = sorted([...baseline.files, ...source.files].map(file => file.number).filter(Boolean));
  const numberCollisions = numbers.map(number => ({
    number,
    baselineFiles: baseline.files.filter(file => file.number === number).map(file => file.name),
    sourceFiles: source.files.filter(file => file.number === number).map(file => file.name),
  })).filter(group => new Set([...group.baselineFiles, ...group.sourceFiles]).size > 1)
    .map(group => ({ ...group, ledgerOverwriteImplied: false }));
  const historical0196To0201 = sorted([...left.keys(), ...right.keys()])
    .filter(name => /^(019[6-9]|020[01])_/.test(name)).map(name => ({
      name,
      baselineMemberships: left.get(name)?.memberships ?? [],
      sourceMemberships: right.get(name)?.memberships ?? [],
      reintroducedToGeneralPlan: Boolean(left.get(name)?.memberships.includes("legacy-manually-released") && right.get(name)?.inGeneralPlan),
      databaseAppliedState: "not-inspected",
    }));
  return {
    sameNameSameHashCount: common.filter(name => left.get(name).sha256 === right.get(name).sha256).length,
    sameNameDifferentHash: common.filter(name => left.get(name).sha256 !== right.get(name).sha256).map(name => ({
      name, baselineSha256: left.get(name).sha256, sourceSha256: right.get(name).sha256,
    })),
    baselineOnly: [...left.keys()].filter(name => !right.has(name)).sort(),
    sourceOnly: [...right.keys()].filter(name => !left.has(name)).sort(),
    numberCollisions,
    duplicateNumbersWithinRepository: {
      baseline: numberCollisions.filter(group => group.baselineFiles.length > 1).map(group => ({ number: group.number, files: group.baselineFiles })),
      source: numberCollisions.filter(group => group.sourceFiles.length > 1).map(group => ({ number: group.number, files: group.sourceFiles })),
    },
    historical0196To0201,
  };
}

async function git(directory, args) {
  try {
    const { stdout } = await execFileAsync("git", ["--no-replace-objects", "-c", "core.fsmonitor=false", "-c", "protocol.allow=never", "-C", directory, ...args], {
      encoding: "buffer", maxBuffer: LIMIT_BYTES,
      // Do not pass database credentials or inherited GIT_* overrides to Git.
      env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1" },
    });
    return stdout;
  } catch { fail("GIT_READ_FAILED", "Could not read the local Git snapshot; no scripts or SQL were executed."); }
}

export function assertPinnedHead(role, actualHead) {
  if (!Object.hasOwn(PINNED_REVISIONS, role)) fail("UNKNOWN_SOURCE_ROLE", "Unknown snapshot role.");
  if (actualHead !== PINNED_REVISIONS[role]) fail("SOURCE_SHA_MISMATCH", "Source HEAD does not match the fixed review revision.");
}

export async function readPinnedSnapshot(directory, role) {
  const head = String(await git(directory, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
  assertPinnedHead(role, head);
  const entries = String(await git(directory, ["ls-tree", "-rz", "--full-tree", head, "--", "drizzle", "scripts"]))
    .split("\0").filter(Boolean).map(entry => {
      const match = /^(\d+) blob ([0-9a-f]{40})\t(.+)$/.exec(entry);
      if (!match) fail("TREE_ENTRY_INVALID", "Unexpected Git tree entry.");
      return { mode: match[1], oid: match[2], path: match[3] };
    }).filter(entry => entry.path === RUNNER || entry.path === JOURNAL || /^drizzle\/.*\.sql$/.test(entry.path) || /^scripts\/.*\.(?:[cm]?js|ts|sh)$/.test(entry.path));
  const files = {};
  // Bounded concurrency avoids spawning a process per object simultaneously.
  for (let offset = 0; offset < entries.length; offset += 8) {
    await Promise.all(entries.slice(offset, offset + 8).map(async entry => {
      if (!/^100(?:644|755)$/.test(entry.mode) || !/^[A-Za-z0-9_./-]+$/.test(entry.path)) {
        fail("TREE_ENTRY_UNSAFE", "Selected source is not a regular file with a safe relative name.");
      }
      files[entry.path] = await git(directory, ["cat-file", "blob", entry.oid]);
    }));
  }
  // Catch a checkout changed while reading. Blob reads themselves are immutable.
  assertPinnedHead(role, String(await git(directory, ["rev-parse", "--verify", "HEAD^{commit}"])).trim());
  return inventorySnapshot(files, head);
}

export function parseArguments(args) {
  if (args.length === 1 && args[0] === "--help") return { help: true };
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    if (!["--baseline-dir", "--source-dir"].includes(name) || Object.hasOwn(options, name) || !value || value.startsWith("--")) {
      fail("CLI_ARGUMENTS_INVALID", "Supply each of --baseline-dir and --source-dir exactly once; no apply mode exists.");
    }
    options[name] = resolve(value);
  }
  if (!options["--baseline-dir"] || !options["--source-dir"]) fail("CLI_ARGUMENTS_INVALID", "Both source directories must be explicitly supplied.");
  return { baselineDirectory: options["--baseline-dir"], sourceDirectory: options["--source-dir"] };
}

export async function main(args) {
  try {
    const options = parseArguments(args);
    if (options.help) return { exitCode: 0, output: { usage: "node scripts/integration/migrationInventory.mjs --baseline-dir <927a5d7 checkout> --source-dir <383b69e checkout>", pinnedRevisions: PINNED_REVISIONS, readOnly: true } };
    const [baseline, source] = await Promise.all([
      readPinnedSnapshot(options.baselineDirectory, "baseline"),
      readPinnedSnapshot(options.sourceDirectory, "source"),
    ]);
    return { exitCode: 0, output: {
      ok: true, schemaVersion: 1, mode: "pinned-git-static-inventory", readOnly: true,
      databaseInspected: false, scriptsExecuted: false, deploymentApproved: false,
      limitations: [
        "Only pinned Git blobs are inspected; working-tree changes are excluded.",
        "Registry lists are statically parsed, not executed; this is not a migration runner dry run.",
        "The ledger key is the complete file name: numeric prefix collisions alone do not overwrite ledger rows.",
        "Historical retirement reflects source policy, not verified production schema or applied ledger state.",
        "Standalone script references are heuristic warnings, not a complete dependency graph or proof of execution.",
        "Exit code 0 means the inventory completed, not that migration or deployment is safe.",
      ],
      baseline, source, comparison: compareInventories(baseline, source),
    } };
  } catch (error) {
    return { exitCode: 1, output: { ok: false, readOnly: true, error: {
      code: error instanceof InventoryError ? error.code : "INVENTORY_FAILED",
      message: error instanceof InventoryError ? error.message : "Inventory failed; source contents and environment are not included.",
    } } };
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const result = await main(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
  process.exitCode = result.exitCode;
}
