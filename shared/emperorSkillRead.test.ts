import { describe, expect, it } from "vitest";
import { EmperorSkillReadInputSchema, EmperorSkillReadResultSchema, EmperorSkillSlugSchema } from "./emperorSkillRead";

const result = () => ({ identity: { userId: 3, workspaceId: 7 }, skill: { slug: "listing.title.research", name: "标题研究", description: null,
  category: "Listing", status: "Released", scope: "global", version: "12", sourceWorkspaceId: null, systemPrompt: "原文\n<img src=x>", userPromptTemplate: null },
provenance: { kind: "current_registry", pinnedVersion: false } });
describe("exact read-only Skill shared contract", () => {
  it.each(["listing.title.research", "A_1-x.y", "x".repeat(128)])("allows exact registry slug %s", slug => expect(EmperorSkillSlugSchema.parse(slug)).toBe(slug));
  it.each(["", " x", "x ", "x/y", "x?y", "x#y", "x%20", "x\ny", ".x", "中", "x".repeat(129)])("rejects malformed slug %j without normalizing", slug => expect(EmperorSkillSlugSchema.safeParse(slug).success).toBe(false));
  it.each([null, 1, 2_147_483_647])("allows explicit authenticated workspace precondition %s", expectedWorkspaceId => expect(EmperorSkillReadInputSchema.parse({ slug: "x", expectedWorkspaceId })).toEqual({ slug: "x", expectedWorkspaceId }));
  it.each([undefined, 0, -1, 1.5, "7", 2_147_483_648, NaN])("rejects malformed/missing workspace %s", expectedWorkspaceId => expect(EmperorSkillReadInputSchema.safeParse({ slug: "x", expectedWorkspaceId }).success).toBe(false));
  it("rejects extra input selections including user/version/manifest", () => {
    for (const key of ["userId", "version", "workspaceId", "manifest", "sourceWorkspaceId"]) expect(EmperorSkillReadInputSchema.safeParse({ slug: "x", expectedWorkspaceId: null, [key]: 1 }).success).toBe(false);
  });
  it("keeps nullable missing text and complete literal prompt unchanged", () => expect(EmperorSkillReadResultSchema.parse(result())).toEqual(result()));
  it("does not allow a false pinned-version claim", () => {
    const value = result(); value.provenance.pinnedVersion = true;
    expect(EmperorSkillReadResultSchema.safeParse(value).success).toBe(false);
  });
  it.each(["Draft", "Validated", "Approved", "Deprecated", "released"])("does not expose unavailable status %s", status => {
    const value = result(); value.skill.status = status; expect(EmperorSkillReadResultSchema.safeParse(value).success).toBe(false);
  });
  it("rejects arbitrary manifest/connection data in a response", () => {
    for (const layer of ["root", "skill", "identity", "provenance"]) {
      const value: Record<string, unknown> = result();
      const target = layer === "root" ? value : value[layer] as Record<string, unknown>;
      target.apiKey = "secret";
      expect(EmperorSkillReadResultSchema.safeParse(value).success).toBe(false);
    }
  });
  it("rejects numeric version and numeric prompts instead of coercing", () => {
    for (const [key, value] of [["version", 3], ["systemPrompt", 42], ["description", 7], ["sourceWorkspaceId", "7"]]) {
      const payload = result(); Object.assign(payload.skill, { [String(key)]: value });
      expect(EmperorSkillReadResultSchema.safeParse(payload).success).toBe(false);
    }
  });
});
