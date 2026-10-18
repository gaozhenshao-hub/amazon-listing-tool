import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { inventoryCollectionConfig, inventoryCollectionCredentials, INVENTORY_COLLECTION_MAPPING_VERSION } from "./inventoryCollectionConfig";
const controls = vi.hoisted(() => ({ decrypt: vi.fn(() => "synthetic-private-secret") }));
vi.mock("../ai_os/services/toolGateway/governanceCore", () => ({ decryptToolSecretValue: controls.decrypt }));
const cipher = { encryptedValue: "YWFhYQ==", iv: "YWFhYWFhYWFhYWFh", authTag: "YWFhYWFhYWFhYWFhYWFhYQ==", keyVersion: "v1" };
const row = () => ({ workspaceId: 7, appId: "synthetic-app", apiBaseUrl: "https://openapi.sellfox.com", secretCipher: JSON.stringify(cipher) });
const executor = (rows: unknown[], engine = "InnoDB", unique = true) => ({ execute: vi.fn(async (query: SQL) => {
  const text = new MySqlDialect().sqlToQuery(query).sql;
  if (text.includes("information_schema.TABLES")) return [[{ engine }], []];
  if (text.includes("information_schema.STATISTICS")) return [unique ? [{ indexName: "PRIMARY", nonUnique: 0, sequence: 1, columnName: "workspace_id", prefixLength: null }] : [], []];
  return [rows, []];
}) });
beforeEach(() => { controls.decrypt.mockReset().mockReturnValue("synthetic-private-secret"); });
describe("inventory collection credential boundary", () => {
  it("returns opaque version and conservative mapping, never plaintext/cipher/token", async () => {
    const db = executor([row()]); const config = await inventoryCollectionConfig(db, 7);
    expect(config).toEqual({ connectionVersion: expect.stringMatching(/^[a-f0-9]{64}$/), mappingVersion: INVENTORY_COLLECTION_MAPPING_VERSION, scopeBindings: [], mappingOptions: { latestShipmentAllocation: { approved: false } } });
    expect(controls.decrypt).not.toHaveBeenCalled();
    expect(JSON.stringify(config)).not.toMatch(/synthetic|YWFh|secret|token/i);
    const query = new MySqlDialect().sqlToQuery(db.execute.mock.calls[2][0]);
    expect(query.sql).toContain("WHERE workspace_id=? LIMIT 2 FOR SHARE"); expect(query.params).toEqual([7]);
  });
  it("does not depend on token refresh or historical connection summary", async () => {
    const a = await inventoryCollectionConfig(executor([{ ...row(), tokenCipher: "first", connectionState: "failed" }]), 7);
    const b = await inventoryCollectionConfig(executor([{ ...row(), tokenCipher: "second", connectionState: "connected" }]), 7);
    expect(a).toEqual(b);
  });
  it("pins cipher/app/workspace while normalizing only the official trailing slash", async () => {
    const original = await inventoryCollectionConfig(executor([row()]), 7);
    expect(await inventoryCollectionConfig(executor([{ ...row(), apiBaseUrl: "https://openapi.sellfox.com/" }]), 7)).toEqual(original);
    for (const change of [{ appId: "other" }, { secretCipher: JSON.stringify({ ...cipher, keyVersion: "v2" }) }]) expect((await inventoryCollectionConfig(executor([{ ...row(), ...change }]), 7))?.connectionVersion).not.toBe(original?.connectionVersion);
  });
  it("decrypts only matching version for a worker", async () => {
    const db = executor([row()]); const config = (await inventoryCollectionConfig(db, 7))!;
    expect(await inventoryCollectionCredentials(db, 7, config.connectionVersion)).toEqual({ workspaceId: 7, appId: "synthetic-app", connectionVersion: config.connectionVersion, secret: "synthetic-private-secret" });
    expect(controls.decrypt).toHaveBeenCalledTimes(1);
    await expect(inventoryCollectionCredentials(db, 7, "0".repeat(64))).rejects.toThrow("CONFIG_CHANGED"); expect(controls.decrypt).toHaveBeenCalledTimes(1);
  });
  it("missing rows/table are unavailable, other DB failures are sanitized", async () => {
    expect(await inventoryCollectionConfig(executor([]), 7)).toBeNull();
    expect(await inventoryCollectionConfig({ execute: vi.fn().mockRejectedValue({ cause: { code: "ER_NO_SUCH_TABLE" } }) }, 7)).toBeNull();
    await expect(inventoryCollectionConfig({ execute: vi.fn().mockRejectedValue(new Error("SECRET SQL")) }, 7)).rejects.toThrow(/^INVENTORY_COLLECTION_CONFIG_READ_FAILED$/);
  });
  it("requires transactional config and exact workspace uniqueness for version locks", async () => {
    await expect(inventoryCollectionConfig(executor([row()], "MyISAM"), 7)).rejects.toThrow("CONFIG_READ_FAILED");
    await expect(inventoryCollectionConfig(executor([row()], "InnoDB", false), 7)).rejects.toThrow("CONFIG_READ_FAILED");
  });
  it.each([
    { apiBaseUrl: "https://evil.example" }, { apiBaseUrl: "https://openapi.sellfox.com/path" }, { apiBaseUrl: "https://user:pass@openapi.sellfox.com" },
    { apiBaseUrl: "https://openapi.sellfox.com/?token=x" }, { apiBaseUrl: "https://openapi.sellfox.com/#x" }, { workspaceId: 8 }, { appId: " a" }, { appId: "a\n" },
    { secretCipher: null }, { secretCipher: "x".repeat(20001) }, { secretCipher: "{}" }, { secretCipher: JSON.stringify({ ...cipher, extra: "secret" }) },
  ])("rejects invalid config %j", async patch => { await expect(inventoryCollectionConfig(executor([{ ...row(), ...patch }]), 7)).rejects.toThrow("CONFIG_INVALID"); });
  it("rejects duplicates and failed decryption without error detail", async () => {
    await expect(inventoryCollectionConfig(executor([row(), row()]), 7)).rejects.toThrow("CONFIG_INVALID");
    const db = executor([row()]), config = (await inventoryCollectionConfig(db, 7))!;
    controls.decrypt.mockImplementation(() => { throw new Error("private key material"); });
    await expect(inventoryCollectionCredentials(db, 7, config.connectionVersion)).rejects.toThrow(/^INVENTORY_COLLECTION_SECRET_UNAVAILABLE$/);
  });
});
