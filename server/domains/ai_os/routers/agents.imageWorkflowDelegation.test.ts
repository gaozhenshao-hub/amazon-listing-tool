import { describe, expect, it, vi } from "vitest";
import { delegateImageWorkflowSkillNode } from "./agents";

describe("皇帝画布图片步骤委派", () => {
  it("执行Step3技能节点时创建真实图片风格生成任务而非仅推进Agent节点", async () => {
    const startGeneration = vi.fn().mockResolvedValue({ runId: "image_step3_real_job", status: "queued" });
    const result = await delegateImageWorkflowSkillNode({
      runId: "agent_image_run",
      nodeId: "step3_skill",
      user: { id: 1, role: "super_admin" },
      workspaceId: 1,
      getRunDetail: vi.fn().mockResolvedValue({
        run: { agentSlug: "image.workflow", projectId: 90001, inputs: { projectId: 90001 } },
      }) as any,
      startGeneration: startGeneration as any,
    });

    expect(startGeneration).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 90001,
      step: 3,
      agentRunId: "agent_image_run",
      user: { id: 1, role: "super_admin" },
    }));
    expect(result).toMatchObject({ delegated: true, businessProcedure: "imageWorkflow.startStepGeneration", step: 3 });
  });

  it("非图片技能节点保持通用Agent执行路径", async () => {
    await expect(delegateImageWorkflowSkillNode({
      runId: "agent_listing_run",
      nodeId: "G3",
      user: { id: 1, role: "super_admin" },
    })).resolves.toBeNull();
  });
});
