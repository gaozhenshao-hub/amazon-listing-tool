import { router } from "./routerContext";
import { imageSessionProcedures } from "./routers/sessions";
import { imageCompetitorProcedures } from "./routers/competitors";
import { imageExpressionGroupProcedures } from "./routers/expressionGroups";
import { imageWorkflowStepProcedures } from "./routers/workflowSteps";
import { imageStep5Procedures } from "./routers/step5";
import { imageStep6Procedures } from "./routers/step6";
import { imageReferenceProcedures } from "./routers/references";
import { imageKnowledgeExportProcedures } from "./routers/knowledgeExport";

export const imageWorkflowRouter = router({
  ...imageSessionProcedures,
  ...imageCompetitorProcedures,
  ...imageExpressionGroupProcedures,
  ...imageWorkflowStepProcedures,
  ...imageStep5Procedures,
  ...imageStep6Procedures,
  ...imageReferenceProcedures,
  ...imageKnowledgeExportProcedures,
});
