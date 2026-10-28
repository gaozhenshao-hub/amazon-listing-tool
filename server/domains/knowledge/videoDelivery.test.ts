import { it, expect, vi } from "vitest";
vi.mock("../../storage", () => ({
  parseStorageUri: (value: string) => {
    const m = value.match(/^storage:\/\/([^/]+)\/(.+)$/);
    return m ? { provider: m[1], key: m[2] } : null;
  },
  resolveStoredObjectUrl: vi.fn(async (value: string) => `signed:${value}`),
}));
import {
  knowledgeVideoStorageKey,
  resolveKnowledgeVideos,
} from "./videoDelivery";
const hash = "a".repeat(64),
  base = `storage://local/acquisition/1/snapshots/9/video/0-${hash}`;
it("only signs recognized video and cover objects in the authorized workspace", async () => {
  expect(knowledgeVideoStorageKey(base + ".mp4", 1, false)).toBe(base + ".mp4");
  for (const uri of [
    base + ".poster.webp",
    base.replace("/1/", "/2/") + ".mp4",
    base.replace("/video/", "/../") + ".mp4",
    "https://example.com/video.mp4",
  ])
    expect(knowledgeVideoStorageKey(uri, 1, false)).toBeNull();
  const result = await resolveKnowledgeVideos(
    [
      {
        hash,
        role: "main",
        position: 6,
        moduleId: null,
        videoUrl: base + ".mp4",
        posterUrl: base + ".poster.webp",
        status: "ready",
      },
    ],
    2
  );
  expect(result[0]).toMatchObject({
    videoUrl: null,
    posterUrl: null,
    status: "failed",
  });
});
