// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { GalleryImagePreview } from "./GalleryImagePreview";
import { SingleImagePreviewDialog } from "./SingleImagePreviewDialog";
import { AmazonStyleGallery } from "./AmazonStyleGallery";
import { imageTagLabel, imageBelongLabel, distinctImageTags, joinImageTags } from "./kbImageLabels";
import { activateGalleryItem, currentGalleryIndex } from "./galleryInteraction";

const featureFlag = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/mergedReadOnlyFeatures", () => ({
  get MERGED_READONLY_FEATURES_ENABLED() { return featureFlag.enabled; },
}));
vi.mock("./useBalancedPreviewTransform", () => ({
  useBalancedPreviewTransform: () => ({ previewRef: vi.fn(), transform: "translate(0px, 0px)" }),
}));
afterEach(() => { cleanup(); featureFlag.enabled = true; });

describe("gallery display labels", () => {
  it.each([[" main ", "主图"], ["SECONDARY", "套图"], ["brand_story", "品牌故事"],
    ["a_plus", "A+"], ["A+·A+", "A+"], ["自定义风格", "自定义风格"],
    ["__proto__", "__proto__"], ["constructor", "constructor"]])("normalizes %s without rewriting storage", (input, output) => {
    expect(imageTagLabel(input)).toBe(output);
  });
  it("deduplicates normalized display values while retaining custom styles", () => {
    expect(distinctImageTags(["aplus", "A+", " 极简 ", "极简", "", null])).toEqual(["A+", "极简"]);
    expect(joinImageTags("主图", "main")).toBe("主图");
    expect(imageBelongLabel({ tagImageBelong: " ", imagePosition: "brand_story" })).toBe("品牌故事");
    expect(imageBelongLabel({ tagImageBelong: "A+", tagImageBelongSub: "aplus" })).toBe("A+");
  });
});

