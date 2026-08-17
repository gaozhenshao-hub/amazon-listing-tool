import { describe, expect, it } from "vitest";
import { chooseStep4DisplayBase } from "./domains/image/routers/sessions";

const latestSceneSnapshot = {
  imageReferences: [{
    imageKey: "aplus-5.1",
    imageType: "A+模块 5.1",
    compositionReference: { layout: "展示车库环境中的蓝色气动管路" },
    effectReference: { atmosphere: "专业车库光线" },
  }],
};

describe("chooseStep4DisplayBase", () => {
  it("在Step2重新确认导致Step4原始字段为空时，仍使用最新成功任务的场景参考结果", () => {
    expect(chooseStep4DisplayBase({
      step4Confirmed: false,
      draftSnapshot: {},
      aiSnapshot: {},
      latestJobSnapshot: latestSceneSnapshot,
    })).toEqual(latestSceneSnapshot);
  });

  it("在解锁草稿包含用户本地资产时，以草稿为内容基准而不回退旧任务结果", () => {
    const draft = {
      imageReferences: [{
        ...latestSceneSnapshot.imageReferences[0],
        compositionRefNote: "参考背景色。",
      }],
    };
    expect(chooseStep4DisplayBase({
      step4Confirmed: false,
      draftSnapshot: draft,
      aiSnapshot: {},
      latestJobSnapshot: latestSceneSnapshot,
    })).toEqual(draft);
  });
});
