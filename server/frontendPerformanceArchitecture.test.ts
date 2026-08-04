import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function listSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listSourceFiles(entryPath) : [entryPath];
  });
}

describe("frontend performance architecture", () => {
  it("keeps route pages behind React.lazy boundaries", () => {
    const appSource = read("client/src/App.tsx");
    const lazyRoutes = appSource.match(/lazy\(\(\) => import\(/g) ?? [];
    const staticPageImports = [...appSource.matchAll(/^import .+ from ["'](?:@\/pages|\.\/pages)\/([^"']+)["'];?$/gm)]
      .map(match => match[1]);

    expect(lazyRoutes.length).toBeGreaterThanOrEqual(80);
    expect(staticPageImports).toEqual(["NotFound"]);
  });

  it("keeps spreadsheet parsing out of static client imports", () => {
    const clientFiles = listSourceFiles(path.join(root, "client", "src"))
      .filter(filePath => /\.(ts|tsx)$/.test(filePath));
    const staticSpreadsheetImports = clientFiles.filter(filePath =>
      /from\s+["']xlsx["']/.test(fs.readFileSync(filePath, "utf8")),
    );

    expect(staticSpreadsheetImports).toEqual([]);
  });

  it("keeps heavy UI libraries out of the eager application shell", () => {
    const eagerShell = [
      "client/src/main.tsx",
      "client/src/App.tsx",
      "client/src/components/DashboardLayout.tsx",
    ].map(read).join("\n");

    expect(eagerShell).not.toMatch(/from\s+["'](?:xlsx|recharts|streamdown|mermaid)["']/);
  });

  it("does not hardcode browser egress in the HTML shell", () => {
    expect(read("client/index.html")).not.toMatch(/https?:\/\//);
  });
});
