// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ImageTagsPanel from "./ImageTagsPanel";
const calls=vi.hoisted(()=>({save:vi.fn(async()=>({success:true})),invalidate:vi.fn(async()=>{})}));
vi.mock("@/lib/trpc",()=>({trpc:{
  useUtils:()=>({kbImages:{getSet:{invalidate:calls.invalidate},listSets:{invalidate:calls.invalidate},listAllImages:{invalidate:calls.invalidate}}}),
  kbImages:{saveStandaloneTags:{useMutation:()=>({mutateAsync:calls.save})},confirmImageTags:{useMutation:()=>({mutateAsync:calls.save})}},
}}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const image={id:7,imagePosition:"aplus",tagComposition:"二分构图",tagDesignStyleV2:"大厂工业极简风"};
it("shows tags without an editable permission",()=>{
  render(<ImageTagsPanel image={image}/>);
  expect(screen.getByText("二分构图")).toBeTruthy();
  expect(screen.queryByRole("button",{name:"编辑"})).toBeNull();
});
it("edits a draft and saves it only on confirmation",async()=>{
  render(<ImageTagsPanel image={image} canEdit/>);
  fireEvent.click(screen.getByRole("button",{name:"编辑"}));
  fireEvent.change(screen.getByRole("combobox",{name:"构图"}),{target:{value:"三分构图"}});
  expect(calls.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"保存标签"}));
  await waitFor(()=>expect(calls.save).toHaveBeenCalledWith(expect.objectContaining({imageId:7,tagComposition:"三分构图"})));
});
it("shows only structural labels for brand stories",()=>{
  render(<ImageTagsPanel image={{...image,imagePosition:"brand_story",tagImageBelongSub:"四图组合"}}/>);
  expect(screen.getByText("四图组合")).toBeTruthy();
  expect(screen.queryByText("构图")).toBeNull();
});
it("never shows internal position codes as subtype options",()=>{
  render(<ImageTagsPanel image={{...image,tagImageBelong:"A+",tagImageBelongSub:"a_plus"}} canEdit/>);
  expect(screen.queryByText("a_plus")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"编辑"}));
  expect(screen.getByRole("option",{name:"图片轮播"})).toBeTruthy();
  expect(screen.queryByRole("option",{name:"a_plus"})).toBeNull();
});

it("edits independent labels without changing an ASIN set",async()=>{
  render(<ImageTagsPanel image={{...image,imageSetId:null,labelRevision:3}} canEdit/>);
  fireEvent.click(screen.getByRole("button",{name:"编辑"}));
  fireEvent.change(screen.getByRole("combobox",{name:"类目"}),{target:{value:"宠物"}});
  fireEvent.click(screen.getByRole("button",{name:"保存标签"}));
  await waitFor(()=>expect(calls.save).toHaveBeenCalledWith({id:7,revision:3,tags:{tagCategory:"宠物"}}));
});
