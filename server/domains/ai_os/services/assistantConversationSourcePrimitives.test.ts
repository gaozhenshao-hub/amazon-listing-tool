import { describe, expect, it } from "vitest";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import * as pure from "./assistantConversationSourcePrimitives";
import * as repository from "../repositories/assistantConversations";
import * as configuration from "./assistantConfigurations";
import * as runtime from "./assistantConversationRuntime";
import * as strict from "./strictSkillRuntime";
import * as catalog from "./teamorouterCatalog";

describe("standalone readonly source probe import boundary", () => {
  it("bundles and evaluates only pure local dependencies without DB/env/runner or app initialization", async () => {
    const result = await build({ entryPoints: ["server/domains/ai_os/services/assistantConversationSourceComparison.ts"], bundle: true, platform: "node", format: "cjs", packages: "external", write: false, metafile: true });
    expect(Object.keys(result.metafile!.inputs).sort()).toEqual([
      "server/domains/ai_os/services/assistantConversationSourceComparison.ts",
      "server/domains/ai_os/services/assistantConversationSourcePrimitives.ts",
      "server/domains/ai_os/services/strictSkillRuntime.ts",
      "shared/agentLibraryContracts.ts", "shared/assistantConfigurations.ts",
    ].sort());
    const loaded: string[] = [], require = createRequire(import.meta.url), module = { exports: {} as Record<string, unknown> };
    runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, Buffer, URL, structuredClone, require: (name: string) => {
      loaded.push(name); if (!["node:crypto", "zod", "@trpc/server"].includes(name)) throw new Error(`IMPURE_IMPORT:${name}`); return require(name);
    } });
    expect([...new Set(loaded)].sort()).toEqual(["@trpc/server", "node:crypto", "zod"]);
    expect(typeof module.exports.captureAssistantConversationSourceEvidence).toBe("function");
    expect(typeof module.exports.compareAssistantConversationSources).toBe("function");
  });
});

describe("mechanical extraction preserves original public exports", () => {
  it("re-exports identical canonical, configuration, schema, fingerprint and error identities", () => {
    expect(repository.assistantConversationCanonical).toBe(pure.assistantConversationCanonical);
    expect(repository.AssistantConversationStorageError).toBe(pure.AssistantConversationStorageError);
    for (const name of ["canonicalConfigurationJson", "configurationHash", "skillManifestHash"] as const) expect(configuration[name]).toBe(pure[name]);
    for (const name of ["AssistantConversationRuntimeError", "AssistantConversationSkillPinSchema", "AssistantConversationSourceApprovalSchema", "assistantConversationSkillSnapshotFromRow", "assistantConversationSkillSnapshotHash", "assistantConversationSkillScopeMatches"] as const) expect(runtime[name]).toBe(pure[name]);
  });
  it("keeps canonical default byte budget and safe storage error prefix/class/conflict", () => {
    expect(pure.assistantConversationCanonical({ b: [true, null], a: 1 })).toBe('{"a":1,"b":[true,null]}');
    for (const value of [undefined, -0, NaN, new Date(), [undefined]]) {
      try { pure.assistantConversationCanonical(value); throw new Error("accepted invalid JSON"); }
      catch (error) { expect(error).toBeInstanceOf(repository.AssistantConversationStorageError); expect(error).toMatchObject({ code: "JSON_INVALID", message: "ASSISTANT_CONVERSATION_JSON_INVALID", conflict: false }); }
    }
    expect(() => pure.assistantConversationCanonical("x".repeat(1024 * 1024))).toThrow("ASSISTANT_CONVERSATION_JSON_LIMIT");
    const conflict = new repository.AssistantConversationStorageError("CONFLICT", true); expect(conflict.conflict).toBe(true);
  });
  it("keeps configuration hash and manifest error behavior including native JSON semantic sorting", () => {
    const value = { name: "A", description: "", enabled: true, modelSlug: "", instructions: "", rules: [], skills: [] };
    expect(pure.canonicalConfigurationJson(value)).toBe('{"description":"","enabled":true,"instructions":"","modelSlug":"","name":"A","rules":[],"skills":[]}');
    expect(pure.configurationHash(value)).toBe(configuration.configurationHash(value));
    expect(pure.skillManifestHash({ b: 2, a: { z: true } })).toBe(pure.skillManifestHash('{ "a": { "z": true }, "b": 2 }'));
    for (const [value, message] of [["{", "ASSISTANT_DATA_INVALID"], [null, "ASSISTANT_SKILL_MANIFEST_INVALID"], [[], "ASSISTANT_SKILL_MANIFEST_INVALID"], [{ a: undefined }, "ASSISTANT_SKILL_MANIFEST_INVALID"]] as const) {
      try { pure.skillManifestHash(value); throw new Error("accepted invalid manifest"); }
      catch (error) { expect(error).toMatchObject({ name: "TRPCError", code: "PRECONDITION_FAILED", message }); }
    }
  });
  it("keeps original registry defaults and rejects invalid rows with original runtime error type", () => {
    const result = pure.assistantConversationSkillSnapshotFromRow({ id: 1, workspaceId: null, scope: "global", slug: "test", name: "Test", version: 1, status: "Released", modelOverride: "", timeout_seconds: 0, manifest: { implementation: { systemPrompt: "System" } } });
    expect(result.pin).toMatchObject({ timeoutSeconds: 120, maxTokens: 4096, temperature: null, supportsJsonMode: false, modelOverride: null });
    expect(result.userPrompt).toBe("{{context}}");
    expect(pure.assistantConversationSkillScopeMatches(result.pin, 3, "test")).toBe(true);
    expect(pure.assistantConversationSkillScopeMatches({ ...result.pin, scope: "shared" }, 3, "test")).toBe(false);
    try { pure.assistantConversationSkillSnapshotFromRow(null); throw new Error("accepted invalid row"); }
    catch (error) { expect(error).toBeInstanceOf(runtime.AssistantConversationRuntimeError); expect(error).toMatchObject({ code: "SKILL_UNAVAILABLE", message: "ASSISTANT_CONVERSATION_SKILL_UNAVAILABLE" }); }
  });
  it("keeps catalog endpoint exports identical without moving credential resolution", () => {
    for (const name of ["TEAMOROUTER_OPENAI_BASE_URL", "TEAMOROUTER_DIRECT_HOST", "TEAMOROUTER_LEGACY_SOCKS_HOST", "TEAMOROUTER_CREDENTIAL_REF", "canonicalizeTeamorouterOpenAiBaseUrl"] as const) expect(catalog[name]).toBe(strict[name]);
    expect(strict.canonicalizeTeamorouterOpenAiBaseUrl("https://api.teamorouter.com/v1/")).toBe("https://api.teamorouter.cn/v1");
    for (const url of ["https://example.invalid/v1/", "https://api.teamorouter.cn/v1/", "not a URL"]) expect(strict.canonicalizeTeamorouterOpenAiBaseUrl(url)).toBe(url);
    expect(catalog.defaultTeamorouterFallbacks("")).toEqual(["teamo-gemini-3-8-flash", "teamo-deepseek-v4-flash"]);
    expect(catalog.defaultTeamorouterFallbacks("synthetic-only")).toEqual(["manus-default", "teamo-gemini-3-8-flash"]);
  });
});
