import { DevelopmentMarketCandidateSchema, DevelopmentMarketSourceSchema, type DevelopmentMarketSource } from "../../../../shared/developmentMarket";
import { createConfiguredBusinessRuntime, CONFIGURED_BUSINESS_DEFINITIONS, ConfiguredBusinessRuntimeError,
  type ConfiguredBusinessRuntimeInput } from "../../ai_os/services/configuredBusinessRuntime";
import { developmentMarketSourceContext } from "./developmentMarketSource";
import { equal } from "./developmentMarketCore";

/** Thin domain adapter: the saved Development agent is not inferred from a
 * display name, a client prompt, or the generic product-analysis handler. */
export function createDevelopmentMarketRuntime(dependencies: Omit<Parameters<typeof createConfiguredBusinessRuntime>[0], "definition" | "parseCandidate"> = {}) {
  const runtime = createConfiguredBusinessRuntime({ ...dependencies, definition: CONFIGURED_BUSINESS_DEFINITIONS.developmentMarket,
    parseCandidate: value => DevelopmentMarketCandidateSchema.parse(value) });
  function input(value: ConfiguredBusinessRuntimeInput & { source: DevelopmentMarketSource }) {
    const source = DevelopmentMarketSourceSchema.parse(value.source);
    if (source.sourceHash !== value.sourceHash || !equal(source.identity, value.identity) || !equal(developmentMarketSourceContext(source), value.sourceContext)) throw new ConfiguredBusinessRuntimeError("SOURCE_INVALID");
    const { source: _source, ...rest } = value; return rest;
  }
  return {
    prepare(value: ConfiguredBusinessRuntimeInput & { source: DevelopmentMarketSource }) { return runtime.prepare(input(value)); },
    revalidate(value: ConfiguredBusinessRuntimeInput & { source: DevelopmentMarketSource; runtimeSnapshot: unknown }) { return runtime.revalidate({ ...input(value), runtimeSnapshot: value.runtimeSnapshot }); },
    prepareStage(value: ConfiguredBusinessRuntimeInput & { source: DevelopmentMarketSource; runtimeSnapshot: unknown }) { return runtime.prepareStage({ ...input(value), runtimeSnapshot: value.runtimeSnapshot }); },
    async executeStage(...args: Parameters<typeof runtime.executeStage>) {
      const result = await runtime.executeStage(...args);
      if (result.stage !== "development_market_overview") throw new ConfiguredBusinessRuntimeError("RESULT_RECEIPT_MISMATCH");
      return { ...result, stage: "development_market_overview" as const };
    },
  };
}
export const developmentMarketRuntime = createDevelopmentMarketRuntime();
