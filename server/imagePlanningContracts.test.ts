import { describe,it,expect } from "vitest";
import { AMAZON_MODULE_CATALOG as capturedTypes } from "../shared/amazonModuleCatalog";
import { AMAZON_MODULE_CATALOG as specs,CURRENT_IMAGE_BELONG_HIERARCHY,moduleSpec } from "../shared/imageModuleSpecs";
import { blankImageOutline,imageOutlineSchema,makeOutlineGroup,resizeOutlineGroup } from "../shared/imagePlanning";
import { imageBelongFromSource,normalizedImageBelong,validImageBelongSubtype } from "../shared/imageBelong";

describe("shared image planning and library specification",()=>{
  it("covers every captured official module, with exactly two classification levels",()=>{
    expect(new Set(specs.filter(s=>s.family!=="主图").map(s=>s.officialType))).toEqual(new Set(Object.keys(capturedTypes)));
    expect(Object.keys(CURRENT_IMAGE_BELONG_HIERARCHY)).toEqual(["主图","普通A+","高级A+","品牌故事"]);
    expect(CURRENT_IMAGE_BELONG_HIERARCHY["主图"]).toEqual(["主图","附图"]);
    expect(moduleSpec("高级A+","四列图片")).toMatchObject({width:300,height:225});
    expect(moduleSpec("普通A+","四图文")).toMatchObject({width:220,height:200});
  });
  it("keeps legacy ownership readable without assigning an A+ version",()=>{
    expect(normalizedImageBelong("套图",null)).toEqual({belong:"主图",sub:"附图"});
    expect(normalizedImageBelong("A+","图片轮播")).toEqual({belong:"A+",sub:"图片轮播"});
    expect(validImageBelongSubtype("普通A+","图片轮播")).toBeNull();
    expect(validImageBelongSubtype("高级A+","图片轮播")).toBe("图片轮播");
  });
  it("requires a captured module identity to distinguish Basic and Premium",()=>{
    const hash="a".repeat(64),layout={version:2,modules:[{id:"one",section:"aplus",kind:"grid",sourceType:"PREMIUM_FOUR_COLUMN_IMAGES",cards:[{images:[{hash}]}]}]};
    expect(imageBelongFromSource("aplus",layout,hash)).toEqual({belong:"高级A+",sub:"四列图片"});
    delete (layout.modules[0] as any).sourceType;
    expect(imageBelongFromSource("aplus",layout,hash)).toBeNull();
  });
  it("plans three alternatives of one main-image slot and seven subsequent images",()=>{
    const plan=blankImageOutline();expect(imageOutlineSchema.safeParse(plan).success).toBe(true);
    expect(plan.groups[0]).toMatchObject({family:"主图",moduleType:"主图"});expect(plan.groups[0].items).toHaveLength(3);expect(plan.groups[1].items).toHaveLength(7);
    expect(plan.groups.filter(g=>g.family==="高级A+")).toHaveLength(7);
  });
  it("expands a carousel and preserves existing content and reference links when resizing",()=>{
    const group=makeOutlineGroup("高级A+","图片轮播",4);group.items[0].content="袖口特写";group.items[0].references=[{setId:2,imageId:3}];
    const next=resizeOutlineGroup(group,"高级A+","图片轮播",5);expect(next.items).toHaveLength(5);expect(next.items[0]).toEqual(group.items[0]);expect(group.items).toHaveLength(4);
    const changed=resizeOutlineGroup(group,"高级A+","四列图片",4);expect(changed.items[0]).toMatchObject({content:"袖口特写",width:300,height:225,references:group.items[0].references});
  });
  it("does not manufacture images for FAQ or text, and rejects incoherent image counts",()=>{
    const plan=blankImageOutline(),faq=makeOutlineGroup("高级A+","常见问题");expect(faq.items).toHaveLength(1);expect(faq.items[0].width).toBe(0);
    plan.groups.push(faq);expect(imageOutlineSchema.safeParse(plan).success).toBe(true);
    plan.groups.push(makeOutlineGroup("普通A+","三图文",4));expect(imageOutlineSchema.safeParse(plan).success).toBe(false);
  });
  it("limits references to five sets and keeps individual references inside selected sets",()=>{
    const plan=blankImageOutline();plan.referenceSlots=5;plan.referenceSets=[1,2,3,4,5];expect(imageOutlineSchema.safeParse(plan).success).toBe(true);
    plan.groups[0].items[0].references=[{setId:9,imageId:10}];expect(imageOutlineSchema.safeParse(plan).success).toBe(false);
  });
});
