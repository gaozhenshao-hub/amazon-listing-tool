import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { repoPath } from "./testPaths";
describe("source complexity architecture", () => {
  it("keeps the restored generation coordinator below its existing size budget", () => {
    expect(fs.readFileSync(repoPath("client/src/pages/GeneratePage.tsx"), "utf8").split("\n").length).toBeLessThanOrEqual(2150);
  });
});
