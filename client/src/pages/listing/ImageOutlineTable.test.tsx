// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { afterEach,it,expect,vi } from "vitest";
import { cleanup,render,screen,fireEvent } from "@testing-library/react";
import { emptyImageOutline,makeOutlineGroup,type ImageOutline } from "@shared/imagePlanning";
import { emptyListingAggregation } from "@shared/listingAggregation";
import ImageOutlineTable from "./ImageOutlineTable";
afterEach(cleanup);
const fid="11111111-1111-4111-8111-111111111111",bid="22222222-2222-4222-8222-222222222222";
it("keeps picture content in one column and associates existing features and benefits independently",()=>{
  const upstream={...emptyListingAggregation(),features:[{id:fid,text:"宽松紧带袖口",note:"原有功能说明",group:"detail" as const}],selling:[{id:bid,text:"手腕舒适",note:"原有获益说明",group:"secondary" as const}]};
  const changed=vi.fn(),initial={...emptyImageOutline(),groups:[makeOutlineGroup("主图","附图")]};
  function Host(){const [data,setData]=useState(initial);return <ImageOutlineTable data={data} upstream={upstream} onChange={d=>{changed(d);setData(d);}}/>;}
  render(<Host/>);expect(screen.getAllByRole("columnheader")).toHaveLength(6);
  fireEvent.change(screen.getByRole("textbox",{name:"图片1-1内容"}),{target:{value:"袖口特写，画面展示宽松紧带与魔术贴"}});
  fireEvent.click(screen.getByRole("button",{name:"编辑关联"}));
  fireEvent.click(screen.getByRole("checkbox",{name:/宽松紧带袖口/}));
  let last=changed.mock.calls.at(-1)![0] as ImageOutline;expect(last.groups[0].items[0].featureIds).toEqual([fid]);expect(last.groups[0].items[0].benefitIds).toEqual([]);
  fireEvent.click(screen.getByRole("checkbox",{name:/手腕舒适/}));last=changed.mock.calls.at(-1)![0];expect(last.groups[0].items[0]).toMatchObject({content:"袖口特写，画面展示宽松紧带与魔术贴",featureIds:[fid],benefitIds:[bid]});
});
it("routes AI editing to the selected carousel image only",()=>{
  const group=makeOutlineGroup("高级A+","图片轮播",4),adjust=vi.fn();
  render(<ImageOutlineTable data={{...emptyImageOutline(),groups:[group]}} upstream={emptyListingAggregation()} onChange={()=>{}} onAdjust={adjust}/>);
  fireEvent.click(screen.getAllByRole("button",{name:"调整结果（AI）"})[2]);
  expect(adjust).toHaveBeenCalledWith({groupId:group.id,itemId:group.items[2].id});
});
it("numbers the three main-image alternatives across separate groups",()=>{
  const groups=Array.from({length:3},()=>makeOutlineGroup("主图","主图",1));
  render(<ImageOutlineTable data={{...emptyImageOutline(),groups}} upstream={emptyListingAggregation()} onChange={()=>{}} readOnly/>);
  for(const label of ["主图方案1","主图方案2","主图方案3"])expect(screen.getByText(label)).toBeInTheDocument();
});
it("shows one merged buyer question for several old references and removes all aliases when unchecked",()=>{
 const first="33333333-3333-4333-8333-333333333333",second="44444444-4444-4444-8444-444444444444";
 const group=makeOutlineGroup("主图","附图",1);group.items[0].questionIds=[first,second];
 const upstream={...emptyListingAggregation(),questions:[{id:first,text:"尺码是否合适，如何选码？",note:"",answer:"对照六组尺码说明选择。",source:"inferred" as const,mergedQuestionIds:[second]}]};
 const changed=vi.fn();render(<ImageOutlineTable data={{...emptyImageOutline(),groups:[group]}} upstream={upstream} onChange={changed}/>);
 expect(screen.getAllByText("尺码是否合适，如何选码？")).toHaveLength(1);
 fireEvent.click(screen.getByRole("button",{name:"编辑关联"}));
 const checkbox=screen.getByRole("checkbox",{name:/尺码是否合适/});expect(checkbox).toBeChecked();fireEvent.click(checkbox);
 expect(changed.mock.calls.at(-1)![0].groups[0].items[0].questionIds).toEqual([]);
});
