import { router } from "../_core/trpc";
import { settingsProcedures } from "../domains/ops/operations/settings";
export const operationsRouter = router(settingsProcedures);
