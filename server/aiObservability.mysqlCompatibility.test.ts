import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("AI Worker observability MySQL compatibility", () => {
  it("quotes both the dead-letter procedure column and its response alias", async () => {
    const source = await readFile(
      new URL("./domains/ai_os/services/observability.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("\\`procedure\\` AS \\`procedure\\`");
    expect(source).not.toContain("\\`procedure\\` AS procedure");
    expect(source).not.toContain("module, procedure, status, attempt");
  });
});
