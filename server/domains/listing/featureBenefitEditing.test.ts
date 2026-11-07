import { expect, it } from "vitest";
import {
  emptyListingAggregation,
  listingAggregationSchema,
} from "../../../shared/listingAggregation";
import {
  moveGraphNode,
  removeGraphNode,
  editGraphNode,
} from "../../../shared/featureBenefitEditing";
const f = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222",
  l = "33333333-3333-4333-8333-333333333333";
const data = () => ({
  ...emptyListingAggregation(),
  features: [
    { id: f, text: "多尺码设计", note: "保留说明", group: "design" as const },
  ],
  selling: [{ id: b, text: "选码省心", note: "", group: "necessary" as const }],
  links: [{ id: l, featureId: f, benefitId: b, note: "支撑选码" }],
});
it("moves a feature between categories without losing its annotation or connections", () => {
  const original = data(),
    next = moveGraphNode(original, "feature", f, "information");
  expect(next.features?.[0]).toMatchObject({
    category: "information",
    note: "保留说明",
    manual: true,
  });
  expect(next.links).toEqual(original.links);
  expect(original.features[0].group).toBe("design");
});
it("removes only the deleted node and its own connections", () => {
  const next = removeGraphNode(data(), "feature", f);
  expect(next.features).toEqual([]);
  expect(next.selling).toHaveLength(1);
  expect(next.links).toEqual([]);
});
it("validates graph endpoints and rejects duplicate connections", () => {
  expect(() =>
    listingAggregationSchema.parse({
      ...data(),
      links: [...data().links, ...data().links],
    })
  ).toThrow("连线");
  expect(() =>
    listingAggregationSchema.parse({ ...data(), features: [] })
  ).toThrow("连线");
});
it("keeps evidence while editing only one side", () => {
  const original = data(),
    next = editGraphNode(original, "benefit", {
      ...original.selling[0],
      text: "尺寸选择方便",
      note: "用于购买决策",
    });
  expect(next.features).toEqual(original.features);
  expect(next.selling[0]).toMatchObject({
    text: "尺寸选择方便",
    note: "用于购买决策",
    manual: true,
  });
});

it("keeps removed concepts available to regeneration guards and rejects a shared left/right ID",()=>{const next=removeGraphNode(data(),"feature",f);expect(next.excludedConcepts).toMatchObject([{id:f,kind:"features",text:"多尺码设计"}]);expect(()=>listingAggregationSchema.parse({...data(),selling:[{...data().selling[0],id:f}],links:[]})).toThrow("节点重复");});
