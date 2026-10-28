import {expect,it} from "vitest";
import {hasCompleteSetTags,inheritSetImageTags} from "../../../shared/imageSetTags";
it("all images inherit exactly the four ASIN labels without changing their own composition",()=>{
  const set={setCategory:"宠物",setStyle:"温馨家居风",setPrimaryColor:"浅棕",setAccentColor:""};
  expect(hasCompleteSetTags(set)).toBe(true);
  expect(hasCompleteSetTags({...set,setAccentColor:null})).toBe(false);
  for(const imagePosition of ["main","secondary","aplus","brand_story"]) {
    const image=inheritSetImageTags({id:1,imagePosition,tagCategory:"wrong",tagDesignStyleV2:"wrong",tagColorSchemeV2:"黑色",tagComposition:"一拖二"},set);
    expect(image).toMatchObject({tagCategory:"宠物",tagDesignStyleV2:"温馨家居风",tagColorSchemeV2:"浅棕",tagAccentColor:"",tagComposition:"一拖二"});
    expect(inheritSetImageTags(image,{...set,setStyle:"自然清新风"}).tagDesignStyleV2).toBe("自然清新风");
  }
});
