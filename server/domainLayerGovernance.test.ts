import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("domain layer governance", () => {
  it("keeps routers, services and repositories inside their declared boundaries", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const output = execFileSync(
      process.execPath,
      [path.join(root, "scripts/check-domain-layer-boundaries.mjs")],
      { cwd: root, encoding: "utf8" },
    );
    expect(output).toContain("Domain layer boundary passed");
  });
});
