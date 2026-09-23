import { spawnSync } from "node:child_process";

const result = spawnSync(
  "pnpm",
  ["exec", "tsc", "--noEmit", "--pretty", "false"],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_OPTIONS: process.env.NODE_OPTIONS || "--max-old-space-size=8192",
    },
  },
);

const output = `${result.stdout || ""}\n${result.stderr || ""}`;
const runtimeIdentifierDiagnostics = output
  .split("\n")
  .filter((line) => /^client\/.*error TS(?:2304|2448|2454|2552):/.test(line));

if (runtimeIdentifierDiagnostics.length > 0) {
  console.error("Client runtime identifier gate failed:");
  console.error(runtimeIdentifierDiagnostics.join("\n"));
  process.exit(1);
}

console.log("Client runtime identifier gate passed: no undefined or prematurely accessed client identifiers.");
