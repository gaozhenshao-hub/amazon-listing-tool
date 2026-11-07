import { describe, expect, it } from 'vitest';
import { competitorRichSlots } from './competitorLayout';

describe('competitor comparison layout',()=>{
 it('preserves A+ module order and keeps unmatched legacy images',()=>{
  const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64);
  const module=(id:string,hash:string)=>({id,section:'aplus',kind:'image',title:'',background:null,cards:[{images:[{hash,alt:''}],title:'',text:''}],rows:[]});
  const assets=[a,b,c].map(hash=>({role:'aplus',url:hash,sourceUrlHash:hash}));
  const slots=competitorRichSlots({version:1,modules:[module('second',b),module('first',a)]},assets,'aplus');
  expect(slots.map(s=>s.assets[0]?.sourceUrlHash)).toEqual([b,a,c]);
  expect(slots.map(s=>s.module?.id||null)).toEqual(['second','first',null]);
 });
 it('keeps older brand story images in one horizontal strip',()=>{
  const slots=competitorRichSlots(null,[{role:'brand_story',url:'one'},{role:'brand_story',url:'two'}],'brand_story');
  expect(slots).toHaveLength(1);expect(slots[0].assets).toHaveLength(2);
 });
});
