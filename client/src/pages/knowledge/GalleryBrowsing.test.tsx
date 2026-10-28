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

vi.mock("./KnowledgeAssetActions", () => ({ default: () => <div data-testid="image-actions">调整结果（AI）</div> }));
const featureFlag = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/mergedReadOnlyFeatures", () => ({
  get MERGED_READONLY_FEATURES_ENABLED() { return featureFlag.enabled; },
}));
vi.mock("./useBalancedPreviewTransform", () => ({
  useBalancedPreviewTransform: () => ({ previewRef: vi.fn(), transform: "translate(0px, 0px)" }),
}));
afterEach(() => { cleanup(); featureFlag.enabled = true; });

describe("gallery display labels", () => {
  it("does not infer a source role for an independent upload", () => {
    expect(imageBelongLabel({imageSetId:null,imagePosition:"secondary"})).toBe("");
    expect(imageBelongLabel({imageSetId:null,imagePosition:"secondary",tagImageBelong:"A+",tagImageBelongSub:"全宽图"})).toBe("A+·全宽图");
  });
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
  it("shows tags on the right and opens an original without hiding them", () => {
    const select = vi.fn();render(<AmazonStyleGallery {...props} onSelectImage={select} />);
    expect(screen.getByRole("complementary", {name:"图片标签"})).toBeInTheDocument();
    const frame=screen.getByRole("button",{name:"查看当前商品原图"});
    fireEvent.keyDown(frame,{key:"Enter"});
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(select).not.toHaveBeenCalled();
  });
  it("keeps one single-image view with a shared preview and internal set navigation",()=>{
    const source=readFileSync("client/src/pages/knowledge/SingleLibraryBrowse.tsx","utf8");
    const root=readFileSync("client/src/pages/knowledge/KBImages.tsx","utf8");
    expect(source).toContain("activateGalleryItem");expect(source).toContain("SingleImagePreviewDialog");
    expect(source).not.toContain("window.open");expect(source).toContain("/knowledge/images/");
    expect(root).not.toContain("Grid3X3");expect(root).not.toContain("activeMainTab");
  });
  it("opens a carousel slide as its own image with its own labels", () => {
    const hash=(n:number)=>String(n).repeat(64);
    const images=[1,2].map(n=>({id:10+n,imageUrl:`/slide-${n}.jpg`,imagePosition:"aplus",sourceUrlHash:hash(n),tagComposition:n===1?"一分构图":"一拖二"}));
    const layout={version:1,modules:[{id:"nav",section:"aplus",kind:"carousel",subtype:"导航轮播",cards:[1,2].map(n=>({images:[{hash:hash(n),alt:`导航图${n}`}]}))}]};
    render(<AmazonStyleGallery {...props} mainImages={[]} secondaryImages={[]} aplusImages={images} sourceLayout={layout}/>);
    fireEvent.click(screen.getByRole("button",{name:"下一张"}));
    expect(screen.getByText("一拖二")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"导航图2"}));
    const dialog=screen.getByRole("dialog");
    expect(within(dialog).getByRole("img")).toHaveAttribute("src","/slide-2.jpg");
    expect(within(dialog).getByText("一拖二")).toBeInTheDocument();
    expect(within(dialog).queryByText("一分构图")).not.toBeInTheDocument();
  });
});
