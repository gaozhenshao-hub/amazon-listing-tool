import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createTRPCClient, httpBatchLink, httpLink } from "@trpc/client";
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { describe, expect, it, vi } from "vitest";
import { singleRequestOptInLink } from "./singleRequestOptInLink";
import { getRequestTimeoutMs } from "./requestTimeout";

const t = initTRPC.create({ transformer: superjson });
const router = t.router({ save: t.procedure.mutation(() => ({ accepted: true })) });
type Router = typeof router;
function fixture() {
  const calls: Array<{ url: URL; body: unknown }> = [];
  const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)), body: unknown = JSON.parse(String(init?.body)); calls.push({ url, body });
    const reply = { result: { data: superjson.serialize({ accepted: true }) } };
    const value = url.searchParams.has("batch") ? Object.keys(body as object).map(() => reply) : reply;
    return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  });
  const options = { url: "https://synthetic.invalid/api/trpc", transformer: superjson, fetch: request };
  const client = createTRPCClient<Router>({ links: [singleRequestOptInLink(httpLink<Router>(options), httpBatchLink<Router>(options))] });
  return { client, calls, request };
}
describe("explicit single-request source transport", () => {
  it.each(["preview", "save", "complete", "download", "manifest"])("uses the declared full-original budget for %s", method => {
    expect(getRequestTimeoutMs(`/api/trpc/listing.supplementSources.${method}`)).toBe(180_000);
  });
  it("keeps small source status reads short and cannot opt in through query text", () => {
    expect(getRequestTimeoutMs("/api/trpc/listing.supplementSources.check")).toBe(30_000);
    expect(getRequestTimeoutMs("/api/trpc/auth.me?other=listing.supplementSources.save")).toBe(30_000);
  });
  it("keeps simultaneous ordinary mutations on the original batch link", async () => {
    const f = fixture(); await Promise.all([f.client.save.mutate(), f.client.save.mutate()]);
    expect(f.request).toHaveBeenCalledOnce(); expect(f.calls[0].url.searchParams.get("batch")).toBe("1");
    expect(Object.keys(f.calls[0].body as object)).toEqual(["0", "1"]);
  });
  it("sends each opted-in source operation independently, never a combined batch", async () => {
    const f = fixture(); await Promise.all([f.client.save.mutate(undefined, { context: { skipBatch: true } }), f.client.save.mutate(undefined, { context: { skipBatch: true } })]);
    expect(f.request).toHaveBeenCalledTimes(2); expect(f.calls.every(call => !call.url.searchParams.has("batch"))).toBe(true);
  });
  it("does not let a truthy string change the default transport", async () => {
    const f = fixture(); await Promise.all([f.client.save.mutate(undefined, { context: { skipBatch: "true" } }), f.client.save.mutate()]);
    expect(f.request).toHaveBeenCalledOnce(); expect(f.calls[0].url.searchParams.get("batch")).toBe("1");
  });
  it("main reuses one unchanged option/fetch object for both links", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/main.tsx"), "utf8");
    expect(source).toContain("singleRequestOptInLink(httpLink<AppRouter>(httpOptions), httpBatchLink<AppRouter>(httpOptions))");
    expect(source).toContain('credentials: "include"'); expect(source).toContain("getRequestTimeoutMs(inputUrl)");
  });
});
