import { router } from "./routerContext";
import { listingReadProcedures } from "./routers/read";
import { listingGenerationProcedures } from "./routers/generation";
import { listingEditingProcedures } from "./routers/editing";
import { listingAbTestingProcedures } from "./routers/abTesting";
import { listingEvaluationProcedures } from "./routers/evaluation";
import { listingVersionProcedures } from "./routers/versions";
import { listingJobControlProcedures } from "./routers/jobControl";
import { listingPlanningProcedures } from "./routers/planning";
import { listingFactReviewProcedures } from "./routers/facts";
import { listingCoreReviewProcedures } from "./routers/cores";
import { listingCandidateReviewProcedures } from "./routers/candidates";
import { listingConfiguredProcedures } from "./routers/configured";
import { listingAuxiliaryProcedures } from "./routers/auxiliary";
import { listingSupplementSourcesRouter } from "./supplementSources/router";

export const listingRouter = router({
  supplementSources: listingSupplementSourcesRouter,
  ...listingConfiguredProcedures,
  ...listingAuxiliaryProcedures,
  ...listingReadProcedures,
  ...listingGenerationProcedures,
  ...listingEditingProcedures,
  ...listingAbTestingProcedures,
  ...listingEvaluationProcedures,
  ...listingVersionProcedures,
  ...listingJobControlProcedures,
  ...listingPlanningProcedures,
  ...listingFactReviewProcedures,
  ...listingCoreReviewProcedures,
  ...listingCandidateReviewProcedures,
});
