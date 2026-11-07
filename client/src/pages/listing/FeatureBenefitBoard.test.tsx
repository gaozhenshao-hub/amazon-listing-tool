// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import FeatureBenefitBoard from "./FeatureBenefitBoard";
import {
  emptyListingAggregation,
  type ListingAggregation,
} from "@shared/listingAggregation";
afterEach(cleanup);
const f = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
const initial: ListingAggregation = {
  ...emptyListingAggregation(),
  features: [
    { id: f, text: "六组尺码", note: "覆盖不同体型", group: "design" },
  ],
  selling: [
    { id: b, text: "选码省心", note: "方便找到适合尺码", group: "necessary" },
  ],
  links: [],
};
function Harness({
  changed = vi.fn(),
  evidence = vi.fn(),
}: {
  changed?: (data: ListingAggregation) => void;
  evidence?: (...args: any[]) => void;
}) {
  const [data, setData] = useState(initial);
  return (
    <FeatureBenefitBoard
      data={data}
      onChange={next => {
        setData(next);
        changed(next);
      }}
      onEvidence={evidence}
    />
  );
}
it("creates a real connection and edits its detailed explanation", () => {
  const changed = vi.fn();
  render(<Harness changed={changed} />);
  fireEvent.click(screen.getByRole("button", { name: "连接功能：六组尺码" }));
  fireEvent.click(screen.getByRole("button", { name: "连接卖点：选码省心" }));
  expect(changed.mock.lastCall![0].links).toEqual([
    expect.objectContaining({ featureId: f, benefitId: b, manual: true }),
  ]);
  fireEvent.click(
    screen.getByRole("button", { name: "编辑连线：六组尺码 → 选码省心" })
  );
  fireEvent.change(screen.getByLabelText("关联说明"), {
    target: { value: "多种尺码支撑选码" },
  });
  fireEvent.click(screen.getByRole("button", { name: "应用关联" }));
  expect(changed.mock.lastCall![0].links[0].note).toBe("多种尺码支撑选码");
});
it("opens node annotations without changing the other column", () => {
  const changed = vi.fn();
  render(<Harness changed={changed} />);
  fireEvent.click(screen.getByRole("button", { name: "标注：六组尺码" }));
  fireEvent.change(screen.getByLabelText("详细标注"), {
    target: { value: "本品提供六组尺码，并配测量说明" },
  });
  fireEvent.click(screen.getByRole("button", { name: "应用修改" }));
  expect(changed.mock.lastCall![0].features[0].note).toContain("测量说明");
  expect(changed.mock.lastCall![0].selling).toEqual(initial.selling);
});
it("exposes original source lookup from a node", () => {
  const evidence = vi.fn();
  render(<Harness evidence={evidence} />);
  fireEvent.click(screen.getByRole("button", { name: "查看证据：选码省心" }));
  expect(evidence).toHaveBeenCalledWith(
    "benefit",
    expect.objectContaining({ id: b })
  );
});

it("moves a node with pointer dragging while keeping both columns and links intact",()=>{const changed=vi.fn();const {container}=render(<Harness changed={changed}/>);const source=container.querySelector('[data-node-id="'+f+'"]')!,destination=container.querySelector('[data-group="information"][data-side="feature"]')!;const previous=document.elementFromPoint;document.elementFromPoint=()=>destination;try{fireEvent(source,new MouseEvent("pointerdown",{bubbles:true,button:0,clientX:100,clientY:100}));fireEvent(source,new MouseEvent("pointermove",{bubbles:true,button:0,clientX:130,clientY:300}));fireEvent(source,new MouseEvent("pointerup",{bubbles:true,button:0,clientX:130,clientY:300}));expect(changed.mock.lastCall![0].features[0]).toMatchObject({id:f,category:"information",manual:true});expect(changed.mock.lastCall![0].selling).toEqual(initial.selling);expect(changed.mock.lastCall![0].links).toEqual([]);}finally{document.elementFromPoint=previous;}});
