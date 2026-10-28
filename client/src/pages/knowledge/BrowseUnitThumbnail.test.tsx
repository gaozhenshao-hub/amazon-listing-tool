// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,render,screen} from "@testing-library/react";
import {AmazonImageModuleSchema} from "@shared/amazonImageLayout";
import BrowseUnitThumbnail from "./BrowseUnitThumbnail";
import {SingleImagePreviewDialog} from "./SingleImagePreviewDialog";
vi.mock("./KnowledgeAssetActions",()=>({default:()=>null}));
afterEach(cleanup);
const module=AmazonImageModuleSchema.parse({id:"three",section:"aplus",kind:"grid",subtype:"三图文",cards:[1,2,3].map(i=>({images:[{hash:String(i).repeat(64),alt:`细节${i}`}],title:`特点${i}`,text:"实际说明"}))});
const images=[1,2,3].map(i=>({id:i,imagePosition:"aplus",imageUrl:`/full-${i}.jpg`,thumbnailUrl:`/thumb-${i}.jpg`,sourceUrlHash:String(i).repeat(64)}));
it("shows all module members in one browse card using lightweight previews",()=>{
  render(<BrowseUnitThumbnail image={{...images[0],module,moduleImages:images}}/>);
  expect(screen.getAllByRole("img")).toHaveLength(3);
  expect(screen.getByRole("img",{name:"细节3"}).getAttribute("src")).toBe("/thumb-3.jpg");
  expect(screen.getByText("三图文")).toBeTruthy();
});
it("opens the complete three-image module with a single shared tag panel",()=>{
  render(<SingleImagePreviewDialog image={{...images[0],module,moduleImages:images,tagComposition:"三分构图"}} onClose={vi.fn()}/>);
  expect(screen.getByText("完整 A+ 模块预览")).toBeTruthy();
  expect(screen.getAllByRole("img")).toHaveLength(3);
  expect(screen.getByText("特点3")).toBeTruthy();
  expect(screen.getAllByLabelText("图片标签").filter(element=>element.tagName==="ASIDE")).toHaveLength(1);
  expect(screen.getByText("三分构图")).toBeTruthy();
});
