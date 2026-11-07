// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import AmazonRichContent from "./AmazonRichContent";
vi.mock("./KnowledgeVideoPlayer", () => ({ default: () => <div>视频</div> }));
afterEach(cleanup);
it("preserves videos, images and text in a future module fallback", () => {
  const videoHash = "f".repeat(64),
    layout = {
      version: 2,
      modules: [
        {
          id: "future",
          section: "aplus",
          kind: "unknown",
          sourceType: "FUTURE_MIXED",
          cards: [
            {
              images: [{ hash: "a".repeat(64) }],
              blocks: [{ id: "copy", text: "All future module copy." }],
            },
          ],
          videoHashes: [videoHash],
          warnings: ["新模块内容已保留，排版待核对"],
        },
      ],
    };
  render(
    <AmazonRichContent
      layout={layout}
      images={[
        {
          id: 1,
          imageUrl: "/source.jpg",
          sourceUrlHash: "a".repeat(64),
          imagePosition: "aplus",
        },
      ]}
      videos={[
        {
          hash: videoHash,
          role: "aplus",
          position: 0,
          moduleId: "future",
          title: "Video",
          duration: null,
          status: "ready",
          videoUrl: "/video.mp4",
          posterUrl: null,
        },
      ]}
      section="aplus"
      onSelect={vi.fn()}
      renderVideo={() => <button>播放保留的视频</button>}
    />
  );
  expect(
    screen.getByRole("button", { name: "播放保留的视频" })
  ).toBeInTheDocument();
  expect(screen.getByText("All future module copy.")).toBeInTheDocument();
  expect(screen.getByRole("img")).toHaveAttribute("src", "/source.jpg");
});
const a = "a".repeat(64),
  b = "b".repeat(64),
  bg = "c".repeat(64);
