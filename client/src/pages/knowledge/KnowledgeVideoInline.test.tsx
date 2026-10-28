// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,within} from "@testing-library/react";
vi.mock("@/lib/trpc",()=>({trpc:{kbVideos:{get:{useQuery:()=>({data:{id:8,video:{role:"aplus"},labels:{category:"宠物",style:"温馨家居风",primaryColor:"白色",accentColor:"橙色",type:"产品展示（侧重场景）",summary:"客厅中的使用场景",segments:[{label:"核心使用",start:1,end:4}]},labelStatus:"complete"}})}}}}));
vi.mock("./KnowledgeVideoPlayer",()=>({default:()=> <div data-testid="player">播放器</div>}));
vi.mock("./KnowledgeVideoDetail",()=>({default:({id}: {id:number})=> <div role="dialog">视频详情 {id}</div>}));
import KnowledgeVideoInline from "./KnowledgeVideoInline";
afterEach(cleanup);
it("keeps player continuity, moves summary below right tags, and opens existing video detail",()=>{
  render(<KnowledgeVideoInline id={8}/>);
  const aside=screen.getByRole("complementary");expect(within(aside).getByText("客厅中的使用场景")).toBeTruthy();
  expect(screen.queryByText("内容时间段")).toBeNull();expect(screen.queryByText("重新打标")).toBeNull();expect(screen.queryByText("用于改进")).toBeNull();
  expect(screen.getByTestId("player").parentElement!.querySelectorAll(":scope > *").length).toBe(2);
  fireEvent.click(screen.getByRole("button",{name:"标签与片段"}));expect(screen.getByRole("dialog").textContent).toContain("视频详情 8");
});
