import { describe, expect, it } from "vitest";
import {
  knowledgeCacheRetention,
  knowledgeCacheCleanupEnabled,
  type CacheRetentionInput,
} from "./cacheRetention";

const now = new Date("2026-10-27T12:00:00Z");
const job: CacheRetentionInput = {
  consumerType: "kb_images",
  status: "confirmed",
  now,
  completedAt: new Date("2026-10-20T12:00:00Z"),
  permanentlyDeletedSet: false,
  hasManualRevision: false,
  hasOtherConsumer: false,
  hasActiveCollection: false,
};

describe("knowledge acquisition retention plan", () => {
  it("keeps the friend edition default and supports an explicit deployment suspension", () => {
    expect(knowledgeCacheCleanupEnabled({})).toBe(true);
    expect(knowledgeCacheCleanupEnabled({ KNOWLEDGE_CACHE_CLEANUP_ENABLED: "true" })).toBe(true);
    expect(knowledgeCacheCleanupEnabled({ KNOWLEDGE_CACHE_CLEANUP_ENABLED: "false" })).toBe(false);
    expect(knowledgeCacheCleanupEnabled({ KNOWLEDGE_CACHE_CLEANUP_ENABLED: " FALSE " })).toBe(false);
  });
  it("keeps a complete seven days before expiring successful cache", () => {
    expect(knowledgeCacheRetention(job)).toBe("eligible");
    expect(
      knowledgeCacheRetention({ ...job, now: new Date(now.getTime() - 1) })
    ).toBe("retained");
  });
  it.each(["queued", "running", "review_required", "failed", "canceled"])(
    "retains %s, including manual supplementation",
    status => {
      expect(
        knowledgeCacheRetention({ ...job, status, permanentlyDeletedSet: true })
      ).toBe("unfinished");
    }
  );
  it.each([
    "hasManualRevision",
    "hasOtherConsumer",
    "hasActiveCollection",
  ] as const)("protects %s even after permanent deletion", key => {
    expect(
      knowledgeCacheRetention({
        ...job,
        [key]: true,
        permanentlyDeletedSet: true,
      })
    ).not.toBe("eligible");
  });
  it("does not expire other businesses or invalid timestamps", () => {
    expect(
      knowledgeCacheRetention({ ...job, consumerType: "project_competitor" })
    ).toBe("other_business");
    expect(
      knowledgeCacheRetention({ ...job, completedAt: new Date(NaN) })
    ).toBe("invalid_time");
    expect(
      knowledgeCacheRetention({
        ...job,
        completedAt: new Date(now.getTime() + 1),
      })
    ).toBe("invalid_time");
  });
  it("can expire a recently completed cache only for an exactly identified permanently deleted set", () => {
    expect(
      knowledgeCacheRetention({
        ...job,
        completedAt: now,
        permanentlyDeletedSet: true,
      })
    ).toBe("eligible");
  });
});
