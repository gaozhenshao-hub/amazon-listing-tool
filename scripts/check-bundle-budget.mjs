import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(rootDir, "dist", "public");
const indexPath = path.join(publicDir, "index.html");
const budgetPath = path.join(rootDir, "config", "bundle-budgets.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function listJavaScriptFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listJavaScriptFiles(entryPath));
    if (entry.isFile() && entry.name.endsWith(".js")) files.push(entryPath);
  }
  return files;
}

if (!fs.existsSync(indexPath)) {
  throw new Error(`Client build not found at ${indexPath}. Run the Vite build first.`);
}

const budgets = readJson(budgetPath);
const html = fs.readFileSync(indexPath, "utf8");
const entryMatch = html.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+\.js)["']/i)
  ?? html.match(/<script[^>]+src=["']([^"']+\.js)["'][^>]+type=["']module["']/i);

if (!entryMatch) {
  throw new Error("Unable to identify the module entry in dist/public/index.html.");
}

const entryRelativePath = entryMatch[1].replace(/^\//, "");
const entryPath = path.join(publicDir, entryRelativePath);
if (!fs.existsSync(entryPath)) {
  throw new Error(`Entry bundle does not exist: ${entryPath}`);
}

const chunks = listJavaScriptFiles(publicDir)
  .map(filePath => ({
    file: path.relative(publicDir, filePath),
    bytes: fs.statSync(filePath).size,
  }))
  .sort((a, b) => b.bytes - a.bytes);

const entryBytes = fs.statSync(entryPath).size;
const largestChunk = chunks[0];
const baselineDeltaPercent = budgets.baselineEntryBytes
  ? ((entryBytes - budgets.baselineEntryBytes) / budgets.baselineEntryBytes) * 100
  : null;
const report = {
  generatedAt: new Date().toISOString(),
  entry: { file: entryRelativePath, bytes: entryBytes },
  largestChunk,
  totalJavaScriptBytes: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0),
  chunkCount: chunks.length,
  budgets,
  baselineDeltaPercent,
  topChunks: chunks.slice(0, 10),
};

const reportPath = process.env.BUNDLE_REPORT_PATH;
if (reportPath) {
  const absoluteReportPath = path.resolve(rootDir, reportPath);
  fs.mkdirSync(path.dirname(absoluteReportPath), { recursive: true });
  fs.writeFileSync(absoluteReportPath, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(`Client entry: ${entryRelativePath} (${formatBytes(entryBytes)})`);
console.log(`Largest chunk: ${largestChunk.file} (${formatBytes(largestChunk.bytes)})`);
if (baselineDeltaPercent !== null) {
  console.log(`Entry change from baseline: ${baselineDeltaPercent.toFixed(1)}%`);
}

const failures = [];
if (entryBytes > budgets.entryMaxBytes) {
  failures.push(`entry ${formatBytes(entryBytes)} exceeds ${formatBytes(budgets.entryMaxBytes)}`);
}
if (largestChunk.bytes > budgets.chunkMaxBytes) {
  failures.push(`largest chunk ${formatBytes(largestChunk.bytes)} exceeds ${formatBytes(budgets.chunkMaxBytes)}`);
}

if (failures.length > 0) {
  console.error(`Bundle budget failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log("Bundle budget passed.");
}
