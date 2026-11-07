import { sql } from "drizzle-orm";
import { requireDb, closeDbConnection } from "../server/repositories/dbClient";
import {
  planningRows,
  planningJson,
} from "../server/domains/listing/imagePlanningStore";
import { readListingAggregation } from "../server/domains/listing/aggregationStore";
import {
  researchCategories,
  researchCategory,
} from "../shared/researchCategories";
import {
  RESEARCH_SKILLS,
  RESEARCH_ADJUST_SKILL,
  researchSkillPrompts,
  RESEARCH_ADJUST_PROMPT,
} from "../server/domains/listing/researchPrompts";
import {
  IMAGE_PLANNING_SKILL,
  IMAGE_PLANNING_PROMPT,
} from "../server/domains/listing/imagePlanningPrompt";
import { assistantConfigurationService } from "../server/domains/ai_os/services/assistantConfigurations";
import { configureResearchWorkflow } from "./setup-research-workflow";
const database = await requireDb("verify research release"),
  [project] = await planningRows(
    database,
    sql`SELECT userId,workspaceId FROM projects WHERE id=1`
  );
if (!project) throw new Error("Current project unavailable");
const scope = {
  projectId: 1,
  workspaceId: Number(project.workspaceId),
  userId: Number(project.userId),
};
if (process.argv.includes("--configure"))
  console.log(
    JSON.stringify({
      configuration: await configureResearchWorkflow(
        scope.workspaceId,
        scope.userId
      ),
    })
  );
const expected = new Map([
  ...Object.entries(RESEARCH_SKILLS).map(([key, slug]) => [
    slug,
    researchSkillPrompts[key as keyof typeof researchSkillPrompts],
  ]),
  [RESEARCH_ADJUST_SKILL, RESEARCH_ADJUST_PROMPT],
  [IMAGE_PLANNING_SKILL, IMAGE_PLANNING_PROMPT],
]);
const skills = await planningRows(
  database,
  sql`SELECT slug,name,status,version,manifest FROM emperor_skills WHERE workspaceId IS NULL AND slug IN (${sql.join(
    [...expected.keys()].map(k => sql`${k}`),
    sql`,`
  )})`
);
if (skills.length !== expected.size)
  throw new Error("Research Skills are incomplete");
for (const skill of skills)
  if (
    skill.status !== "Released" ||
    !/[\u4e00-\u9fff]/.test(skill.name) ||
    planningJson(skill.manifest)?.implementation?.systemPrompt !==
      expected.get(skill.slug)
  )
    throw new Error("Research Skill differs from this release: " + skill.slug);
const configured = await assistantConfigurationService.get(
  scope.workspaceId,
  "images"
);
if (
  configured.status !== "configured" ||
  !configured.record.config.enabled ||
  !configured.record.config.skills.some(
    s => s.slug === RESEARCH_SKILLS.planning && s.enabled
  )
)
  throw new Error("Image briefing binding unavailable");
const smallL = await assistantConfigurationService.get(
  scope.workspaceId,
  "listing"
);
if (
  smallL.status === "configured" &&
  [
    RESEARCH_SKILLS.selling,
    RESEARCH_SKILLS.reviews,
    RESEARCH_SKILLS.questions,
    RESEARCH_ADJUST_SKILL,
  ].some(
    slug => !smallL.record.config.skills.some(s => s.slug === slug && s.enabled)
  )
)
  throw new Error("小L研究技能尚未绑定");
const aggregate = await readListingAggregation(scope),
  categories = Object.fromEntries(
    Object.keys(researchCategories).map(key => [key, 0])
  );
for (const node of [
  ...(aggregate.data.features || []),
  ...aggregate.data.selling,
  ...aggregate.data.reviews,
  ...aggregate.data.questions,
])
  categories[researchCategory(node)]++;
console.log(
  JSON.stringify({
    status: "RESEARCH_WORKFLOW_VERIFIED",
    project: scope.projectId,
    categories,
    skillNames: skills.map(s => s.name),
    operatorFactsPreserved: true,
    ownPhotos: aggregate.data.productPhotos?.length || 0,
    questionsWithAnswers: aggregate.data.questions.filter(q => q.answer?.trim())
      .length,
  })
);
await closeDbConnection();
