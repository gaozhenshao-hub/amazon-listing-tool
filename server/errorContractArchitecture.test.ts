import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function productionSourceFiles(directory: string, extensions: readonly string[]): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionSourceFiles(target, extensions);
    if (!entry.isFile() || !extensions.some((extension) => entry.name.endsWith(extension))) return [];
    if (/\.(?:test|spec)\.[^.]+$/.test(entry.name)) return [];
    return [target];
  });
}

describe("error contract architecture", () => {
  it("does not infer authentication or conflict state from error text", () => {
    const clientSources = productionSourceFiles(
      path.join(root, "client/src"),
      [".ts", ".tsx"],
    ).map((filePath) => fs.readFileSync(filePath, "utf8")).join("\n");

    expect(clientSources).not.toMatch(/\b(?:message|msg)\.(?:includes|match)\s*\(/);
    expect(clientSources).not.toContain("[id:");
    expect(clientSources).toContain("getAppErrorInfo");
    expect(clientSources).toContain("isAuthRequiredError");
  });

  it("turns retired compatibility endpoints into explicit errors", () => {
    const compatibilitySources = [
      read("server/routers/dashboardUpgrade.ts"),
      read("server/routers/customerProfile.ts"),
      read("server/routers/systemSettings.ts"),
      read("server/domains/ops/routers/sync.ts"),
    ].join("\n");

    expect(compatibilitySources).not.toContain('source: "deprecated"');
    expect(compatibilitySources).toContain("retiredFeatureError");
    expect(compatibilitySources).toContain("replacementProcedure");
  });

  it("does not ship fabricated 200 responses from removed connectors", () => {
    const serverRoot = path.join(root, "server");
    const productionFiles = productionSourceFiles(serverRoot, [".ts"]);
    const violations = productionFiles.flatMap((filePath) => {
      const source = fs.readFileSync(filePath, "utf8");
      const messages: string[] = [];
      if (/source:\s*["']deprecated["']/.test(source)) messages.push("contains deprecated data source response");
      if (/code:\s*["']200["']\s*,\s*data:\s*\{\s*\}/.test(source)) messages.push("contains fabricated 200 empty data");
      return messages.map((message) => `${path.relative(serverRoot, filePath)}: ${message}`);
    });

    expect(violations, violations.join("\n")).toEqual([]);
  });
});
