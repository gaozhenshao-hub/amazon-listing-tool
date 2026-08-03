import { router } from "../../_core/trpc";
import { emperorAgentsRouter } from "./routers/agents";
import { emperorDiagnosticsRouter } from "./routers/diagnostics";
import { emperorKnowledgeRouter } from "./routers/knowledge";
import { emperorMcpRouter } from "./routers/mcp";
import { emperorModelsRouter } from "./routers/models";
import { emperorObservabilityRouter } from "./routers/observability";
import { emperorRunRouter } from "./routers/run";
import { emperorScheduledRouter } from "./routers/scheduled";
import { emperorSkillsRouter } from "./routers/skills";
import { emperorToolsRouter } from "./routers/tools";

export { emperorAgentsRouter } from "./routers/agents";
export { emperorDiagnosticsRouter } from "./routers/diagnostics";
export { emperorKnowledgeRouter } from "./routers/knowledge";
export { emperorMcpRouter } from "./routers/mcp";
export { emperorModelsRouter } from "./routers/models";
export { emperorObservabilityRouter } from "./routers/observability";
export { emperorRunRouter } from "./routers/run";
export { emperorScheduledRouter } from "./routers/scheduled";
export { emperorSkillsRouter } from "./routers/skills";
export { emperorToolsRouter } from "./routers/tools";
export * from "./routerContext";

export const emperorRouter = router({
  skills: emperorSkillsRouter,
  run: emperorRunRouter,
  models: emperorModelsRouter,
  mcp: emperorMcpRouter,
  tools: emperorToolsRouter,
  agents: emperorAgentsRouter,
  scheduled: emperorScheduledRouter,
  diagnostics: emperorDiagnosticsRouter,
  knowledge: emperorKnowledgeRouter,
  observability: emperorObservabilityRouter,
});
