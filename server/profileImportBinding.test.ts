import { describe, expect, it } from "vitest";
import { PROFILE_IMPORT_JOB_KIND } from "../shared/profileImportJob";
import { assertBusinessJobAgentBinding } from "./domains/ai_os/services/businessJobBindingPolicy";

describe("profile import fixed business-node contract", () => {
  it("accepts only an explicit Listing N3 binding", () => {
    const input = { agentRunId: "agent-real-id", agentNodeId: "N3" };
    expect(assertBusinessJobAgentBinding({ module: "listing", kind: PROFILE_IMPORT_JOB_KIND, input })).toEqual(input);
  });
  it.each([
    { module: "other", input: { agentRunId: "agent", agentNodeId: "N3" } },
    { module: "listing", input: { agentRunId: "agent", agentNodeId: "N5" } },
    { module: "listing", input: { agentRunId: "", agentNodeId: "N3" } },
    { module: "listing", input: null },
  ])("rejects a wrong or missing binding %j", input => {
    expect(() => assertBusinessJobAgentBinding({ ...input, kind: PROFILE_IMPORT_JOB_KIND })).toThrow("Listing N3");
  });
  it("does not change the contract for other kinds", () => {
    expect(assertBusinessJobAgentBinding({ module: "other", kind: "old", input: null })).toBeNull();
    expect(() => assertBusinessJobAgentBinding({ module: "listing", kind: "old", input: null })).toThrow("must include");
  });
});
