import {describe,it,expect} from "vitest";
import {layoutWithoutDeletedImages} from "../../../shared/knowledgeAssetLayout";
import {AmazonImageModuleSchema} from "../../../shared/amazonImageLayout";
const hashes=["a","b","c"].map(c=>c.repeat(64));
const carousel=AmazonImageModuleSchema.parse({id:"navigation",section:"aplus",kind:"carousel",cards:hashes.map(hash=>({images:[{hash}]}))});
describe("deletion-aware A+ layout",()=>{
  it("removes only the selected carousel page and preserves the remaining order",()=>{
    const next=layoutWithoutDeletedImages({version:1,modules:[carousel]},[hashes[1]]);
    expect(next?.modules[0].cards.map(c=>c.images[0].hash)).toEqual([hashes[0],hashes[2]]);
  });
  it("removes a whole deleted module while leaving real acquisition gaps intact",()=>{
    const gap="d".repeat(64),module=AmazonImageModuleSchema.parse({...carousel,id:"missing",cards:[{images:[{hash:gap}]}]});
    const next=layoutWithoutDeletedImages({version:1,modules:[{...carousel,kind:"grid"},module]},hashes);
    expect(next?.modules.map(m=>m.id)).toEqual(["missing"]);expect(next?.modules[0].cards[0].images[0].hash).toBe(gap);
  });
  it("does not mutate the saved layout, allowing soft-deleted images to be restored",()=>{
    layoutWithoutDeletedImages({version:1,modules:[carousel]},hashes);expect(carousel.cards).toHaveLength(3);
  });
});
