import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  SafeHttpError,
  isBlockedIpAddress,
  resolveAndValidateTarget,
  safeHttpRequest,
} from "./infrastructure/http/safeHttpClient";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function localServer(handler: http.RequestListener) {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind a TCP port");
  return `http://127.0.0.1:${address.port}`;
}

describe("safe HTTP client", () => {
  it("blocks private, link-local, metadata, mapped IPv6, and reserved addresses", () => {
    for (const address of [
      "127.0.0.1", "0.0.0.0", "10.0.0.1", "172.16.0.1", "192.168.1.1",
      "169.254.169.254", "100.64.0.1", "224.0.0.1", "::", "::1", "fc00::1",
      "fe80::1", "ff02::1", "::ffff:127.0.0.1", "2001:db8::1",
    ]) {
      expect(isBlockedIpAddress(address), address).toBe(true);
    }
    expect(isBlockedIpAddress("8.8.8.8")).toBe(false);
    expect(isBlockedIpAddress("2001:4860:4860::8888")).toBe(false);
  });

  it("blocks alternate IPv4 notation and mixed public/private DNS answers", async () => {
    await expect(resolveAndValidateTarget(new URL("http://2130706433/private"))).rejects.toMatchObject({
      reason: "blocked_address",
    });
    await expect(resolveAndValidateTarget(new URL("https://public.example/test"), {
      resolver: async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ],
    })).rejects.toMatchObject({ reason: "blocked_address" });
  });

  it("validates allowlists and rejects credentials", async () => {
    await expect(resolveAndValidateTarget(new URL("https://example.com"), {
      allowedHosts: ["api.example.com"],
      resolver: async () => [{ address: "8.8.8.8", family: 4 }],
    })).rejects.toMatchObject({ reason: "host_not_allowed" });
    await expect(resolveAndValidateTarget(new URL("https://user:pass@example.com"), {
      resolver: async () => [{ address: "8.8.8.8", family: 4 }],
    })).rejects.toMatchObject({ reason: "embedded_credentials" });
  });

  it("enforces response size and redirect limits", async () => {
    const oversized = await localServer((_request, response) => response.end("x".repeat(2048)));
    await expect(safeHttpRequest(oversized, {
      allowPrivateNetwork: true,
      allowTestNetwork: true,
      maxResponseBytes: 128,
    })).rejects.toMatchObject({ reason: "response_too_large" });

    const redirecting = await localServer((_request, response) => {
      response.writeHead(302, { location: "/again" });
      response.end();
    });
    await expect(safeHttpRequest(`${redirecting}/again`, {
      allowPrivateNetwork: true,
      allowTestNetwork: true,
      maxRedirects: 1,
    })).rejects.toMatchObject({ reason: "redirect_limit" });
  });

  it("returns bounded JSON responses", async () => {
    const endpoint = await localServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
    const response = await safeHttpRequest(endpoint, { allowPrivateNetwork: true, allowTestNetwork: true });
    expect(response.ok).toBe(true);
    expect(response.json()).toEqual({ ok: true });
  });

  it("uses structured policy errors", async () => {
    await expect(safeHttpRequest("http://localhost/private")).rejects.toBeInstanceOf(SafeHttpError);
  });

  it("blocks real network access from unit tests unless explicitly enabled", async () => {
    await expect(safeHttpRequest("https://example.com")).rejects.toMatchObject({
      reason: "test_network_blocked",
    });
  });
});
