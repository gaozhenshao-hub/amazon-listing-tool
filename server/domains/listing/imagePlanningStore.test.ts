vi.mock("./researchLocks",()=>({assertResearchEditable:vi.fn()}));
import { afterEach,beforeEach,it,expect,vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { blankImageOutline,emptyImageOutline,makeOutlineGroup } from "../../../shared/imagePlanning";
import { assertResearchEditable } from "./researchLocks";
const f=vi.hoisted(()=>({revision:0,data:null as unknown,writes:0}));
const dialect=new MySqlDialect();
vi.mock("../../repositories/dbClient",()=>({requireDb:async()=>{
 const db={execute:async(q:any)=>{
  const {sql,params}=dialect.sqlToQuery(q);
  if(sql.startsWith("SELECT * FROM projects"))return [params[0]===11&&params[1]===3&&params[2]===7?[{id:11}]:[]];
  if(sql.startsWith("SELECT data,revision,job_run_id"))return [f.revision?[{data:f.data,revision:f.revision,job_run_id:null}]:[]];
  if(sql.startsWith("SELECT id FROM listing_image_plan_candidates"))return [[]];
  if(sql.startsWith("INSERT INTO listing_image_plans")){f.data=JSON.parse(params[2] as string);f.revision=1;f.writes++;return [{affectedRows:1}];}
  if(sql.startsWith("UPDATE listing_image_plans")){f.data=JSON.parse(params[0] as string);f.revision++;f.writes++;return [{affectedRows:1}];}
  throw new Error(sql);
}};return {...db,transaction:async(fn:any)=>fn(db)};
}}));
import { readImagePlan,saveImagePlan } from "./imagePlanningStore";
const scope={projectId:11,workspaceId:3,userId:7};
beforeEach(()=>{f.revision=0;f.data=null;f.writes=0;vi.mocked(assertResearchEditable).mockReset();});
afterEach(()=>vi.useRealTimers());
it("does not overwrite another editor's saved version",async()=>{
  const first=await saveImagePlan(scope,0,blankImageOutline());expect(first.revision).toBe(1);
  await expect(saveImagePlan(scope,0,emptyImageOutline())).rejects.toThrow("其他操作修改");expect(f.writes).toBe(1);expect((f.data as any).groups.length).toBeGreaterThan(0);
});
it("checks both workspace and owner before any image-plan write",async()=>{
  await expect(saveImagePlan({...scope,workspaceId:99},0,emptyImageOutline())).rejects.toThrow("项目不可访问");
  await expect(saveImagePlan({...scope,userId:88},0,emptyImageOutline())).rejects.toThrow("项目不可访问");expect(f.writes).toBe(0);
});

function existingPlan(legacy=false){
  const group=makeOutlineGroup("主图","附图",1);
  group.items[0].content="保留人工调整的6个口袋画面";
  if(!legacy){group.items[0].manualFields=["content"];group.items[0].manualChangedAt="2026-11-01T00:00:00.000Z";}
  f.data={...emptyImageOutline(),groups:[group],...(!legacy?{manualTrackingVersion:1}: {})};f.revision=3;
}
function lockPages(...pages:string[]){
  vi.mocked(assertResearchEditable).mockImplementation(async(_scope,page)=>{
    if((Array.isArray(page)?page:[page]).some(p=>pages.includes(p)))throw new Error("此页面已锁定，请先点击编辑解锁");
  });
}
it("saves references with the outline locked even when legacy manual timestamps change between reads",async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-03T06:00:00Z"));existingPlan(true);lockPages("outline");
  const {data}=await readImagePlan(scope);
  data.referenceSets=[41];data.groups[0].items[0].references=[{setId:41,imageId:72}];
  vi.setSystemTime(new Date("2026-11-03T06:01:00Z"));
  const validateOutline=vi.fn();
  const saved=await saveImagePlan(scope,3,data,undefined,{validateOutline});
  expect(saved.revision).toBe(4);expect(saved.data.referenceSets).toEqual([41]);
  expect(saved.data.groups[0].items[0]).toMatchObject({content:"保留人工调整的6个口袋画面",manualFields:expect.arrayContaining(["content"]),references:[{setId:41,imageId:72}]});
  expect(vi.mocked(assertResearchEditable).mock.calls.map(c=>c[1])).toEqual(["references"]);
  expect(validateOutline).not.toHaveBeenCalled();
});
it("keeps stored manual protections and upstream links on a reference-only save",async()=>{
  existingPlan();lockPages("outline");
  const {data}=await readImagePlan(scope);
  data.groups[0].items[0].manualFields=[];data.groups[0].items[0].manualChangedAt="stale-client-metadata";data.referenceSets=[41];
  const saved=await saveImagePlan(scope,3,data,undefined,{validateOutline:()=>{throw new Error("References must not rewrite upstream links");}});
  expect(saved.data.groups[0].items[0]).toMatchObject({manualFields:["content"],manualChangedAt:"2026-11-01T00:00:00.000Z"});
});
it("still rejects real outline changes and reference changes when their respective page is locked",async()=>{
  existingPlan();const {data}=await readImagePlan(scope);lockPages("outline");
  const edit=structuredClone(data);edit.groups[0].items[0].content="不能覆盖锁定的画面";
  await expect(saveImagePlan(scope,3,edit)).rejects.toThrow("此页面已锁定");
  const sync=structuredClone(data);sync.sourceRevision++;
  await expect(saveImagePlan(scope,3,sync)).rejects.toThrow("此页面已锁定");
  lockPages("references");data.referenceSets=[41];
  await expect(saveImagePlan(scope,3,data)).rejects.toThrow("此页面已锁定");expect(f.writes).toBe(0);
});
it("validates outline edits without requiring reference unlock for empty new image slots",async()=>{
  existingPlan();lockPages("references");const {data}=await readImagePlan(scope);
  data.groups.push(makeOutlineGroup("主图","附图",1));
  const validateOutline=vi.fn();await saveImagePlan(scope,3,data,undefined,{validateOutline});
  expect(validateOutline).toHaveBeenCalledOnce();expect(vi.mocked(assertResearchEditable).mock.calls.map(c=>c[1])).toEqual(["outline"]);
});
it("requires reference unlock when an outline edit would remove an associated reference",async()=>{
  existingPlan();const stored=f.data as ReturnType<typeof emptyImageOutline>;stored.referenceSets=[41];stored.groups[0].items[0].references=[{setId:41,imageId:72}];
  lockPages("references");const {data}=await readImagePlan(scope);data.groups=[];
  await expect(saveImagePlan(scope,3,data)).rejects.toThrow("此页面已锁定");expect(f.writes).toBe(0);
});
