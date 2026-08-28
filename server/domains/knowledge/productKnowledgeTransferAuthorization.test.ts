import { describe, expect, it } from "vitest";
import { assertProductKnowledgeTransferExportAuthority } from "./productKnowledgeTransferAuthorization";

describe("product knowledge transfer export authority", () => {
  it("allows only the super administrator to export workspace-wide shared knowledge", () => {
    expect(() => assertProductKnowledgeTransferExportAuthority("super_admin")).not.toThrow();
    expect(() => assertProductKnowledgeTransferExportAuthority("admin")).toThrow(/仅超级管理员/);
    expect(() => assertProductKnowledgeTransferExportAuthority("ops_specialist")).toThrow(/仅超级管理员/);
    expect(() => assertProductKnowledgeTransferExportAuthority(undefined)).toThrow(/仅超级管理员/);
  });
});
