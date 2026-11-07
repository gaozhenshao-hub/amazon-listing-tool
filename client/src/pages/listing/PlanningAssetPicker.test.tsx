// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach,it,expect,vi } from "vitest";
import { cleanup,render,screen,fireEvent } from "@testing-library/react";
const f=vi.hoisted(()=>({confirm:vi.fn(),close:vi.fn(),sets:[{id:1,asin:"B000000001",productTitle:"第一套",status:"confirmed"},{id:2,asin:"B000000002",productTitle:"第二套",status:"confirmed"},{id:3,asin:"B000000003",productTitle:"第三套",status:"confirmed"}]}));
vi.mock("@/hooks/useKBTagOptions",()=>({useKBTagOptions:()=>({styleOptions:[],categoryOptions:[],colorOptions:[]})}));
vi.mock("../knowledge/AmazonStyleGallery",()=>({AmazonStyleGallery:()=> <p>原始套图排版</p>}));
vi.mock("@/lib/trpc",()=>({trpc:{kbImages:{listSets:{useQuery:()=>({data:f.sets})},setThumbnails:{useQuery:()=>({data:[]})},getSet:{useQuery:({id}:any)=>({data:{...f.sets.find(s=>s.id===id),images:[{id:10+id,imageUrl:"https://example.com/p.jpg",imagePosition:"main"}]}})},listAllImages:{useQuery:()=>({data:[{id:20,imageUrl:"https://example.com/standalone.jpg",originalFilename:"单图素材",moduleImages:[]}]})}},imagePlanning:{competitorImages:{useQuery:()=>({data:[{analysisId:5,hash:"a".repeat(64),imageUrl:"https://example.com/c.jpg",asin:"B000000009",role:"main",liked:true}]})}}}}));
import PlanningAssetPicker from "./PlanningAssetPicker";
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("暂存勾选，切换套图内部标签仍同步，点击确认才应用",()=>{
 render(<PlanningAssetPicker mode="sets" onClose={f.close} onConfirm={f.confirm}/>);
 fireEvent.click(screen.getByRole("checkbox",{name:"选择套图B000000001"}));expect(f.confirm).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:/B000000001 第一套/}));
 expect(screen.getByText("原始套图排版")).toBeInTheDocument();expect(screen.getByRole("checkbox",{name:"选择套图B000000001"})).toBeChecked();
 fireEvent.click(screen.getByRole("checkbox",{name:"选择套图B000000001"}));fireEvent.click(screen.getByRole("button",{name:"资料列表"}));expect(screen.getByRole("checkbox",{name:"选择套图B000000001"})).not.toBeChecked();
 fireEvent.click(screen.getByRole("checkbox",{name:"选择套图B000000002"}));fireEvent.click(screen.getByRole("button",{name:"确认"}));expect(f.confirm).toHaveBeenCalledWith({setIds:[2],images:[]});
});
it("取消丢弃临时选择，并限制套数",()=>{
 render(<PlanningAssetPicker mode="sets" maxSelections={2} selectedSetIds={[1]} onClose={f.close} onConfirm={f.confirm}/>);
 fireEvent.click(screen.getByRole("checkbox",{name:"选择套图B000000002"}));fireEvent.click(screen.getByRole("checkbox",{name:"选择套图B000000003"}));expect(screen.getByRole("checkbox",{name:"选择套图B000000003"})).not.toBeChecked();
 fireEvent.click(screen.getByRole("button",{name:"取消"}));expect(f.close).toHaveBeenCalledOnce();expect(f.confirm).not.toHaveBeenCalled();
});
it("参考图库仅显示已选套图，知识库允许无ASIN单图",()=>{
 render(<PlanningAssetPicker mode="images" projectId={1} referenceSetIds={[2]} onClose={f.close} onConfirm={f.confirm}/>);
 fireEvent.click(screen.getByRole("button",{name:"参考图库"}));expect(screen.getByRole("button",{name:/B000000002 第二套/})).toBeInTheDocument();expect(screen.queryByRole("button",{name:/B000000001 第一套/})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"知识库"}));fireEvent.click(screen.getByRole("button",{name:"全部单图"}));fireEvent.click(screen.getByRole("checkbox",{name:"选择单图素材"}));fireEvent.click(screen.getByRole("button",{name:"确认"}));expect(f.confirm.mock.calls[0][0].images).toEqual([{source:"knowledge",imageId:20,label:"单图素材"}]);
});
it("竞品图片在同一选图器中可选择，显示亮灯标记",()=>{
 render(<PlanningAssetPicker mode="images" projectId={1} onClose={f.close} onConfirm={f.confirm}/>);fireEvent.click(screen.getByRole("button",{name:"竞品库"}));expect(screen.getByTitle("已亮灯收藏")).toBeInTheDocument();fireEvent.click(screen.getByRole("checkbox",{name:"选择B000000009 · 主图"}));fireEvent.click(screen.getByRole("button",{name:"确认"}));expect(f.confirm.mock.calls[0][0].images[0]).toMatchObject({source:"competitor",analysisId:5,hash:"a".repeat(64)});
});
