// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBalancedPreviewTransform } from "./useBalancedPreviewTransform";
import { AmazonStyleGallery } from "./AmazonStyleGallery";

class MockImage {
  static created: MockImage[] = [];
  naturalWidth = 96;
  naturalHeight = 96;
  crossOrigin = "";
  src = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { MockImage.created.push(this); }
}
class MockResizeObserver {
  static created: MockResizeObserver[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(public callback: () => void) { MockResizeObserver.created.push(this); }
}
let width = 420, height = 420;
let canvasMode: "foreground" | "blank" | "denied" = "foreground";

function Probe({ url, mounted = true, onFrame }: { url: string; mounted?: boolean; onFrame?: (url: string, transform: string) => void }) {
  const { previewRef, transform } = useBalancedPreviewTransform(url);
  onFrame?.(url, transform);
  return <><output data-testid="transform">{transform}</output>{mounted && <div ref={previewRef} data-testid="frame" />}</>;
}
const currentImage = (url: string) => MockImage.created.findLast(image => image.src === url && image.onload)!;
const load = (url: string) => act(() => { currentImage(url).onload?.(); });
const offset = () => screen.getByTestId("transform").textContent;

beforeEach(() => {
  width = height = 420;
  canvasMode = "foreground";
  MockImage.created = [];
  MockResizeObserver.created = [];
  vi.stubGlobal("Image", MockImage);
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => height);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({
    drawImage: vi.fn(),
    getImageData: (_x: number, _y: number, w: number, h: number) => {
      if (canvasMode === "denied") throw new DOMException("Canvas cannot be read", "SecurityError");
      const data = new Uint8ClampedArray(w * h * 4).fill(255);
      if (canvasMode === "foreground") {
        for (let y = h / 4; y < h * 3 / 4; y += 1) for (let x = 0; x < w / 4; x += 1) {
          const at = (y * w + x) * 4;
          data[at] = data[at + 1] = data[at + 2] = 0;
        }
      }
      return { data };
    },
  }) as unknown as CanvasRenderingContext2D);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("balanced preview lifecycle", () => {
  it("observes a preview mounted after async image data and responds to resize without reloading the image", () => {
    const { rerender, unmount } = render(<Probe url="a" mounted={false} />);
    load("a");
    expect(offset()).toBe("translate(0px, 0px)");
    expect(MockResizeObserver.created).toHaveLength(0);
    rerender(<Probe url="a" />);
    const observer = MockResizeObserver.created[0];
    expect(observer.observe).toHaveBeenCalledWith(screen.getByTestId("frame"));
    expect(offset()).toBe("translate(158px, 0px)");
    width = height = 200;
    act(() => observer.callback());
    expect(offset()).toBe("translate(75px, 0px)");
    expect(MockImage.created).toHaveLength(1);
    unmount();
    expect(observer.disconnect).toHaveBeenCalledOnce();
  });

  it("immediately drops the old image framing when URL changes, including a failed next image", () => {
    const frames: Array<{ url: string; transform: string }> = [];
    const onFrame = (url: string, transform: string) => frames.push({ url, transform });
    const { rerender } = render(<Probe url="a" onFrame={onFrame} />);
    load("a");
    expect(offset()).toBe("translate(158px, 0px)");
    rerender(<Probe url="b" onFrame={onFrame} />);
    expect(frames.filter(frame => frame.url === "b").every(frame => frame.transform === "translate(0px, 0px)")).toBe(true);
    expect(offset()).toBe("translate(0px, 0px)");
    act(() => currentImage("b").onerror?.());
    expect(offset()).toBe("translate(0px, 0px)");
  });

  it.each(["blank", "denied"] as const)("keeps a new %s canvas centered instead of inheriting prior bounds", mode => {
    const { rerender } = render(<Probe url="a" />);
    load("a");
    canvasMode = mode;
    rerender(<Probe url="b" />);
    load("b");
    expect(offset()).toBe("translate(0px, 0px)");
  });

  it("ignores late callbacks from replaced sources and never loads an empty URL", () => {
    const { rerender } = render(<Probe url="a" />);
    const lateLoad = currentImage("a").onload!;
    rerender(<Probe url="b" />);
    act(() => lateLoad());
    expect(offset()).toBe("translate(0px, 0px)");
    load("b");
    expect(offset()).toBe("translate(158px, 0px)");
    rerender(<Probe url="" />);
    expect(offset()).toBe("translate(0px, 0px)");
    expect(MockImage.created).toHaveLength(2);
  });

  it("disconnects a removed frame and observes its replacement", () => {
    const { rerender } = render(<Probe url="a" />);
    const first = MockResizeObserver.created[0];
    rerender(<Probe url="a" mounted={false} />);
    expect(first.disconnect).toHaveBeenCalledOnce();
    rerender(<Probe url="a" />);
    expect(MockResizeObserver.created).toHaveLength(2);
    expect(MockResizeObserver.created[1].observe).toHaveBeenCalledWith(screen.getByTestId("frame"));
  });
});

describe("gallery preview interactions", () => {
  it("mounts its initially deferred main preview, switches images and toggles framing without changing the source or object fit", () => {
    const onSelectImage = vi.fn();
    const images = [1, 2].map(id => ({ id, imageUrl: `image-${id}`, imagePosition: "main", positionIndex: id }));
    const { container } = render(<AmazonStyleGallery mainImages={images} secondaryImages={[]} aplusImages={[]}
      brandStoryImages={[]} selectedImageId={null} onSelectImage={onSelectImage} />);
    const preview = () => container.querySelector<HTMLImageElement>("img[fetchpriority=high]")!;
    load("image-1");
    expect(preview().style.transform).toBe("translate(158px, 0px)");
    expect(preview().classList.contains("object-contain")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "完整画布" }));
    expect(preview().style.transform).toBe("");
    expect(preview().getAttribute("src")).toBe("image-1");
    expect(onSelectImage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "平衡留白" }));
    const nextThumbnail = container.querySelector("button img[src=image-2]")!.closest("button")!;
    fireEvent.click(nextThumbnail);
    expect(preview().getAttribute("src")).toBe("image-2");
    expect(preview().style.transform).toBe("translate(0px, 0px)");
    expect(onSelectImage).toHaveBeenCalledWith(2);
  });

  it("keeps A+ containment when its tag editor is opened", () => {
    const { container } = render(<AmazonStyleGallery mainImages={[]} secondaryImages={[]} brandStoryImages={[]}
      aplusImages={[{ id: 3, imageUrl: "aplus", imagePosition: "aplus", tagComposition: "Long".repeat(100) }]}
      selectedImageId={null} onSelectImage={vi.fn()} renderTagEditor={() => <input aria-label="A+ tags" />} />);
    const image = container.querySelector<HTMLImageElement>("img[src=aplus]")!;
    expect(image.parentElement!.classList.contains("overflow-hidden")).toBe(true);
    expect(image.classList.contains("object-contain")).toBe(true);
    expect(image.parentElement!.parentElement!.classList.contains("md:flex-row")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByRole("textbox", { name: "A+ tags" })).toBeTruthy();
    expect(image.getAttribute("src")).toBe("aplus");
  });
});
