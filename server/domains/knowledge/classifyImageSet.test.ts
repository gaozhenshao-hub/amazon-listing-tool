import {beforeEach,expect,it,vi} from "vitest";
import {MySqlDialect} from "drizzle-orm/mysql-core";
import {IMAGE_TAGGING_OPTIONS} from "../../../shared/imageTagging";
const mocks=vi.hoisted(()=>({execute:vi.fn(),preview:vi.fn()}));
vi.mock("../../repositories/dbClient",()=>({requireDb:async()=>({execute:mocks.execute})}));
vi.mock("./taggingUnitPreview",()=>({taggingUnitPreview:mocks.preview}));
vi.mock("sharp",()=>({default:()=>{const chain={resize:()=>chain,jpeg:()=>chain,composite:()=>chain,toBuffer:async()=>Buffer.from("preview")};return chain;}}));
vi.mock("./tagImprovements",()=>({taggingImprovements:async()=>""}));
import {classifyImageSet} from "./classifyImageSet";
const candidate={setCategory:IMAGE_TAGGING_OPTIONS.categories[0],setStyle:IMAGE_TAGGING_OPTIONS.styles[0],setPrimaryColor:"白色",setAccentColor:"橙色",evidence:"整体白底配橙色卖点标题"};
const base={asin:"B012345678",productTitle:"Product",sourceLayout:null,setCategory:null,setStyle:null,setPrimaryColor:null,setAccentColor:null};
const scope={workspaceId:1,userId:2,imageSetId:3};
beforeEach(()=>{vi.clearAllMocks();mocks.preview.mockResolvedValue(Buffer.from("image"));mocks.execute.mockResolvedValue([{affectedRows:1}]);});
it("analyses every image together once and persists only set labels",async()=>{
  const images=Array.from({length:23},(_,i)=>({...base,id:i+1,imageUrl:`stored/${i}`,imagePosition:i<20?"aplus":"brand_story"}));
  const run=vi.fn(async()=>({content:JSON.stringify(candidate)}));
  await classifyImageSet(scope,images,{signal:new AbortController().signal,readImages:async()=>images,run});
  expect(mocks.preview).toHaveBeenCalledTimes(23);expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0][1]).toHaveLength(4);
  const statement=new MySqlDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
  expect(statement.sql).toContain("UPDATE kb_image_sets");expect(statement.sql).not.toContain("UPDATE kb_images");
  expect(statement.params).toContain("橙色");expect(statement.sql).toContain("userId");
});
it("preserves manual set labels completed while the model runs",async()=>{
  const images=[{...base,id:1,imageUrl:"stored/1",imagePosition:"main"}];let reads=0;
  await classifyImageSet(scope,images,{signal:new AbortController().signal,readImages:async()=>++reads<=2?images:images.map(i=>({...i,...candidate})),run:async()=>({content:JSON.stringify(candidate)})});
  expect(mocks.execute).not.toHaveBeenCalled();
});
it("does not apply a result to changed images",async()=>{
  const images=[{...base,id:1,imageUrl:"stored/1",imagePosition:"main"}];let reads=0;
  await expect(classifyImageSet(scope,images,{signal:new AbortController().signal,readImages:async()=>++reads<=2?images:[{...images[0],imageUrl:"replacement"}],run:async()=>({content:JSON.stringify(candidate)})})).rejects.toThrow("已变化");
  expect(mocks.execute).not.toHaveBeenCalled();
});

it("retries a received malformed set answer once",async()=>{
 const images=[{...base,id:1,imageUrl:"stored/1",imagePosition:"main"}];
 const run=vi.fn().mockResolvedValueOnce({content:"Let me explain..."}).mockResolvedValueOnce({content:JSON.stringify(candidate)});
 await classifyImageSet(scope,images,{signal:new AbortController().signal,readImages:async()=>images,run});
 expect(run).toHaveBeenCalledTimes(2);expect(mocks.execute).toHaveBeenCalledTimes(1);
});
it("does not retry unknown network outcomes",async()=>{
 const images=[{...base,id:1,imageUrl:"stored/1",imagePosition:"main"}],run=vi.fn().mockRejectedValue(new Error("network"));
 await expect(classifyImageSet(scope,images,{signal:new AbortController().signal,readImages:async()=>images,run})).rejects.toThrow("network");
 expect(run).toHaveBeenCalledTimes(1);expect(mocks.execute).not.toHaveBeenCalled();
});
it("stops after two malformed answers without writing tags",async()=>{
 const images=[{...base,id:1,imageUrl:"stored/1",imagePosition:"main"}],run=vi.fn().mockResolvedValue({content:"not json"});
 await expect(classifyImageSet(scope,images,{signal:new AbortController().signal,readImages:async()=>images,run})).rejects.toThrow("两次");
 expect(run).toHaveBeenCalledTimes(2);expect(mocks.execute).not.toHaveBeenCalled();
});
it("retags only common fields and preserves a concurrent human edit during an explicit rollout",async()=>{
 const images=[{...base,...candidate,id:1,imageUrl:"stored/1",imagePosition:"main"}];
 const options={force:true,signal:new AbortController().signal,readImages:async()=>images,run:async()=>({content:JSON.stringify({...candidate,setPrimaryColor:"黑色"})})};
 await classifyImageSet(scope,images,options);
 const q=new MySqlDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
 expect(q.params).toContain("黑色");expect(q.sql).not.toContain("UPDATE kb_images");
 mocks.execute.mockClear();let read=0;
 await expect(classifyImageSet(scope,images,{...options,readImages:async()=>++read<=2?images:images.map(i=>({...i,setPrimaryColor:"蓝色"}))})).rejects.toThrow("未覆盖人工编辑");
 expect(mocks.execute).not.toHaveBeenCalled();
});
