import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "client/src/pages/dev/DevDataUpload.tsx"),
  "utf8",
);

describe("DevDataUpload supplemental product dialog", () => {
  it("opens the existing supplemental upload dialog instead of calling a removed setter", () => {
    expect(source).toContain("const [supplementUploadOpen, setSupplementUploadOpen] = useState(false);");
    expect(source).toContain("onClick={() => setSupplementUploadOpen(true)}");
    expect(source).not.toContain("setManualProductOpen");
  });
});
