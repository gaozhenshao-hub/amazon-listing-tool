import { describe, expect, it } from "vitest";
import {
  buildListingAgentNodeUrl,
  getListingAgentStep,
  parseListingAgentNodeContext,
} from "./listingAgentNavigation";

describe("Listing Agent node navigation", () => {
  it("carries the run, node, and project into the existing node page", () => {
    expect(buildListingAgentNodeUrl({ runId: "agent_123", nodeId: "N1", projectId: 42 }))
      .toBe("/listing/analysis?agentRunId=agent_123&nodeId=N1&projectId=42");
  });

  it("restores node workbench context only on the matching business page", () => {
    expect(parseListingAgentNodeContext(
      "/listing/generate?agentRunId=agent_123&nodeId=G3&projectId=42",
    )).toEqual({ runId: "agent_123", nodeId: "G3", projectId: 42 });

    expect(parseListingAgentNodeContext(
      "/listing/analysis?agentRunId=agent_123&nodeId=G3&projectId=42",
    )).toBeNull();
  });

  it("uses the shared workflow definition for artifact version lookup", () => {
    expect(getListingAgentStep("E1")).toMatchObject({
      label: "E1 · 智能图片建议",
      artifactKey: "imageAdvice",
      required: false,
    });
  });
});
