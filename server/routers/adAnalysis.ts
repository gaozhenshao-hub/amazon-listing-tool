import { router } from "../domains/ads/adAnalysis/context";
import { searchTermsProcedures } from "../domains/ads/adAnalysis/searchTerms";
import { placementAndHourlyProcedures } from "../domains/ads/adAnalysis/placementAndHourly";
import { diagnosticsProcedures } from "../domains/ads/adAnalysis/diagnostics";
import { campaignsProcedures } from "../domains/ads/adAnalysis/campaigns";
import { budgetProcedures } from "../domains/ads/adAnalysis/budget";

export const adAnalysisRouter = router({
  ...searchTermsProcedures,
  ...placementAndHourlyProcedures,
  ...diagnosticsProcedures,
  ...campaignsProcedures,
  ...budgetProcedures,
});

export { getAdAnalysisCache } from "../domains/ads/adAnalysis/context";
