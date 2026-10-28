import { emperorArtifactsRouter } from "./routers/artifacts";
import { emperorAgentsRouter } from "./routers/agents";
import { router } from "../../_core/trpc";
import { assistantConfigurationsRouter } from "./routers/assistantConfigurations";
import { assistantConversationsRouter } from "./routers/assistantConversations";
import { emperorDiagnosticsRouter } from "./routers/diagnostics";
import { emperorModelsRouter } from "./routers/models";
import { emperorRunRouter } from "./routers/run";
import { emperorSkillsRouter } from "./routers/skills";
import { skillWorkbenchRouter } from "./routers/skillWorkbench";

export { emperorDiagnosticsRouter } from "./routers/diagnostics";
export { emperorModelsRouter } from "./routers/models";
export { emperorRunRouter } from "./routers/run";
export { emperorSkillsRouter } from "./routers/skills";
export * from "./routerContext";

export const emperorRouter = router({
  artifacts: emperorArtifactsRouter,
  agents: emperorAgentsRouter,
  assistantConfigurations: assistantConfigurationsRouter,
  assistantConversations: assistantConversationsRouter,
  skills: emperorSkillsRouter,
  skillWorkbench: skillWorkbenchRouter,
  run: emperorRunRouter,
  models: emperorModelsRouter,
  diagnostics: emperorDiagnosticsRouter,
});
