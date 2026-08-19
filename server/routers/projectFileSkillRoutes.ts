export const PROJECT_FILE_SKILL_SLUGS = {
  product_attributes: "analysis.rufus.attribute",
} as const;

export function buildProjectFileEmperorSkill(fileType: keyof typeof PROJECT_FILE_SKILL_SLUGS) {
  return {
    slug: PROJECT_FILE_SKILL_SLUGS[fileType],
    migrationSource: `project_file.${fileType}`,
  };
}
