import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "client/src/pages/imageWorkflow/ReferenceImagesStep.tsx"),
  "utf8",
);

describe("Step 4 reference image render state contract", () => {
  it("derives the header data flag before passing it to the header", () => {
    expect(source).toContain("const hasData = Boolean(editData?.imageReferences?.length);");
    expect(source).toContain("<ReferenceImagesHeader");
    expect(source).toContain("hasData={hasData}");
  });

  it("keeps confirmation state distinct from data availability", () => {
    expect(source).toContain("const isConfirmed = isLocked;");
    expect(source).toContain("isConfirmed={isConfirmed}");
  });
});
