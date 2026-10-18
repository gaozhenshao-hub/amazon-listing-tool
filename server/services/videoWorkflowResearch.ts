import type { CompetitorAnalysis } from "../../drizzle/schema/project";
import type { DbExecutor } from "../repositories/dbClient";
import { hydrateActiveCompetitorResearchForLockedRow } from "../domains/listing/services/competitorActiveResearch";
/** Cross-domain composition only; it neither grants permissions nor opens a transaction. */
export const hydrateVideoWorkflowResearch = (row: CompetitorAnalysis, tx: DbExecutor,
  parent: { id: number; userId: number; workspaceId: number | null }) => hydrateActiveCompetitorResearchForLockedRow(row, tx, parent);
