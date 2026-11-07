// @vitest-environment jsdom
import { afterEach, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import KnowledgeVideoPlayer from "./KnowledgeVideoPlayer";
import AmazonRichContent from "./AmazonRichContent";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const video = {
  hash: "a".repeat(64),
  role: "aplus" as const,
  position: 0,
  moduleId: "aplus-0",
  title: "Video",
  duration: null,
  videoUrl: "/signed/video.mp4",
  posterUrl: "/signed/cover.webp",
  status: "ready" as const,
};
it("keeps an admitted missing video blank even when a cover exists",()=>{
 const {container}=render(<KnowledgeVideoPlayer video={{...video,status:"failed",videoUrl:null}}/>);
 expect(screen.getByText("缺失视频 · A+ 视频")).toBeTruthy();
 expect(container.querySelector("img")).toBeNull();expect(container.querySelector("video")).toBeNull();
});
it("loads only the cover until clicked and uses an inline controlled player", () => {
  const { container } = render(<KnowledgeVideoPlayer video={video} />);
  expect(container.querySelector("video")).toBeNull();
  expect(
    screen.getByRole("img", { name: "A+ 视频封面" }).getAttribute("loading")
  ).toBe("lazy");
  fireEvent.click(screen.getByRole("button", { name: "播放A+ 视频" }));
  expect(container.querySelector("video")?.getAttribute("src")).toBe(
    "/signed/video.mp4"
  );
  expect(container.querySelector("video")?.getAttribute("preload")).toBe(
    "none"
  );
  expect(container.querySelector("video")?.hasAttribute("controls")).toBe(true);
});
it("preserves a leading A+ video without a tag panel", () => {
  const tags = vi.fn();
  const { container } = render(
    <AmazonRichContent
      layout={{
        version: 1,
        modules: [
          {
            id: "aplus-0",
            section: "aplus",
            kind: "video",
            videoHashes: [video.hash],
            cards: [],
            rows: [],
          },
        ],
      }}
      images={[]}
      videos={[video]}
      section="aplus"
      onSelect={() => {}}
      renderTags={tags}
    />
  );
  expect(container.querySelector("section")?.getAttribute("aria-label")).toBe(
    "A+ 视频模块"
  );
  expect(screen.getByRole("button", { name: "播放A+ 视频" })).toBeTruthy();
  expect(tags).not.toHaveBeenCalled();
});
it("seeks after metadata arrives and supports repeat clicks on the same segment", () => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const { container, rerender } = render(
    <KnowledgeVideoPlayer video={video} seek={{ seconds: 12, nonce: 1 }} />
  );
  const player = container.querySelector("video")!;
  Object.defineProperty(player, "readyState", { value: 1, configurable: true });
  Object.defineProperty(player, "duration", { value: 30, configurable: true });
  fireEvent.loadedMetadata(player);
  expect(player.currentTime).toBe(12);
  player.currentTime = 23;
  rerender(
    <KnowledgeVideoPlayer video={video} seek={{ seconds: 12, nonce: 2 }} />
  );
  expect(player.currentTime).toBe(12);
  rerender(
    <KnowledgeVideoPlayer video={video} seek={{ seconds: 100, nonce: 3 }} />
  );
  expect(player.currentTime).toBeLessThan(30);
});

it("keeps an evidence clip quiet until selected and then seeks to its saved moment",()=>{const play=vi.spyOn(HTMLMediaElement.prototype,"play").mockResolvedValue(undefined);const {container}=render(<KnowledgeVideoPlayer video={{hash:"a".repeat(64),role:"main",status:"ready",videoUrl:"/saved.mp4",posterUrl:null,duration:40} as any} seek={{seconds:12,nonce:1}} autoplayOnSeek={false}/>);expect(container.querySelector("video")).toBeNull();fireEvent.click(screen.getByRole("button",{name:"播放主图视频"}));const element=container.querySelector("video")!;Object.defineProperty(element,"readyState",{value:1,configurable:true});Object.defineProperty(element,"duration",{value:40,configurable:true});fireEvent.loadedMetadata(element);expect(element.currentTime).toBe(12);expect(play).toHaveBeenCalledTimes(1);});
