import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PINNED_REVISIONS, CORE_ROOTS, EXPECTED_COUNTS, EXPECTED_CORE_COUNTS, parseTree, compareTrees,
  summarizeEntries, moduleForPath, buildReport, readPinnedTree, parseArguments, main } from "./sourceOwnership.mjs";

const a = "a".repeat(40), b = "b".repeat(40);
const entry = (path, objectId = a, mode = "100644", type = mode === "160000" ? "commit" : "blob") => ({ path, objectId, mode, type });
const encoded = entries => Buffer.from(entries.map(item => `${item.mode} ${item.type} ${item.objectId}\t${item.path}\0`).join(""));
const secret = "synthetic-credential-do-not-print";

test("uses exactly the shared fixed commit pins and fixed core directories", () => {
  assert.deepEqual(PINNED_REVISIONS, { baseline: "927a5d71f43e6a35e04c1fbd7a82a48244ab4141", source: "383b69e6bc9d8b3d2f1d380422390ea200541628" });
  assert.ok(Object.isFrozen(PINNED_REVISIONS));
  assert.deepEqual(CORE_ROOTS, ["client", "server", "shared", "drizzle", "e2e"]);
});

test("NUL Git tree parsing preserves unusual valid paths and sorts deterministically", () => {
  const rows = [entry("中文/空 格.ts"), entry("tabs\tand\nnewlines"), entry("a\\backslash"), entry("-leading-dash")];
  assert.deepEqual(parseTree(encoded(rows)).map(item => item.path), ["-leading-dash", "a\\backslash", "tabs\tand\nnewlines", "中文/空 格.ts"]);
  assert.deepEqual(parseTree(Buffer.alloc(0)), []);
});

test("parsing preserves regular/executable, symlink and gitlink metadata without dereferencing", () => {
  const rows = [entry("regular"), entry("executable", b, "100755"), entry("symbolic", a, "120000"), entry("submodule", b, "160000")];
  const result = parseTree(encoded(rows));
  assert.equal(result.find(item => item.path === "submodule").type, "commit");
  assert.equal(result.find(item => item.path === "symbolic").mode, "120000");
  assert.equal(result.length, 4);
});

test("rejects malformed, non-UTF8, truncated, duplicate and unsupported tree entries", () => {
  for (const bytes of [Buffer.from("not a tree\0"), encoded([entry("a")]).subarray(0, -1), encoded([entry("a"), entry("a")]),
    encoded([entry("a", "short")]), encoded([entry("a", a, "040000", "tree")]), encoded([entry("a", a, "160000", "blob")]),
    encoded([entry("a", a, "100644", "commit")]), Buffer.concat([Buffer.from(`100644 blob ${a}\t`), Buffer.from([0xff, 0])]),
    Buffer.from("\0"), Buffer.alloc(8 * 1024 * 1024 + 1)]) assert.throws(() => parseTree(bytes));
  assert.throws(() => parseTree("string"), { code: "TREE_OUTPUT_INVALID" });
});

test("noncanonical relative tree paths fail instead of disappearing from the comparison", () => {
  for (const path of ["", "/root", "../secret", "a/../b", "a/./b", "a//b", "a/", "a\0b"]) {
    assert.throws(() => compareTrees([entry(path)], []), { code: "TREE_PATH_INVALID" });
  }
  assert.throws(() => compareTrees([entry("a"), entry("a")], []), { code: "TREE_PATH_DUPLICATE" });
});

test("includes all tracked paths, even artifacts and environment names, as metadata only", () => {
  const rows = [entry(".env"), entry(".manus/db/private.json"), entry("attached_assets/photo.png"), entry("docs/private.md")];
  const result = compareTrees(rows, rows);
  assert.equal(result.length, 4);
  assert.ok(result.every(item => item.status === "same" && item.coreRoot === null));
  assert.deepEqual(result[0].baseline, { mode: "100644", type: "blob", objectId: a, kind: "regular-file" });
});

test("distinguishes same, changed, baseline-only and source-only while retaining exact metadata", () => {
  const result = compareTrees([entry("same"), entry("changed"), entry("old")], [entry("same"), entry("changed", b), entry("new")]);
  assert.deepEqual(result.map(item => [item.path, item.status]), [["changed", "changed"], ["new", "source-only"], ["old", "baseline-only"], ["same", "same"]]);
  assert.equal(result[0].delta.blobContentChanged, true);
  assert.equal(result[0].baseline.objectId, a);
  assert.equal(result[0].source.objectId, b);
  assert.equal(result[1].baseline, null);
  assert.equal(result[2].source, null);
});

test("identical bytes with a changed executable mode are changed, not content-changed", () => {
  const result = compareTrees([entry("run.sh")], [entry("run.sh", a, "100755")]);
  assert.equal(result[0].status, "changed");
  assert.deepEqual(result[0].delta, { objectIdChanged: false, typeChanged: false, modeChanged: true, blobContentChanged: false, gitlinkCommitChanged: null });
  assert.equal(summarizeEntries(result).modeOnlyChanged, 1);
  assert.equal(summarizeEntries(result).blobContentChanged, 0);
  assert.equal(summarizeEntries(result).objectIdentityCounts.same, 1);
  assert.equal(summarizeEntries(result).objectIdentityCounts.changed, 0);
});

