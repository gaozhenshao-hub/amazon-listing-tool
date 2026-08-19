import { describe, expect, it } from "vitest";
import {
  buildProjectFileEmperorSkill,
  PROJECT_FILE_SKILL_SLUGS,
} from "./routers/projectFileSkillRoutes";

describe("project file Emperor Skill routing", () => {
  it("routes product attribute parsing through the released Rufus Skill", () => {
    const route = buildProjectFileEmperorSkill("product_attributes");

    expect(PROJECT_FILE_SKILL_SLUGS.product_attributes).toBe("analysis.rufus.attribute");
    expect(route).toEqual({
      slug: "analysis.rufus.attribute",
      migrationSource: "project_file.product_attributes",
    });
  });
});
