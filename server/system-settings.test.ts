import { describe, expect, it } from "vitest";
import {
  buildProxyUrl,
  getScraperConfig,
  PROXY_SETTING_KEYS,
  PROVIDER_PRESETS,
} from "./routers/systemSettings";

describe("systemSettings - retired crawler proxy", () => {
  it("never builds a runtime proxy URL from legacy settings", () => {
    expect(buildProxyUrl({})).toBeUndefined();
    expect(buildProxyUrl({
      [PROXY_SETTING_KEYS.PROXY_ENABLED]: "true",
      [PROXY_SETTING_KEYS.PROXY_URL]: "http://legacy.example.invalid:8080",
      [PROXY_SETTING_KEYS.PROXY_USERNAME]: "legacy-user",
      [PROXY_SETTING_KEYS.PROXY_PASSWORD]: "legacy-password",
    })).toBeUndefined();
  });

  it("fails closed when legacy scraper configuration is requested", async () => {
    await expect(getScraperConfig()).rejects.toMatchObject({
      code: "FEATURE_RETIRED",
    });
    await expect(getScraperConfig()).rejects.toThrow(/crawler\.getProviderReadiness/);
  });
});

describe("systemSettings - PROVIDER_PRESETS", () => {
  it("does not expose retired proxy vendor presets", () => {
    expect(PROVIDER_PRESETS).toEqual({});
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