describe("gallery interactions", () => {
  it("handles Enter/Space only on the activated item, not its nested controls", () => {
    const target = document.createElement("div"), activate = vi.fn(), preventDefault = vi.fn();
    for (const key of ["Enter", " "]) activateGalleryItem({ target, currentTarget: target, key, preventDefault }, activate);
    expect(activate).toHaveBeenCalledTimes(2);expect(preventDefault).toHaveBeenCalledTimes(2);
    activateGalleryItem({ target, currentTarget: target, key: "Escape", preventDefault }, activate);
    activateGalleryItem({ target: document.createElement("button"), currentTarget: target, key: "Enter", preventDefault }, activate);
    expect(activate).toHaveBeenCalledTimes(2);expect(preventDefault).toHaveBeenCalledTimes(2);
  });
  it("selects by ID after reordering and falls back only when an image disappears", () => {
    expect(currentGalleryIndex([{ id: 2 }, { id: 1 }], 1)).toBe(1);
    expect(currentGalleryIndex([{ id: 2 }], 1)).toBe(0);
    expect(currentGalleryIndex([], 1)).toBe(-1);
  });
  it("shows an access failure without creating another URL, and resets for a new URL", () => {
    const { rerender } = render(<GalleryImagePreview src="/first.jpg" alt="原图" className="object-contain" accessError="访问权限已失效" />);
    fireEvent.error(screen.getByRole("img", { name: "原图" }));
    expect(screen.getByRole("img", { name: "访问权限已失效" })).not.toHaveAttribute("src");
    rerender(<GalleryImagePreview src="/second.jpg" alt="原图" className="object-contain" />);
    expect(screen.getByRole("img", { name: "原图" })).toHaveAttribute("src", "/second.jpg");
    rerender(<GalleryImagePreview src={null} alt="原图" className="object-contain" />);
    expect(screen.getByRole("img", { name: "图片暂时不可访问" })).not.toHaveAttribute("src");
  });
  it("opens the unchanged authorized URL in a contained dialog and retains the ASIN entry", () => {
    const openSet = vi.fn(), close = vi.fn();
    render(<SingleImagePreviewDialog image={{ id: 1, imageSetId: 17, imageUrl: "/signed.jpg?token=original", asin: "B0TEST",
      tagImageBelong: "aplus", tagImageType: "A+", tagDesignStyle: "极简" }} onClose={close} onOpenSet={openSet} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("img")).toHaveAttribute("src", "/signed.jpg?token=original");
    expect(within(dialog).getByRole("img")).toHaveClass("object-contain");
    expect(within(dialog).getAllByText("A+")).toHaveLength(1);
    expect(within(dialog).getByText("极简")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "在 ASIN 集中查看" }));
    expect(openSet).toHaveBeenCalledWith(17);
    fireEvent.keyDown(dialog, { key: "Escape" });expect(close).toHaveBeenCalledOnce();
  });
  it("renders the existing denied-image placeholder in the dialog", () => {
    render(<SingleImagePreviewDialog image={{ id: 2, imageUrl: null, imageAccessError: "无权查看资产" }} onClose={vi.fn()} />);
    expect(screen.getByRole("img", { name: "无权查看资产" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "在 ASIN 集中查看" })).not.toBeInTheDocument();
  });

  const a = { id: 1, imageUrl: "/a.jpg", imagePosition: "main", positionIndex: 0 };
  const b = { id: 2, imageUrl: "/b.jpg", imagePosition: "secondary", positionIndex: 1 };
  const empty: typeof a[] = [];
  const props = { mainImages: [a], secondaryImages: [b], aplusImages: empty, brandStoryImages: empty, selectedImageId: null, onSelectImage: vi.fn() };
  it("keeps the active image after server reorder and handles deletion/empty results", () => {
    const { rerender } = render(<AmazonStyleGallery {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "下一张商品图片" }));
    expect(screen.getByRole("img", { name: "当前商品图片" })).toHaveAttribute("src", "/b.jpg");
    rerender(<AmazonStyleGallery {...props} mainImages={[{ ...a, positionIndex: 2 }]} secondaryImages={[{ ...b, positionIndex: 0 }]} />);
    expect(screen.getByRole("img", { name: "当前商品图片" })).toHaveAttribute("src", "/b.jpg");
    rerender(<AmazonStyleGallery {...props} secondaryImages={empty} />);
    expect(screen.getByRole("img", { name: "当前商品图片" })).toHaveAttribute("src", "/a.jpg");
    rerender(<AmazonStyleGallery {...props} mainImages={empty} secondaryImages={empty} />);
    expect(screen.queryByRole("img", { name: "当前商品图片" })).not.toBeInTheDocument();
  });
  it("keeps tag selection separate from fit/zoom controls and supports keyboard activation", () => {
    const select = vi.fn();render(<AmazonStyleGallery {...props} onSelectImage={select} />);
    const frame = screen.getByRole("button", { name: "展开或收起当前图片标签" });
    fireEvent.keyDown(frame, { key: "Enter" });fireEvent.keyDown(frame, { key: " " });
    expect(select).toHaveBeenCalledTimes(2);expect(select).toHaveBeenLastCalledWith(1);
    const fit = screen.getByRole("button", { name: "完整画布" });
    fireEvent.keyDown(fit, { key: "Enter" });fireEvent.click(fit);
    fireEvent.click(screen.getByRole("button", { name: "查看原图" }));
    expect(select).toHaveBeenCalledTimes(2);expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("keeps the original click/fit/tags when the merged-feature switch is off", () => {
    featureFlag.enabled = false;
    const select = vi.fn();
    render(<AmazonStyleGallery {...props} mainImages={[{ ...a, tagImageBelong: "main", tagComposition: "main" }]} onSelectImage={select} />);
    const image = screen.getByRole("img", { name: "当前商品图片" });
    fireEvent.click(image);
    expect(select).toHaveBeenCalledOnce();expect(select).toHaveBeenCalledWith(1);
    expect(screen.queryByRole("button", { name: "展开或收起当前图片标签" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看原图" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(image.parentElement!).getAllByText("main")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "完整画布" })).toBeInTheDocument();
    fireEvent.error(image);
    expect(image).toHaveAttribute("src", "/a.jpg");
    expect(screen.queryByRole("img", { name: "图片暂时不可访问" })).not.toBeInTheDocument();
  });
  it("wires both browse views to the same preview and retains the existing detail-set state", () => {
    const source = readFileSync("client/src/pages/knowledge/KBImages.tsx", "utf8");
    expect(source.match(/onKeyDown=\{MERGED_READONLY_FEATURES_ENABLED \? event => activateGalleryItem\(event, \(\) => openBrowseImage\(item\)\) : undefined\}/g)).toHaveLength(2);
    expect(source).toContain("if (MERGED_READONLY_FEATURES_ENABLED) setPreviewImage(item)");
    expect(source).toContain('else if (item.imageSetId != null) { setDetailSetId(item.imageSetId); setEditingAnalysis(""); }');
    expect(source).toContain("MERGED_READONLY_FEATURES_ENABLED && <SingleImagePreviewDialog");
    expect(source).toContain("setDetailSetId(setId)");
    expect(source).toContain('const [detailSetId, setDetailSetId] = useState<number | null>(null)');
  });
});