test("gitlink changes are commit-pointer changes, never mislabeled as blob-content changes", () => {
  const result = compareTrees([entry("module", a, "160000")], [entry("module", b, "160000")]);
  assert.equal(result[0].baseline.kind, "gitlink");
  assert.equal(result[0].delta.gitlinkCommitChanged, true);
  assert.equal(result[0].delta.blobContentChanged, null);
  assert.equal(summarizeEntries(result).gitlinkCommitChanged, 1);
});

test("type transitions and symlink-target blob changes remain explicit", () => {
  const result = compareTrees([entry("module", a, "160000"), entry("link", a, "120000")], [entry("module", b), entry("link", b, "120000")]);
  assert.equal(result.find(item => item.path === "module").delta.typeChanged, true);
  assert.equal(result.find(item => item.path === "module").delta.blobContentChanged, null);
  assert.equal(result.find(item => item.path === "link").delta.blobContentChanged, true);
  assert.equal(summarizeEntries(result).symlinkPaths, 1);
  assert.equal(summarizeEntries(result).gitlinkPaths, 1);
});

test("every difference is conservative and requires review; source-only never means approved copy", () => {
  const result = compareTrees([entry("same"), entry("changed"), entry("old")], [entry("same"), entry("changed", b), entry("new")]);
  assert.ok(result.every(item => item.automaticPortAllowed === false));
  assert.ok(result.filter(item => item.status !== "same").every(item => item.reviewRequired && item.module));
  assert.equal(result.find(item => item.path === "old").classification, "retain-baseline");
  assert.equal(result.find(item => item.path === "changed").classification, "retain-baseline-pending-module-review");
  assert.equal(result.find(item => item.path === "new").classification, "pending-module-review-no-auto-port");
});

test("module routing is path-based with explicit domain and cross-cutting fallbacks", () => {
  const cases = {
    "drizzle/0200.sql": "database-schema-and-migrations", "server/domains/ops/routers/foo.ts": "server-domain:ops",
    "client/src/pages/GeneratePage.tsx": "listing-planning-and-review", "server/analysisImportJob.test.ts": "analysis-import-and-acquisition",
    "client/src/components/AmazonStyleGallery.tsx": "image-knowledge-and-gallery", "shared/agentLibrary.ts": "agents-skills-and-workflows",
    "server/lingxingMcp.ts": "operations-and-source-sync", "server/finance.ts": "finance", "server/inventory.ts": "inventory-and-procurement",
    "server/workspace.ts": "identity-workspace-and-permissions", "server/aiJobRunner.ts": "ai-runtime-jobs-and-models",
    "scripts/deploy.sh": "tooling-ci-and-release", "deploy/aliyun/scripts/backup-mysql.sh": "tooling-ci-and-release", "client/src/App.tsx": "client-cross-cutting-manual-review",
    "server/routers.ts": "server-cross-cutting-manual-review", "docs/plan.md": "documentation-and-local-artifacts",
    "package.json": "root-configuration-and-cross-cutting", "misc/unknown.bin": "other-manual-review",
  };
  for (const [path, module] of Object.entries(cases)) assert.equal(moduleForPath(path), module);
});

test("core scope respects directory boundaries and independently counts each root/test file", () => {
  const baseline = [entry("client/a"), entry("server/a.test.ts"), entry("shared/a"), entry("drizzle/a.sql"), entry("e2e/a.spec.ts"), entry("serverish/a"), entry("docs/a.test.ts")];
  const source = [entry("client/a", b), entry("shared/a"), entry("drizzle/new.sql")];
  const result = buildReport(baseline, source);
  assert.equal(result.summary["baseline-only"], 5);
  assert.equal(result.core["baseline-only"], 3);
  assert.equal(result.core.baselineOnlyTestFiles, 2);
  assert.equal(result.core.byRoot.client.changed, 1);
  assert.equal(result.core.byRoot.server["baseline-only"], 1);
  assert.equal(result.core.byRoot.shared.same, 1);
  assert.equal(result.core.byRoot.drizzle["source-only"], 1);
  assert.equal(Object.values(result.modules).reduce((count, row) => count + row.unionTotal, 0), result.summary.unionTotal);
});

test("expected plan counts are explicit and actual mismatches are reported, never rewritten", () => {
  assert.deepEqual(EXPECTED_COUNTS, { same: 1394, changed: 268, "source-only": 283, "baseline-only": 566 });
  const result = buildReport([entry("one")], []);
  assert.equal(result.summary["baseline-only"], 1);
  assert.equal(result.planComparison.matches, false);
  assert.deepEqual(result.planComparison.mismatches.find(item => item.scope === "all" && item.category === "baseline-only"), { scope: "all", category: "baseline-only", expected: 566, actual: 1 });
  assert.equal(result.sourceContentsRead, false);
  assert.equal(result.workingTreeInspected, false);
  assert.equal(result.automaticPortAllowed, false);
});

