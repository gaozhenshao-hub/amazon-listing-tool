import { router } from "../domains/ops/operations/context";
import { inventoryProcedures } from "../domains/ops/operations/inventory";
import { profitProcedures } from "../domains/ops/operations/profit";
import { advertisingProcedures } from "../domains/ops/operations/advertising";
import { competitorsProcedures } from "../domains/ops/operations/competitors";
import { settingsProcedures } from "../domains/ops/operations/settings";
import { tagsProcedures } from "../domains/ops/operations/tags";

export const operationsRouter = router({
  ...inventoryProcedures,
  ...profitProcedures,
  ...advertisingProcedures,
  ...competitorsProcedures,
  ...settingsProcedures,
  ...tagsProcedures,
});
