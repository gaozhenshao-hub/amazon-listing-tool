import { describe, expect, it } from "vitest";
import {
  buildProxyUrl,
  PROXY_SETTING_KEYS,
  PROVIDER_PRESETS,
} from "./routers/systemSettings";

describe("systemSettings - buildProxyUrl", () => {
  it("returns undefined when no proxy settings provided", () => {
    const result = buildProxyUrl({});
    expect(result).toBeUndefined();
  });

  it("returns undefined when proxy is disabled", () => {
    const result = buildProxyUrl({
      [PROXY_SETTING_KEYS.PROXY_ENABLED]: "false",
      [PROXY_SETTING_KEYS.PROXY_HOST]: "proxy.example.com",
      [PROXY_SETTING_KEYS.PROXY_PORT]: "8080",
    });
    expect(result).toBeUndefined();
  });

  it("returns direct URL when proxy_url is set and enabled", () => {
    const result = buildProxyUrl({
      [PROXY_SETTING_KEYS.PROXY_ENABLED]: "true",
      [PROXY_SETTING_KEYS.PROXY_URL]: "http://user:pass@proxy.example.com:8080",
    });
    expect(result).toBe("http://user:pass@proxy.example.com:8080");
  });

  it("builds URL from host/port when no direct URL", () => {
    const result = buildProxyUrl({
      [PROXY_SETTING_KEYS.PROXY_ENABLED]: "true",
      [PROXY_SETTING_KEYS.PROXY_HOST]: "proxy.example.com",
      [PROXY_SETTING_KEYS.PROXY_PORT]: "8080",
      [PROXY_SETTING_KEYS.PROXY_PROTOCOL]: "http",
    });
    expect(result).toBe("http://proxy.example.com:8080");
  });

  it("includes username and password in URL when provided", () => {
    const result = buildProxyUrl({
      [PROXY_SETTING_KEYS.PROXY_ENABLED]: "true",
      [PROXY_SETTING_KEYS.PROXY_HOST]: "proxy.example.com",
      [PROXY_SETTING_KEYS.PROXY_PORT]: "8080",
      [PROXY_SETTING_KEYS.PROXY_PROTOCOL]: "https",
      [PROXY_SETTING_KEYS.PROXY_USERNAME]: "myuser",
      [PROXY_SETTING_KEYS.PROXY_PASSWORD]: "mypass",
    });
    expect(result).toBe("https://myuser:mypass@proxy.example.com:8080");
  });

  it("uses default protocol http when not specified", () => {
    const result = buildProxyUrl({
      [PROXY_SETTING_KEYS.PROXY_ENABLED]: "true",
      [PROXY_SETTING_KEYS.PROXY_HOST]: "proxy.example.com",
      [PROXY_SETTING_KEYS.PROXY_PORT]: "3128",
    });
    expect(result).toBe("http://proxy.example.com:3128");
  });

  it("supports socks5 protocol", () => {
    const result = buildProxyUrl({
      [PROXY_SETTING_KEYS.PROXY_ENABLED]: "true",
      [PROXY_SETTING_KEYS.PROXY_HOST]: "socks.example.com",
      [PROXY_SETTING_KEYS.PROXY_PORT]: "1080",
      [PROXY_SETTING_KEYS.PROXY_PROTOCOL]: "socks5",
    });
    expect(result).toBe("socks5://socks.example.com:1080");
  });

  it("returns undefined when host is missing", () => {
    const result = buildProxyUrl({
      [PROXY_SETTING_KEYS.PROXY_ENABLED]: "true",
      [PROXY_SETTING_KEYS.PROXY_PORT]: "8080",
    });
    expect(result).toBeUndefined();
  });

  it("builds URL without port when port is missing", () => {
    const result = buildProxyUrl({
      [PROXY_SETTING_KEYS.PROXY_ENABLED]: "true",
      [PROXY_SETTING_KEYS.PROXY_HOST]: "proxy.example.com",
    });
    expect(result).toBe("http://proxy.example.com");
  });
});

describe("systemSettings - PROVIDER_PRESETS", () => {
  it("has presets for all major providers", () => {
    expect(PROVIDER_PRESETS).toHaveProperty("smartproxy");
    expect(PROVIDER_PRESETS).toHaveProperty("oxylabs");
    expect(PROVIDER_PRESETS).toHaveProperty("brightdata");
    expect(PROVIDER_PRESETS).toHaveProperty("scraperapi");
  });

  it("each preset has required fields", () => {
    for (const [key, preset] of Object.entries(PROVIDER_PRESETS)) {
      expect(preset).toHaveProperty("name");
      expect(preset).toHaveProperty("host");
      expect(preset).toHaveProperty("port");
      expect(preset).toHaveProperty("protocol");
      expect(typeof preset.name).toBe("string");
      expect(typeof preset.host).toBe("string");
      expect(typeof preset.port).toBe("string");
      expect(typeof preset.protocol).toBe("string");
      expect(preset.host.length).toBeGreaterThan(0);
      expect(preset.port.length).toBeGreaterThan(0);
    }
  });

  it("smartproxy preset has correct host", () => {
    const sp = PROVIDER_PRESETS["smartproxy"];
    expect(sp.host).toContain("smartproxy");
  });

  it("oxylabs preset has correct host", () => {
    const ox = PROVIDER_PRESETS["oxylabs"];
    expect(ox.host).toContain("oxylabs");
  });
});

describe("systemSettings - PROXY_SETTING_KEYS", () => {
  it("has all required keys", () => {
    expect(PROXY_SETTING_KEYS.PROXY_ENABLED).toBe("proxy_enabled");
    expect(PROXY_SETTING_KEYS.PROXY_URL).toBe("proxy_url");
    expect(PROXY_SETTING_KEYS.PROXY_HOST).toBe("proxy_host");
    expect(PROXY_SETTING_KEYS.PROXY_PORT).toBe("proxy_port");
    expect(PROXY_SETTING_KEYS.PROXY_USERNAME).toBe("proxy_username");
    expect(PROXY_SETTING_KEYS.PROXY_PASSWORD).toBe("proxy_password");
    expect(PROXY_SETTING_KEYS.PROXY_PROTOCOL).toBe("proxy_protocol");
    expect(PROXY_SETTING_KEYS.PROXY_PROVIDER).toBe("proxy_provider");
    expect(PROXY_SETTING_KEYS.SCRAPER_MAX_RETRIES).toBe("scraper_max_retries");
    expect(PROXY_SETTING_KEYS.SCRAPER_TIMEOUT).toBe("scraper_timeout");
    expect(PROXY_SETTING_KEYS.SCRAPER_MIN_DELAY).toBe("scraper_min_delay");
    expect(PROXY_SETTING_KEYS.SCRAPER_MAX_DELAY).toBe("scraper_max_delay");
  });
});
