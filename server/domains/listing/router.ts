import { router } from "./routerContext";
import { listingReadProcedures } from "./routers/read";
import { listingGenerationProcedures } from "./routers/generation";
import { listingEditingProcedures } from "./routers/editing";
import { listingAbTestingProcedures } from "./routers/abTesting";
import { listingEvaluationProcedures } from "./routers/evaluation";
import { listingVersionProcedures } from "./routers/versions";

export const listingRouter = router({
  ...listingReadProcedures,
  ...listingGenerationProcedures,
  ...listingEditingProcedures,
  ...listingAbTestingProcedures,
  ...listingEvaluationProcedures,
  ...listingVersionProcedures,
});