test("synthetic exact counts reproduce all/core plan figures without reading any blob bytes", () => {
  const left = [], right = [];
  for (const [status, count] of Object.entries(EXPECTED_COUNTS)) for (let i = 0; i < count; i++) {
    const core = i < (EXPECTED_CORE_COUNTS[status] ?? 0);
    const path = `${core ? "server" : "docs"}/${status}-${i}`;
    if (status !== "source-only") left.push(entry(path));
    if (status !== "baseline-only") right.push(entry(path, status === "changed" ? b : a));
  }
  const result = buildReport(left, right);
  assert.equal(result.planComparison.matches, true);
  assert.deepEqual(result.planComparison.mismatches, []);
  assert.equal(result.summary.baselineTotal, 2228);
  assert.equal(result.summary.sourceTotal, 1945);
  assert.equal(result.summary.unionTotal, 2511);
  // The two real trees differ in mode for two otherwise identical script blobs.
  const modeOnly = right.filter(item => item.path.startsWith("docs/same-")).slice(0, 2);
  for (const row of modeOnly) row.mode = "100755";
  const withModes = buildReport(left, right);
  assert.equal(withModes.planComparison.matches, true);
  assert.deepEqual(withModes.planComparison.mismatches, []);
  assert.deepEqual(withModes.planComparison.strictTreeMismatches, [
    { scope: "all", category: "same", expected: 1394, actual: 1392 },
    { scope: "all", category: "changed", expected: 268, actual: 270 },
  ]);
  assert.equal(withModes.summary.modeOnlyChanged, 2);
  assert.equal(withModes.entries.filter(item => item.status === "changed").length, 270);
});

test("same object IDs at different paths remain additions/removals, not invented renames", () => {
  assert.deepEqual(compareTrees([entry("old")], [entry("new")]).map(item => item.status), ["source-only", "baseline-only"]);
});

test("reader invokes only fixed-commit rev-parse and full recursive NUL ls-tree, never HEAD or blob reads", async () => {
  for (const role of ["baseline", "source"]) {
    const calls = [];
    const rows = [entry("tracked-file"), entry("module", a, "160000")];
    const result = await readPinnedTree("/synthetic/local directory", role, async (directory, args) => {
      calls.push({ directory, args });
      return args[0] === "rev-parse" ? Buffer.from(`${PINNED_REVISIONS[role]}\n`) : encoded(rows);
    });
    assert.deepEqual(calls, [
      { directory: "/synthetic/local directory", args: ["rev-parse", "--verify", `${PINNED_REVISIONS[role]}^{commit}`] },
      { directory: "/synthetic/local directory", args: ["ls-tree", "-r", "-z", "--full-tree", PINNED_REVISIONS[role]] },
    ]);
    assert.equal(result.length, 2);
    assert.equal(result.some(item => item.path === "shared/agentLibraryContracts.ts"), false);
  }
});

test("reader fails before listing on a missing/mismatched pin or unknown role", async () => {
  let count = 0;
  await assert.rejects(readPinnedTree("/ignored", "baseline", async () => { count++; return Buffer.from(b); }), { code: "SOURCE_SHA_MISMATCH" });
  assert.equal(count, 1);
  await assert.rejects(readPinnedTree("/ignored", "other", async () => { throw new Error("must not be called"); }), { code: "UNKNOWN_SOURCE_ROLE" });
});

test("CLI requires directories and rejects apply, writes, revision overrides and repeated options", () => {
  assert.deepEqual(parseArguments(["--help"]), { help: true });
  assert.equal(parseArguments(["--baseline-dir", "/tmp/a b", "--source-dir", "/tmp/c"]).baselineDirectory, "/tmp/a b");
  for (const args of [[], ["--apply"], ["--output", "file.json"], ["--sha", b], ["--baseline-dir", "/tmp/a"],
    ["--baseline-dir", "/tmp/a", "--source-dir", "/tmp/c", "--source-dir", "/tmp/c"], ["--baseline-dir", "\0", "--source-dir", "/tmp/c"]]) assert.throws(() => parseArguments(args), { code: "CLI_ARGUMENTS_INVALID" });
});

test("CLI stdout is JSON; help and sanitized errors never emit inherited secrets or argument paths", async () => {
  const script = fileURLToPath(new URL("./sourceOwnership.mjs", import.meta.url));
  const output = execFileSync(process.execPath, [script, "--help"], { encoding: "utf8", env: { ...process.env, DATABASE_URL: secret, GIT_DIR: secret } });
  assert.equal(JSON.parse(output).stdoutOnly, true);
  assert.equal(output.includes(secret), false);
  const result = await main(["--baseline-dir", `/nonexistent/${secret}`, "--source-dir", `/nonexistent/${secret}`]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.output.error.code, "GIT_READ_FAILED");
  assert.equal(JSON.stringify(result).includes(secret), false);
});