const images = [
  { id: 1, imageUrl: "/a.jpg", imagePosition: "aplus", sourceUrlHash: a },
  { id: 2, imageUrl: "/b.jpg", imagePosition: "aplus", sourceUrlHash: b },
  {
    id: 3,
    imageUrl: "/bg.jpg",
    imagePosition: "brand_story",
    sourceUrlHash: bg,
  },
];
const finding = (id: string, source: string, translation: string) => ({
  id,
  source,
  translation,
  sellingPoints: [],
});
it("changes native text, saved Chinese and right-hand tags together when a slide changes", () => {
  const layout = {
    version: 2,
    modules: [
      {
        id: "m",
        section: "aplus",
        kind: "carousel",
        cards: [
          {
            images: [{ hash: a }],
            blocks: [{ id: "first", text: "First complete paragraph." }],
          },
          {
            images: [{ hash: b }],
            blocks: [{ id: "second", text: "Second complete paragraph." }],
          },
        ],
      },
    ],
  };
  const presentation = {
    version: 1 as const,
    generatedAt: "now",
    images: [],
    texts: [
      finding("first", "First complete paragraph.", "第一段全文"),
      finding("second", "Second complete paragraph.", "第二段全文"),
    ],
  };
  render(
    <AmazonRichContent
      layout={layout}
      images={images.slice(0, 2)}
      section="aplus"
      onSelect={vi.fn()}
      presentation={presentation}
      renderTags={(items, selection) => (
        <div>
          {items.map(i =>
            i.sourceUrlHash === a ? "第一图标签" : "第二图标签"
          )}
          {selection?.blocks.map(t => (
            <span key={t.id}>{t.id}</span>
          ))}
        </div>
      )}
    />
  );
  expect(screen.getByText("第一段全文")).toBeInTheDocument();
  expect(screen.getByText("第一图标签")).toBeInTheDocument();
  expect(screen.queryByText("第二段全文")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "下一张" }));
  expect(screen.getByText("第二段全文")).toBeInTheDocument();
  expect(screen.getByText("第二图标签")).toBeInTheDocument();
  expect(screen.queryByText("第一图标签")).not.toBeInTheDocument();
});
it("preserves grouped brand cards and keeps the background outside translation controls", () => {
  HTMLElement.prototype.scrollTo = vi.fn();
  const layout = {
    version: 2,
    modules: [
      {
        id: "brand",
        section: "brand_story",
        kind: "brand_story",
        background: { hash: bg },
        cards: [
          {
            images: [
              { hash: a },
              { hash: b },
              { hash: "d".repeat(64) },
              { hash: "e".repeat(64) },
            ],
          },
          { images: [], blocks: [{ id: "q", text: "Why our brand?" }] },
        ],
      },
    ],
  };
  render(
    <AmazonRichContent
      layout={layout}
      images={images}
      section="brand_story"
      onSelect={vi.fn()}
      renderTags={(_items, s) => (
        <div>{s?.card?.blocks?.[0]?.text || "组合标签"}</div>
      )}
    />
  );
  expect(
    screen.getByLabelText("品牌故事四图组合").querySelector(".grid-cols-2")
  ).toBeInTheDocument();
  expect(screen.getByTestId("brand-story-leading-space")).toBeInTheDocument();
  expect(screen.getAllByTestId("prepared-image")).toHaveLength(2);
  expect(
    screen.getByRole("button", { name: "查看品牌故事背景图" })
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "下一组品牌故事" }));
  expect(
    within(
      screen.getByRole("complementary", { name: "当前模块标签" })
    ).getByText("Why our brand?")
  ).toBeInTheDocument();
});
it("keeps complete bilingual pure text and QA without requiring an image", () => {
  const layout = {
    version: 2,
    modules: [
      {
        id: "text",
        section: "aplus",
        kind: "text",
        cards: [
          {
            images: [],
            blocks: [
              { id: "p1", text: "First paragraph." },
              { id: "p2", text: "Last paragraph." },
            ],
          },
        ],
      },
      {
        id: "qa",
        section: "aplus",
        kind: "faq",
        cards: [],
        questions: [
          {
            question: { id: "q", text: "Can I wash it?" },
            answer: { id: "ans", text: "Yes.\n\nUse a gentle cycle." },
          },
        ],
      },
    ],
  };
  const presentation = {
    version: 1 as const,
    generatedAt: "now",
    images: [],
    texts: [
      finding("p1", "First paragraph.", "首段"),
      finding("p2", "Last paragraph.", "末段"),
      finding("q", "Can I wash it?", "可以洗吗？"),
      finding("ans", "Yes.\n\nUse a gentle cycle.", "可以。\n\n使用轻柔模式。"),
    ],
  };
  render(
    <AmazonRichContent
      layout={layout}
      images={[]}
      section="aplus"
      onSelect={vi.fn()}
      presentation={presentation}
    />
  );
  expect(screen.getByText("末段")).toBeInTheDocument();
  expect(screen.getByText("可以洗吗？")).toBeInTheDocument();
  expect(screen.getByText(/使用轻柔模式/)).toBeInTheDocument();
});
it("renders overlay copy in an overlaid panel and rejects a translation bound to different source text", () => {
  const layout = {
    version: 2,
    modules: [
      {
        id: "overlay",
        section: "aplus",
        sourceType: "STANDARD_IMAGE_TEXT_OVERLAY",
        kind: "image",
        cards: [
          {
            images: [{ hash: a }],
            blocks: [{ id: "copy", text: "Current copy." }],
          },
        ],
      },
    ],
  };
  render(
    <AmazonRichContent
      layout={layout}
      images={images.slice(0, 1)}
      section="aplus"
      onSelect={vi.fn()}
      presentation={{
        version: 1,
        generatedAt: "now",
        images: [],
        texts: [finding("copy", "Old copy.", "过期译文")],
      }}
    />
  );
  expect(
    screen.getByText("Current copy.").closest(".md\\:absolute")
  ).toBeInTheDocument();
  expect(screen.queryByText("过期译文")).not.toBeInTheDocument();
});
