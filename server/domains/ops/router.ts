import { router } from "./routerContext";
import { opsProductProcedures } from "./routers/products";
import { opsTodoLogProcedures } from "./routers/todosLogs";
import { opsKeywordMonitorProcedures } from "./routers/keywordMonitors";
import { opsMarketplaceSummaryProcedures } from "./routers/marketplaceSummaries";
import { opsPlanProcedures } from "./routers/plans";
import { opsConversionProcedures } from "./routers/conversion";
import { opsExecutionReviewProcedures } from "./routers/executionReviews";
import { opsTeamTaskProcedures } from "./routers/teamTasks";
import { opsSyncProcedures } from "./routers/sync";
import { opsWeeklyProcedures } from "./routers/weeklyOps";
import { opsImportProcedures } from "./routers/imports";

export const productOpsRouter = router({
  ...opsProductProcedures,
  ...opsTodoLogProcedures,
  ...opsKeywordMonitorProcedures,
  ...opsMarketplaceSummaryProcedures,
  ...opsPlanProcedures,
  ...opsConversionProcedures,
  ...opsExecutionReviewProcedures,
  ...opsTeamTaskProcedures,
  ...opsSyncProcedures,
  ...opsWeeklyProcedures,
  ...opsImportProcedures,
});
