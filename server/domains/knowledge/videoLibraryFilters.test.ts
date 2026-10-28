import {expect,it,vi} from "vitest";
import {MySqlDialect} from "drizzle-orm/mysql-core";
const calls=vi.hoisted(()=>({execute:vi.fn(async(_query:any)=>[[]])}));
vi.mock("../../repositories/dbClient",()=>({requireDb:async()=>({execute:calls.execute})}));
vi.mock("../../storage",()=>({resolveStoredObjectUrl:vi.fn()}));
vi.mock("./videoDelivery",()=>({knowledgeVideoStorageKey:vi.fn()}));
import {listLibraryVideos} from "./videoLibrary";
it("filters effective standalone/set colors and groups before applying the page limit",async()=>{
  await listLibraryVideos({userId:7,workspaceId:42},{scope:"shared",page:2,category:"餐厨",style:"温馨家居风",primaryColor:"白色",accentColor:"__none",groupBy:"type",content:"安装上手"});
  const q=new MySqlDialect().sqlToQuery(calls.execute.mock.calls[0][0]);
  expect(q.sql).toContain("v.workspaceId=?");expect(q.sql).toContain("IF(v.imageSetId IS NULL,JSON_UNQUOTE(JSON_EXTRACT");expect(q.sql).toContain("s.setAccentColor");
  expect(q.sql).toMatch(/ORDER BY .*LIMIT 25 OFFSET/s);expect(q.params).toContain("");expect(q.params).toContain("餐厨");expect(q.params.at(-1)).toBe(24);
});
