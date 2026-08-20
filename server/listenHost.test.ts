import { describe, expect, it } from "vitest";
import { resolveListenHost } from "./_core/listenHost";

describe("resolveListenHost", () => {
  it("uses an explicit independent deployment loopback host", () => {
    expect(resolveListenHost("127.0.0.1")).toBe("127.0.0.1");
  });

  it("keeps the hosted deployment default when no host is configured", () => {
    expect(resolveListenHost("   ")).toBeUndefined();
  });
});
