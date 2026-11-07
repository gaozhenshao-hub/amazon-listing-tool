vi.mock("./listing/ResearchLock",()=>({useResearchLock:()=>({locked:false}),ResearchLockButton:()=>null}));
vi.mock("./listing/ProductPhotoPanel",()=>({default:()=>null}));
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {cleanup,fireEvent,render,screen,waitFor,
} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
const f=vi.hoisted(()=>({save:vi.fn(),cache:vi.fn(),projectId:11,job:null as any}));
vi.mock("@/contexts/ProjectContext",()=>({useProject:()=>({selectedProjectId:f.projectId}),
}));
vi.mock("@/components/ProjectSelector",()=>({default:()=>null}));
vi.mock("./listing/ListingStages",()=>({default:()=>null}));
vi.mock("@/components/ai/AiResultActions",()=>({AiResultActions:()=>null,
}));
vi.mock("@/lib/trpc",()=>({trpc:{useUtils:()=>({analysis:{getAggregation:{setData:f.cache}}}),analysis:{
 getAggregation:{useQuery:()=>({data:{revision:1,data:{selling:[{id: "1985bc06-6528-46b3-af33-fd1eaf5d8c25",text: "耐用",note: "",group: "secondary",
                },
              ],
 reviews:[{id: "1985bc06-6528-46b3-af33-fd1eaf5d8c26",text: "结实",note: "",sentiment: "positive",percentage:50,status: "unset",
                },
              ],questions:[],marks:[],
            },
          },
        }),
      },
 saveAggregation:{useMutation:()=>({mutateAsync:f.save,isPending:false}),
      },
      researchOrganizationStatus:{useQuery:(input:any)=>({data:input.section===f.job?.proposal?.section?f.job:null,refetch:async()=>({data:f.job})})},
      confirmResearchPreview:{useMutation:()=>({mutateAsync:vi.fn()})},dismissResearchPreview:{useMutation:()=>({mutateAsync:vi.fn()})},refineResearchPreview:{useMutation:()=>({mutateAsync:vi.fn()})},
      organizeResearch:{useMutation:()=>({isPending:false})},
 adjustAggregation:{useMutation:()=>({isPending:false})},
      confirmAggregationAdjustment:{useMutation:()=>({isPending:false}),
      },
},
  },
}));
import ListingAggregationPage from "./ListingAggregationPage";
afterEach(()=>{cleanup();vi.clearAllMocks();f.projectId=11;f.job=null;});
it("moves a selling point to another category and saves it to the selected project",async()=>{
 f.save.mockImplementation(async (input:any)=>({revision:2,data:input.data,
  }));render(<ListingAggregationPage/>);
 const item=await screen.findByText("耐用");fireEvent.dragStart(item.closest("[draggable]")!);
 fireEvent.drop(screen.getByRole("heading",{name:"主要卖点"}).closest("section")!);fireEvent.click(screen.getByRole("button",{name: "保存修改" }));
 await waitFor(()=>expect(f.save).toHaveBeenCalledWith(expect.objectContaining({projectId:11,revision:1,data:expect.objectContaining({selling:[expect.objectContaining({text: "耐用",group: "primary" }),
          ],
        }),
      })));
});
it("offers coverage status for positive reviews and persists the chosen value",async()=>{
 f.save.mockImplementation(async (input:any)=>({revision:2,data:input.data,
  }));render(<ListingAggregationPage/>);
 await screen.findByText("耐用");fireEvent.click(screen.getByRole("button",{name: "评论分析" }));
 fireEvent.change(screen.getByLabelText("结实状态"),{target:{value: "not_covered" },
  });fireEvent.click(screen.getByRole("button",{name: "保存修改" }));
 await waitFor(()=>expect(f.save).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({reviews:[expect.objectContaining({status: "not_covered" })],
        }),
      })));
});

it("ignores a late save response after switching projects",async()=>{
 let finish!:(value:any)=>void;f.save.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const rendered=render(<ListingAggregationPage/>);await screen.findByText("耐用");
 fireEvent.click(screen.getByRole("button",{name:"标注：耐用"}));
 fireEvent.change(screen.getByLabelText("节点名称"),{target:{value:"旧项目修改"}});fireEvent.click(screen.getByRole("button",{name:"应用修改"}));fireEvent.click(screen.getByRole("button",{name:"保存修改"}));
 await waitFor(()=>expect(f.save).toHaveBeenCalledTimes(1));const old=f.save.mock.calls[0][0];
 f.projectId=12;rendered.rerender(<ListingAggregationPage/>);await screen.findByText("耐用");
 finish({data:old.data,revision:2});await waitFor(()=>expect(screen.queryByText("旧项目修改")).not.toBeInTheDocument());
});

it("reopens a saved question preview after it was temporarily closed",async()=>{
 f.job={runId:"question-job",status:"succeeded",proposal:{revision:1,section:"questions",data:{selling:[],features:[],links:[],reviews:[],questions:[{id:"11111111-1111-4111-8111-111111111111",text:"如何选择尺码？",note:"",answer:"请对照详细尺码说明测量身体尺寸，并选择适合活动余量的尺码。",source:"inferred",category:"information"}],marks:[]}}};
 render(<ListingAggregationPage/>);await screen.findByText("耐用");fireEvent.click(screen.getByRole("button",{name:"买家问题库"}));
 expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
 fireEvent.click(await screen.findByRole("button",{name:"问题整理结果预览"}));
 expect(await screen.findByRole("dialog")).toHaveTextContent("如何选择尺码？");
 fireEvent.click(screen.getByRole("button",{name:"Close"}));
 fireEvent.click(await screen.findByRole("button",{name:"问题整理结果预览"}));
 expect(await screen.findByRole("dialog")).toHaveTextContent("请对照详细尺码说明");
});
