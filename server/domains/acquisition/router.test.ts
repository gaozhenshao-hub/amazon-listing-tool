import { describe, expect, it } from "vitest";
import { listAiJobHandlerRegistrations } from "../../services/aiJobRunner";
import { amazonAcquisitionRouter } from "./router";

describe("amazon acquisition router", () => {
  it("exposes native collection without provider or fee settings", () => {
    const procedures = Object.keys(amazonAcquisitionRouter._def.procedures);
    expect(procedures).toEqual(expect.arrayContaining([
      "createJob",
      "listJobs",
    ]));
    for (const removed of ["providerProfile","saveProviderProfile","estimate"]) expect(procedures).not.toContain(removed);
  });

  it("registers a recoverable persistent Worker handler", () => {
    expect(listAiJobHandlerRegistrations()).toContainEqual({
      id: "amazon-acquisition-fetch",
      recoverable: true,
    });
  });
});
