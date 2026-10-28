// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { defaultDesignParams, DESIGN_BANANA_MODEL } from "@shared/designStudio";
import { DesignParameters, DesignPlanEditor } from "./DesignPlanEditor";

afterEach(cleanup);

it("keeps quantity when switching image models in the composer controls", () => {
  function Composer() {
    const [params, setParams] = useState(defaultDesignParams);
    return (
      <DesignParameters params={params} onChange={setParams} disabled={false} />
    );
  }
  render(<Composer />);
  fireEvent.change(screen.getByRole("combobox", { name: "生成数量" }), {
    target: { value: "8" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "生图模型" }), {
    target: { value: DESIGN_BANANA_MODEL },
  });
  expect(
    (screen.getByRole("combobox", { name: "生成数量" }) as HTMLSelectElement)
      .value
  ).toBe("8");
});

it("submits the edited quantity from the confirmation card without losing the prompt", () => {
  const onConfirm = vi.fn();
  render(
    <DesignPlanEditor
      initial={{
        prompt: "保持产品结构，生成白底图",
        params: defaultDesignParams,
        references: [],
      }}
      disabled={false}
      uploading={false}
      upload={vi.fn()}
      onConfirm={onConfirm}
      onPreview={vi.fn()}
    />
  );
  fireEvent.change(screen.getByRole("combobox", { name: "方案生成数量" }), {
    target: { value: "4" },
  });
  fireEvent.click(screen.getByRole("button", { name: "确认并生成 4 张" }));
  expect(onConfirm).toHaveBeenCalledWith({
    prompt: "保持产品结构，生成白底图",
    params: { ...defaultDesignParams, count: "4" },
    references: [],
  });
});

it("shows Chinese translation and hides it when the English prompt is edited", () => {
  const confirm = vi.fn();
  render(
    <DesignPlanEditor
      initial={{
        prompt: "Keep the product shape.",
        params: defaultDesignParams,
        references: [],
      }}
      promptTranslation="保持产品形状。"
      disabled={false}
      uploading={false}
      upload={vi.fn()}
      onConfirm={confirm}
      onPreview={vi.fn()}
    />
  );
  expect(screen.getByText("保持产品形状。")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "确认并生成 1 张" }));
  expect(confirm.mock.calls[0][0].prompt).toBe("Keep the product shape.");
  fireEvent.change(screen.getByRole("textbox", { name: "方案生图提示词" }), {
    target: { value: "Change the shape." },
  });
  expect(screen.queryByText("保持产品形状。")).toBeNull();
  expect(screen.getByText(/原翻译不再对应/)).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "方案生图提示词" }), {
    target: { value: "Keep the product shape." },
  });
  expect(screen.getByText("保持产品形状。")).toBeTruthy();
});
