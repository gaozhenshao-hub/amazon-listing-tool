import { listingFactReviewProcedures } from "./facts";
import { listingCoreReviewProcedures } from "./cores";
import { listingCandidateReviewProcedures } from "./candidates";

/** Keep the existing three human-review gates in their original spread order.
 * Composition only: no procedure, permission, resolver or recovery changes.
 */
export const listingReviewProcedures = {
  ...listingFactReviewProcedures,
  ...listingCoreReviewProcedures,
  ...listingCandidateReviewProcedures,
};
