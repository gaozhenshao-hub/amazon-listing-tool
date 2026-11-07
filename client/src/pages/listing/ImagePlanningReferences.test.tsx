// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { afterEach,it,expect,vi } from "vitest";
import { cleanup,render,screen,fireEvent } from "@testing-library/react";
import { emptyImageOutline } from "@shared/imagePlanning";
const f=vi.hoisted(()=>({collect:vi.fn(),change:vi.fn()}));
vi.mock("@/lib/trpc",()=>({trpc:{kbImages:{listSets:{useQuery:()=>({data:[{id:3,asin:"B012345678",productTitle:"养蜂服参考",status:"confirmed"}],refetch:vi.fn()})},getSet:{useQuery:()=>({data:{asin:"B012345678",productTitle:"养蜂服参考",images:[]}})},importByAsin:{useMutation:()=>({mutateAsync:f.collect})}}}}));
vi.mock("../knowledge/AmazonStyleGallery",()=>({AmazonStyleGallery:()=>null}));
vi.mock("./PlanningAssetPicker",()=>({default:({onConfirm}:any)=><button onClick={()=>onConfirm({setIds:[3],images:[]})}>确认选择的套图</button>}));
import ImagePlanningReferences from "./ImagePlanningReferences";
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("leaves reference selection manual, starts with three slots, and allows at most five",()=>{
  function Host(){const [data,setData]=useState(emptyImageOutline);return <ImagePlanningReferences data={data} onChange={d=>{f.change(d);setData(d);}} onPersist={async()=>true}/>;}
  render(<Host/>);expect(screen.getAllByText(/参考套图位置 \d/)).toHaveLength(3);expect(f.collect).not.toHaveBeenCalled();expect(f.change).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("combobox",{name:"参考套图位置数量"}),{target:{value:"5"}});expect(screen.getAllByText(/参考套图位置 \d/)).toHaveLength(5);
  expect(screen.queryByRole("combobox",{name:"从知识库选择参考套图"})).toBeNull();fireEvent.click(screen.getByRole("button",{name:"选择知识库ASIN集"}));expect(f.change.mock.calls.at(-1)![0].referenceSets).toEqual([]);fireEvent.click(screen.getByRole("button",{name:"确认选择的套图"}));
  expect(f.change.mock.calls.at(-1)![0].referenceSets).toEqual([3]);expect(screen.getByRole("region",{name:"参考套图 B012345678"})).toBeTruthy();expect(f.collect).not.toHaveBeenCalled();
});
