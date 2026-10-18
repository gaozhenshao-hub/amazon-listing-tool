#!/usr/bin/env node
// Explicit alternate LOCAL/CI admission, not a production migration command.
// Original bootstrap, manifest, SQL and historical approval remain untouched.
import { fileURLToPath } from "node:url";
import { executeFreshBootstrap, parseArguments as parseOriginalArguments, validateTarget } from "./bootstrap-fresh-database.mjs";
import { insist } from "./database/freshBootstrapPlan.mjs";
import { CURRENT_SOURCE_SELECTION, CURRENT_SOURCE_CONTRACT_PATH, CURRENT_SOURCE_CONTRACT_SHA256,
  assertCurrentSourceReview, loadCurrentSourceContract } from "./database/freshBootstrapCurrentSourceContract.mjs";

export function parseArguments(args) {
  const locations = args.flatMap((value, index) => value === "--contract" ? [index] : []);
  insist(locations.length === 1 && args[locations[0] + 1] === CURRENT_SOURCE_SELECTION, "CURRENT_SOURCE_EXPLICIT_CONTRACT_REQUIRED");
  const rest = [...args.slice(0, locations[0]), ...args.slice(locations[0] + 2)];
  const options = parseOriginalArguments(rest);
  insist(["plan", "execute"].includes(options.mode), "CURRENT_SOURCE_EXPLICIT_MODE_REQUIRED");
  return options;
}

async function loadExecutionDependencies() {
  const previous = process.env.DOTENV_CONFIG_PATH; process.env.DOTENV_CONFIG_PATH = "/dev/null";
  try {
    const runner = await import("./run-database-migrations.mjs");
    return { runner, connect: (await import("mysql2/promise")).createConnection };
  } finally {
    if (previous === undefined) delete process.env.DOTENV_CONFIG_PATH; else process.env.DOTENV_CONFIG_PATH = previous;
  }
}

export async function main(args, { environment = process.env, load = loadExecutionDependencies } = {}) {
  const options = parseArguments(args);
  // Exact schema/environment AND loopback/socket checks, not NODE_ENV alone.
  // No implicit app DATABASE_URL, custom contract, remote host or retry bypass.
  if (options.execute) validateTarget(options, environment);
  const prepared = await loadCurrentSourceContract();
  if (!options.execute) return { mode: "offline-current-source-contract", databaseConnected: false, sqlExecuted: false,
    contractSelection: CURRENT_SOURCE_SELECTION, contractPath: CURRENT_SOURCE_CONTRACT_PATH, contractFileSha256: CURRENT_SOURCE_CONTRACT_SHA256,
    reviewStatus: prepared.descriptor.review.status, executionPermitted: prepared.descriptor.review.status === "approved",
    executionScope: "local-or-ci-only", productionApproved: false, newFeatureSchemasApproved: false,
    planSha256: prepared.bundle.planSha256, sourcesSha256: prepared.bundle.sourcesSha256,
    compiledContractSha256: prepared.descriptor.compiledContractSha256, catalogSha256: prepared.contract.catalogSha256,
    migrationCount: prepared.bundle.plan.length, businessTableCount: prepared.bundle.manifest.requiredBusinessTables.length,
    nativeAcceptance: "not_performed" };
  assertCurrentSourceReview(prepared.descriptor);
  return executeFreshBootstrap({ ...prepared, options, environment }, { load: async () => {
    const dependencies = await load();
    return { runner: dependencies.runner, connect: async target => {
      // The descriptor/evidence are outside the old 208-source manifest. Recheck
      // them after dependency loading and immediately before opening a socket.
      const current = await loadCurrentSourceContract(); assertCurrentSourceReview(current.descriptor);
      insist(current.descriptor.compiledContractSha256 === prepared.descriptor.compiledContractSha256
        && current.bundle.sourcesSha256 === prepared.bundle.sourcesSha256, "CURRENT_SOURCE_CHANGED_BEFORE_CONNECTION");
      return dependencies.connect(target);
    } };
  } });
}

if (fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
  console.error(JSON.stringify({ ok: false, code: /^[A-Z][A-Z0-9_]+$/.test(error.code ?? "") ? error.code : "CURRENT_SOURCE_BOOTSTRAP_FAILED" }));
  process.exitCode = 1;
});
