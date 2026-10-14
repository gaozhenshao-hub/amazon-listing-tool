import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = relative => readFileSync(new URL(`../../${relative}`, import.meta.url), "utf8");
const manifest = JSON.parse(read("package.json"));
const workspace = read("pnpm-workspace.yaml");
const lockfile = read("pnpm-lock.yaml");
const PINNED_PACKAGE_MANAGER = "pnpm@10.4.1+sha512.c753b6c3ad7afa13af388fa6d808035a008e30ea9993f58c6663e2bc5ff21679aa834db094987129aa4d488b86df57f7b634981b2f827cdcacc698cc0cfb88af";

// A deliberately small allowlist for this single-package workspace, not a YAML
// parser. Comments/blank lines/quoting do not matter; new policies need review.
function workspacePackages(text) {
  const lines = text.split(/\r?\n/).map(line => line.replace(/\s+#.*$/, "").trim())
    .filter(line => line && !line.startsWith("#"));
  assert.match(lines.shift() ?? "", /^packages\s*:\s*$/, "Workspace must declare only the packages list");
  return lines.map(line => {
    const item = /^-\s+(?:"([^"]*)"|'([^']*)'|([^\s'"#]+))$/.exec(line);
    assert.ok(item, "Unexpected workspace policy; pnpm 10.4.1 reads dependency policies from package.json");
    return item[1] ?? item[2] ?? item[3];
  });
}

test("workspace retains the single root package without silently ignored policies", () => {
  assert.deepEqual(workspacePackages(workspace), ["."]);
});

test("workspace policy check tolerates comments and quoting but rejects added declarations", () => {
  for (const quote of [".", "'.'", '"."']) {
    assert.deepEqual(workspacePackages(`# explanation\n\npackages :\n  - ${quote} # root\n# historical patch is inactive\n`), ["."]);
  }
  for (const policy of ["patchedDependencies:\n  wouter@3.7.1: patches/wouter.patch", "overrides:\n  tailwindcss>nanoid: 3.3.7", "catalog:\n  nanoid: 3.3.7"]) {
    assert.throws(() => workspacePackages(`packages:\n  - .\n${policy}\n`), /Unexpected workspace policy/);
  }
});

test("package manager remains the exact reviewed pnpm 10.4.1 pin", () => {
  assert.equal(manifest.packageManager, PINNED_PACKAGE_MANAGER);
});

test("package manifest has no active or conflicting dependency-policy declarations", () => {
  for (const key of ["pnpm", "overrides", "resolutions", "patchedDependencies"]) {
    assert.equal(Object.hasOwn(manifest, key), false, `New ${key} policy needs explicit review and lock regeneration`);
  }
});

test("lockfile records the unpatched dependency graph with no override or patch hashes", () => {
  const topKeys = [...lockfile.matchAll(/^([A-Za-z][A-Za-z0-9_-]*)\s*:/gm)].map(match => match[1]);
  assert.ok(topKeys.includes("importers") && topKeys.includes("packages") && topKeys.includes("snapshots"));
  assert.equal(topKeys.includes("overrides"), false);
  assert.equal(topKeys.includes("patchedDependencies"), false);
  assert.doesNotMatch(lockfile, /\bpatch_hash\s*[=:]/);
  assert.match(lockfile, /^lockfileVersion:\s*['"]?9\.0['"]?\s*$/m);
});
