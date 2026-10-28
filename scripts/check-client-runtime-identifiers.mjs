import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function checkRuntimeIdentifiers({
  run = spawnSync,
  env = process.env,
  logger = console,
} = {}) {
  const result = run(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "--noEmit", "--pretty", "false"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...env,
        NODE_OPTIONS: env.NODE_OPTIONS || "--max-old-space-size=4096",
      },
      timeout: 600_000,
      maxBuffer: 16 * 1024 * 1024,
    }
  );

  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const runtimeIdentifierDiagnostics = output
    .split("\n")
    .filter(line => /^client\/.*error TS(?:2304|2448|2454|2552):/.test(line));

  if (runtimeIdentifierDiagnostics.length > 0) {
    logger.error("Client runtime identifier gate failed:");
    logger.error(runtimeIdentifierDiagnostics.join("\n"));
    return 1;
  }

  // A killed, timed-out or otherwise unsuccessful compiler cannot prove this gate.
  if (result.error || result.signal || result.status !== 0) {
    logger.error(
      "Client runtime identifier check did not complete successfully."
    );
    logger.error(
      output.trim() || "Compiler exited without a successful result."
    );
    return 1;
  }
  logger.log(
    "Client runtime identifier gate passed: no undefined or prematurely accessed client identifiers."
  );
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = checkRuntimeIdentifiers();
}
