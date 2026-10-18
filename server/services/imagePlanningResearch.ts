import type { CompetitorAnalysis } from "../../drizzle/schema/project";
import type { DbExecutor } from "../repositories/dbClient";
import { hydrateActiveCompetitorResearchForLockedRow } from "../domains/listing/services/competitorActiveResearch";
/** Upper-layer composition bridge. It reuses the durable verified proof. */
export const hydrateImagePlanningResearch = (row: CompetitorAnalysis, tx: DbExecutor,
  parent: { id: number; userId: number; workspaceId: number | null }) => hydrateActiveCompetitorResearchForLockedRow(row, tx, parent);
