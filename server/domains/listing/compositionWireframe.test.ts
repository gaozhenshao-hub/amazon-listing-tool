import { expect, it } from "vitest";
import { emptyImageDocument } from "../../../shared/imageDocument";
import { blankImageOutline } from "../../../shared/imagePlanning";
import {
  compositionSketchInput,
  compositionSketchPrompt,
} from "../../../shared/compositionSketch";
it("只向模型提供摆放线索，不透传场景细节、真实产品及完整营销文案", () => {
  const entry = emptyImageDocument(blankImageOutline()).entries[0];
  entry.layout = "一拖一";
  entry.layoutNote = "主1小孩在卧室熟睡，辅1下方30%长条展示静音电机";
  entry.content = "蓝色高质感水泵与温馨儿童房";
  entry.scenes[0].background = "粉色床单和玩具熊";
  entry.scenes[0].region = "上方70%";
  entry.copy.headline = "QUIET LIFE";
  entry.copy.headlinePosition = "左上";
  const prompt = compositionSketchPrompt(entry);
  expect(prompt).toContain("所有产品主体只用空心方块");
  expect(prompt).toContain("30%");
  expect(prompt).not.toContain("粉色床单");
  expect(prompt).not.toContain("QUIET LIFE");
  expect(prompt).not.toContain("蓝色高质感");
  expect(JSON.parse(compositionSketchInput(entry)).version).toBe(
    "abstract-wireframe-v3"
  );
});
