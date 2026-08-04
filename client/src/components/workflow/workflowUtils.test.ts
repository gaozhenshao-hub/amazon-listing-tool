import { describe, expect, it } from "vitest";
import {
  chooseActiveWorkflowStep,
  formatWorkflowDate,
  getArtifactsForStep,
  getCheckpointForStep,
  getWorkflowRunProgress,
  isWorkflowStepDone,
  normalizeCheckpointStatus,
  parseDraftText,
  safeJsonText,
  summarizeWorkflowOutput,
  toWorkflowIdSet,
  workflowIdKey,
} from "./workflowUtils";

const steps = [
  { id: 1, label: "分析", agentNodeId: "analysis", artifactKey: "analysis.output" },
  { id: "confirm", label: "确认", agentNodeId: "confirm" },
];

describe("workflowUtils", () => {
  it("normalizes workflow ids and status aliases", () => {
    expect(workflowIdKey(12)).toBe("12");
    expect(toWorkflowIdSet([1, "confirm"])).toEqual(new Set(["1", "confirm"]));
    expect(normalizeCheckpointStatus("completed")).toBe("confirmed");
    expect(normalizeCheckpointStatus("running")).toBe("running");
    expect(normalizeCheckpointStatus("unexpected")).toBe("pending");
    expect(normalizeCheckpointStatus(null)).toBe("pending");
  });

  it("recognizes terminal human workflow states", () => {
    expect(isWorkflowStepDone("confirmed")).toBe(true);
    expect(isWorkflowStepDone("skipped")).toBe(true);
    expect(isWorkflowStepDone("locked")).toBe(true);
    expect(isWorkflowStepDone("failed")).toBe(false);
  });

  it("resolves checkpoints and artifacts for a step", () => {
    const checkpoints = [{ nodeId: "analysis", status: "waiting_human" }];
    const artifacts = [
      { nodeId: "analysis", artifactKey: "analysis.output", version: 2 },
      { nodeId: "analysis", artifactKey: "other", version: 1 },
      { nodeId: "confirm", artifactKey: "analysis.output", version: 1 },
    ];

    expect(getCheckpointForStep(steps[0], checkpoints)).toEqual(checkpoints[0]);
    expect(getCheckpointForStep({ id: "plain", label: "Plain" }, checkpoints)).toBeUndefined();
    expect(getCheckpointForStep(steps[0], [])).toBeUndefined();
    expect(getArtifactsForStep(steps[0], artifacts)).toEqual([artifacts[0]]);
    expect(getArtifactsForStep({ id: "all", label: "All" }, artifacts)).toEqual(artifacts);
    expect(getArtifactsForStep(steps[0], [])).toEqual([]);
  });

  it("chooses active steps and safely summarizes outputs", () => {
    expect(chooseActiveWorkflowStep(steps, "confirm")).toEqual(steps[1]);
    expect(chooseActiveWorkflowStep(steps, "missing")).toEqual(steps[0]);
    expect(summarizeWorkflowOutput(null)).toBe("");
    expect(summarizeWorkflowOutput("short", 10)).toBe("short");
    expect(summarizeWorkflowOutput({ value: "long" }, 8)).toBe('{\n  "val...');
  });

  it("calculates progress from a run or checkpoint completion", () => {
    expect(getWorkflowRunProgress({ run: { progress: 110 } })).toBe(100);
    expect(getWorkflowRunProgress({ run: { progress: 42.6 } })).toBe(43);
    expect(getWorkflowRunProgress({ checkpoints: [] })).toBe(0);
    expect(getWorkflowRunProgress({
      checkpoints: [
        { nodeId: "one", status: "confirmed" },
        { nodeId: "two", status: "running" },
      ],
    })).toBe(50);
  });

  it("formats dates and draft values without throwing", () => {
    expect(formatWorkflowDate(null)).toBe("");
    expect(formatWorkflowDate("not-a-date")).toBe("");
    expect(formatWorkflowDate(new Date("2026-01-02T03:04:05Z"))).not.toBe("");

    expect(safeJsonText("plain")).toBe("plain");
    expect(safeJsonText({ ok: true })).toContain('"ok": true');
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(safeJsonText(circular)).toBe("[object Object]");

    expect(parseDraftText("  ")).toBeNull();
    expect(parseDraftText('{"ok":true}')).toEqual({ ok: true });
    expect(parseDraftText("human edited text")).toBe("human edited text");
  });
});
