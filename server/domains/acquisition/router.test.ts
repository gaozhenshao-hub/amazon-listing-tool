import { describe, expect, it } from "vitest";
import { listAiJobHandlerRegistrations } from "../../services/aiJobRunner";
import { amazonAcquisitionRouter } from "./router";

describe("amazon acquisition router", () => {
  it("initializes the provider administration procedures", () => {
    const procedures = Object.keys(amazonAcquisitionRouter._def.procedures);
    expect(procedures).toEqual(expect.arrayContaining([
      "providerProfile",
      "saveProviderProfile",
      "estimate",
      "createJob",
      "listJobs",
    ]));
  });

  it("registers a recoverable persistent Worker handler", () => {
    expect(listAiJobHandlerRegistrations()).toContainEqual({
      id: "amazon-acquisition-fetch",
      recoverable: true,
    });
  });
});
