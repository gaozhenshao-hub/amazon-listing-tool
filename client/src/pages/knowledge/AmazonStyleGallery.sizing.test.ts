import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./AmazonStyleGallery.tsx", import.meta.url), "utf8");

describe("AmazonStyleGallery image sizing", () => {
  it("uses definite preview boxes so object-contain can preserve all image content", () => {
    expect(source).toContain('h-[320px] bg-slate-50');
    expect(source).toContain('style={{ height: "420px" }}');
    expect(source).toContain('absolute inset-0 h-full w-full object-contain p-2');
  });

  it("does not crop brand-story previews", () => {
    expect(source).toContain('h-[160px] object-contain bg-slate-50 p-1');
    expect(source).not.toContain('h-[160px] object-cover bg-white');
  });
});
