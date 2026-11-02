import { describe, expect, it } from "vitest";
import { EXTERNAL_KNOWLEDGE_SCOPES, hashExternalKnowledgeCallerToken, parseExternalKnowledgeCallerConfig } from "../services/externalKnowledgeCaller";

describe("external knowledge caller configuration", () => {
  it("uses a deterministic one-way token digest and fixed read-only scope vocabulary", () => {
    expect(hashExternalKnowledgeCallerToken("caller-token")).toMatch(/^[a-f0-9]{64}$/);
    expect(hashExternalKnowledgeCallerToken("caller-token")).toBe(hashExternalKnowledgeCallerToken("caller-token"));
    expect(EXTERNAL_KNOWLEDGE_SCOPES).toEqual(["stats", "search", "rag"]);
  });

  it("parses persisted configuration defensively without treating malformed data as a binding", () => {
    expect(parseExternalKnowledgeCallerConfig('{"kind":"external_knowledge_api"}')).toEqual({ kind: "external_knowledge_api" });
    expect(parseExternalKnowledgeCallerConfig("not-json")).toEqual({});
    expect(parseExternalKnowledgeCallerConfig(null)).toEqual({});
  });
});
