import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "client/src/main.tsx"), "utf8");

describe("client query cache recovery policy", () => {
  it("keeps recently loaded data briefly, avoids focus storms, and refetches after reconnect", () => {
    expect(source).toContain("staleTime: 30_000");
    expect(source).toContain("gcTime: 10 * 60_000");
    expect(source).toContain("refetchOnWindowFocus: false");
    expect(source).toContain("refetchOnReconnect: true");
  });
});
