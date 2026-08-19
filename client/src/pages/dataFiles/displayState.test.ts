import { describe, expect, it } from "vitest";
import { shouldShowProjectFileError } from "./displayState";

describe("project file error presentation", () => {
  it("only shows an error message when the latest analysis is failed", () => {
    expect(shouldShowProjectFileError("failed", "Skill execution failed")).toBe(true);
    expect(shouldShowProjectFileError("completed", "Old failure message")).toBe(false);
    expect(shouldShowProjectFileError("analyzing", "Old failure message")).toBe(false);
  });

  it("does not show blank failure text", () => {
    expect(shouldShowProjectFileError("failed", "   ")).toBe(false);
  });
});
