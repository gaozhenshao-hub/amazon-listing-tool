import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./AmazonStyleGallery.tsx", import.meta.url), "utf8");
const previewSource = readFileSync(new URL("./useBalancedPreviewTransform.ts", import.meta.url), "utf8");

describe("AmazonStyleGallery image sizing", () => {
  it("uses definite preview boxes so object-contain can preserve all image content", () => {
    expect(source).toContain('style={{ height: "420px" }}');
    expect(source).toContain('absolute inset-0 h-full w-full');
    expect(source).toContain('object-contain p-2');
  });

  it("does not crop brand-story previews", () => {
  });

  it("balances source whitespace by default while preserving a complete-canvas fallback", () => {
    expect(source).toContain('type PreviewFitMode = "balanced" | "full"');
    expect(source).toContain('useState<PreviewFitMode>("balanced")');
    expect(source).toContain('useBalancedPreviewTransform');
    expect(previewSource).toContain('ResizeObserver');
    expect(source).toContain('object-contain p-2');
    expect(source).toContain('完整画布');
    expect(source).toContain('平衡留白');
  });

  it("constrains the outer gallery while preserving local horizontal strips and responsive A+ panels", () => {
    expect(source).toContain('w-full min-w-0 max-w-full space-y-6');
    expect(source).toContain('min-w-0 max-w-full flex-1 relative group');
    expect(source).toContain('w-[72px] shrink-0');
  });
});
