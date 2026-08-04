import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf-8");
}

describe("frontend workflow framework", () => {
  it("provides common human-in-the-loop workflow building blocks", () => {
    const files = [
      "client/src/components/workflow/WorkflowShell.tsx",
      "client/src/components/workflow/WorkflowStepProgress.tsx",
      "client/src/components/workflow/WorkflowCheckpointControls.tsx",
      "client/src/components/workflow/WorkflowArtifactVersionPicker.tsx",
      "client/src/components/workflow/useAgentWorkflowRun.ts",
      "client/src/components/workflow/workflowDefinitions.ts",
    ];

    for (const file of files) {
      expect(fs.existsSync(path.join(root, file)), file).toBe(true);
    }
  });

  it("wires listing canvas, image, ads, and video pages to the common workflow components", () => {
    const canvas = read("client/src/pages/WorkflowCanvasPage.tsx");
    expect(canvas).toContain("listing.full.workflow");
    expect(canvas).toContain("useAgentWorkflowRun");
    expect(canvas).toContain("WorkflowCheckpointControls");
    expect(canvas).toContain("WorkflowArtifactVersionPicker");
    expect(canvas).toContain("WorkflowStepProgress");
    expect(read("client/src/pages/ImageWorkflowPage.tsx")).toContain("WorkflowShell");
    expect(read("client/src/pages/AdStructurePage.tsx")).toContain("WorkflowStepProgress");
    expect(read("client/src/pages/VideoScriptPage.tsx")).toContain("WorkflowStepProgress");
  });

  it("keeps the Listing main flow aligned with the Agent DAG node ids", () => {
    const definitions = read("client/src/components/workflow/workflowDefinitions.ts");
    for (const nodeId of ["N0", "N1", "N2", "N3", "N4", "N5", "G1", "G2", "G3", "G4", "G5", "O1", "O2", "O3", "E1", "E2"]) {
      expect(definitions).toContain(`id: "${nodeId}"`);
      expect(definitions).toContain(`agentNodeId: "${nodeId}"`);
    }
  });

  it("keeps Agent Run and Artifact operations centralized in the workflow layer", () => {
    const shell = read("client/src/components/workflow/WorkflowShell.tsx");
    const controls = read("client/src/components/workflow/WorkflowCheckpointControls.tsx");
    const versions = read("client/src/components/workflow/WorkflowArtifactVersionPicker.tsx");

    expect(shell).toContain("useAgentWorkflowRun");
    expect(controls).toContain("confirmNode");
    expect(controls).toContain("rerunNode");
    expect(versions).toContain("selectArtifactVersion");
    expect(versions).toContain("rollbackArtifactVersion");
  });

  it("removes the deprecated Listing 2.0 feature from routes, menu, and API surface", () => {
    expect(read("client/src/App.tsx")).not.toContain("listing2");
    expect(read("client/src/components/DashboardLayout.tsx")).not.toContain("listing2");
    expect(read("server/routers.ts")).not.toContain("listing2");
    expect(fs.existsSync(path.join(root, "server/routers/listing2.ts"))).toBe(false);
    expect(fs.existsSync(path.join(root, "client/src/pages/listing2/Listing2Products.tsx"))).toBe(false);
    expect(fs.existsSync(path.join(root, "client/src/pages/listing2/Listing2Workflow.tsx"))).toBe(false);
  });
});
