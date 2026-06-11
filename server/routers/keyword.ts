import { router } from "../_core/trpc";
import { keywordCrudRouter } from "./keywordCrud";
import { keywordAiRouter } from "./keywordAi";

// Re-export both sub-routers separately
// The CRUD router is registered as `keyword` and the AI router as `keywordAi`
// This prevents TS watcher type inference timeout that occurred when all 20+ procedures
// were in a single router (the type string was truncated after ~18 procedures)
export { keywordCrudRouter as keywordRouter };
export { keywordAiRouter };
