import {describe,it,expect} from "vitest";
import {imageTaggingUnits,sharedImageTags} from "../../../shared/imageTaggingUnits";
const hash=(n:number)=>String(n).repeat(64);
const images=[3,2,1,4].map(n=>({id:n,imagePosition:'aplus',sourceUrlHash:hash(n)}));
const layout={version:1,modules:[{id:'module',section:'aplus',kind:'grid',cards:[1,2,3].map(n=>({images:[{hash:hash(n),alt:''}]}))}]};
describe('module tagging units',()=>{
 it('keeps navigation carousel images independent in browsing, inference and label ownership',()=>{
   const carousel={...layout,modules:[{...layout.modules[0],kind:'carousel',subtype:'导航轮播'}]};
   const tagged=images.map(i=>({...i,tagComposition:`图${i.id}`}));
   const units=imageTaggingUnits(tagged,carousel);
   expect(units.map(u=>u.primary.id)).toEqual([1,2,3,4]);
   expect(units.every(u=>!u.module&&u.images.length===1)).toBe(true);
   expect(sharedImageTags(tagged,carousel).map(i=>[i.id,i.tagOwnerId,i.tagComposition])).toEqual(tagged.map(i=>[i.id,i.id,i.tagComposition]));
 });
 it('uses source order, not database insertion order, and retains unmatched images',()=>{
   const units=imageTaggingUnits([...images,{id:5,imagePosition:'brand_story'}],layout);
   expect(units.map(u=>u.primary.id)).toEqual([1,4]);expect(units[0].images.map(i=>i.id)).toEqual([1,2,3]);
 });
 it('does not tag a partial module as a complete image',()=>{
   const units=imageTaggingUnits(images.filter(i=>i.id!==1),layout);
   expect(units[0].complete).toBe(false);
 });
 it('does not merge separate modules just because they share a subtype',()=>{
   const units=imageTaggingUnits(images,{...layout,modules:[layout.modules[0],{...layout.modules[0],id:'other',cards:[{images:[{hash:hash(4)}]}]}]});
   expect(units.map(u=>u.primary.id)).toEqual([1,4]);
 });
});


describe('shared module labels',()=>{
 it('all members read the first image tags while their original image identity stays unchanged',()=>{
  const originals=images.map(i=>({...i,imageUrl:`image-${i.id}`,tagComposition:i.id===1?'三分构图':'旧标签'}));
  const result=sharedImageTags(originals,layout);
  expect(result.filter(i=>i.id!==4).map(i=>i.tagComposition)).toEqual(['三分构图','三分构图','三分构图']);
  expect(result.map(i=>i.imageUrl)).toEqual(originals.map(i=>i.imageUrl));
  expect(result.find(i=>i.id===4)?.tagOwnerId).toBe(4);
  expect(originals[0].tagComposition).toBe('旧标签');
 });
 it('does not display stale member tags when the first image is absent',()=>{
  const result=sharedImageTags(images.filter(i=>i.id!==1).map(i=>({...i,tagComposition:'旧标签'})),layout);
  expect(result.filter(i=>i.id!==4).every(i=>i.tagOwnerId===null && i.tagComposition===null)).toBe(true);
 });
});
