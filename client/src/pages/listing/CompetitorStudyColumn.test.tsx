// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {cleanup,fireEvent,render,screen,waitFor,within,
} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
const f=vi.hoisted(()=>({add:vi.fn(async()=>({kind: "image",imageId:42})),invalidate:vi.fn(),
}));
vi.mock("@/lib/trpc",()=>({trpc:{useUtils:()=>({kbImages:{invalidate:f.invalidate},kbVideos:{invalidate:f.invalidate},
    }),kbImages:{importProjectCompetitor:{useMutation:()=>({mutateAsync:f.add,isPending:false}),
      },
    },analysis:{
      prepareVideos: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      adjustCompetitor:{useMutation:()=>({})},improveCompetitor:{useMutation:()=>({})},
    },
  },
}));
vi.mock("./ListingReviewList",()=>({default:()=>null}));
vi.mock("@/components/ai/AiResultActions",()=>({AiResultActions:()=>null,
}));
import CompetitorStudyColumn from "./CompetitorStudyColumn";
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.clearAllMocks();});
it("marks a picture and sends manual edits with their original analysis value",()=>{
 const hash= "a".repeat(64),onMark=vi.fn().mockResolvedValue(undefined);
 const record={id:1,asin: "B012345678",title: "Test",bulletPoints: "[]",rawData:JSON.stringify({imageAssets:[{role: "main",url: "https://example.invalid/a.png",sourceUrlHash:hash,
        },
      ],comparisonAnalysis:{listing:{titleTranslation: "测试",bullets:[]},images:[{hash,translation: "原文翻译",sellingPoints:["耐用"]}],reviews:[],
      },
    }),
  };
 render(<CompetitorStudyColumn record={record} projectId={11} busy={false} onMark={onMark}/>);
 fireEvent.click(screen.getByRole("button",{name: "标记看好图片" }));expect(onMark).toHaveBeenCalledWith({type: "image",hash});
 vi.spyOn(window, "prompt").mockReturnValue("修正翻译");fireEvent.doubleClick(screen.getByText("测试"));
 expect(onMark).toHaveBeenCalledWith({type: "edit",key: "title:translation",original: "测试",value: "修正翻译",
  });
});

it("keeps empty comparison rows and only reanalyzes the selected ASIN",()=>{
 const onReanalyze=vi.fn().mockResolvedValue(undefined),onMark=vi.fn().mockResolvedValue(undefined);
 const record={id:1,asin: "B012345678",title: "Test",bulletPoints:JSON.stringify(["第一条"]),rawData:JSON.stringify({imageAssets:[]}),
  };
 render(<CompetitorStudyColumn record={record} projectId={11} busy={false} onMark={onMark} onReanalyze={onReanalyze} columnIndex={0} rowCounts={{gallery:1,bullets:2,aplus:2,brand:1}}/>);
 fireEvent.click(screen.getByRole("button",{name: "重新分析" }));expect(onReanalyze).toHaveBeenCalledOnce();
 expect(screen.getByTestId("bullet-row-1")).toHaveTextContent(
    "此位置没有五点内容"
  );
 expect(screen.getByTestId("gallery-row-0")).toHaveTextContent(
    "此位置没有商品图片"
  );
 expect(screen.getByTestId("aplus-row-1")).toHaveTextContent(
    "此位置没有 A+ 模块"
  );
 expect(screen.getByTestId("brand-row-0")).toHaveTextContent(
    "此位置没有品牌故事模块"
  );
 expect(screen.getByTestId("competitor-study-column").style.gridTemplateRows).toBe("subgrid");
});

it("uses the same carousel and brand story layout as the knowledge library",()=>{
 const hashes=["0", "1", "2", "3", "4", "5", "6"].map(c=>c.repeat(64));
 const ref=(i:number)=>({hash:hashes[i],alt:`图 ${i}`}),card=(...ids:number[])=>({images:ids.map(ref),title: "",text: "",
    });
 const assets=hashes.map((hash,i)=>({role:i<2? "aplus" : "brand_story",url:`/image-${i}.jpg`,sourceUrlHash:hash,
  }));
 const modules=[{id: "carousel",section: "aplus",kind: "carousel",cards:[card(0),card(1)],
    },{id: "story",section: "brand_story",kind: "brand_story",background:ref(2),cards:[card(3,4,5,6)],
    },
  ];
 const record={id:1,asin: "B012345678",bulletPoints: "[]",rawData:JSON.stringify({imageAssets:assets,sourceLayout:{version:1,modules},comparisonAnalysis:{images:hashes.map((hash,i)=>({hash,translation:`译文${i}`,sellingPoints:[`卖点${i}`],
        })),
      },
    }),
  };
 render(<CompetitorStudyColumn record={record} projectId={1} busy={false} onMark={vi.fn().mockResolvedValue(undefined)}/>);
 expect(screen.getByText("卖点0")).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name: "下一张" }));
 expect(screen.getByText("卖点1")).toBeInTheDocument();expect(screen.queryByText("卖点0")).toBeNull();
 expect(screen.getByLabelText("品牌故事四图组合").querySelectorAll("img")).toHaveLength(4);
 expect(screen.getByRole("button",{name: "查看品牌故事背景图" })).toBeInTheDocument();
});

it("only sends the explicitly chosen image or full-set import mode",async()=>{
 const hash= "a".repeat(64),record={id:1,asin: "B012345678",title: "Test",bulletPoints: "[]",rawData:JSON.stringify({imageAssets:[{role: "main",url: "/main.jpg",sourceUrlHash:hash}],
      }),
    };
 render(<CompetitorStudyColumn record={record} projectId={11} busy={false} onMark={vi.fn()}/>);
 expect(f.add).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name: "加入单图图库" }));await waitFor(()=>expect(f.add).toHaveBeenCalledWith({projectId:11,analysisId:1,kind: "image",assetHash:hash,
    }));
 fireEvent.click(screen.getByRole("button",{name: "整套加入 ASIN 集" }));await waitFor(()=>expect(f.add).toHaveBeenCalledWith({projectId:11,analysisId:1,kind: "set",assetHash:undefined,
    }));
});

it("shows one combined selling-point group and one AI entry for an entire multi-image module",()=>{
 const hashes=["a", "b"].map(v=>v.repeat(64));
 const sourceLayout={version:2,modules:[{id: "aplus-0",section: "aplus",kind: "grid",cards:hashes.map(hash=>({images:[{hash}]})),blocks:[{id: "body",text: "Breathable durable material" }],
      },
    ],
  };
 const richContent={version:1,generatedAt: "now",images:[],texts:[{id: "body",source: "Breathable durable material",translation: "透气耐用材料",sellingPoints:["耐用", "透气"],sellingPointCategories:["质量", "功能"],
      },
    ],
  };
 const record={id:1,asin: "B012345678",bulletPoints: "[]",rawData:JSON.stringify({sourceLayout,imageAssets:hashes.map(sourceUrlHash=>({role: "aplus",sourceUrlHash,url:`/${sourceUrlHash}.jpg`,
      })),comparisonAnalysis:{images:hashes.map(hash=>({hash,sellingPoints:["耐用"],sellingPointCategories:["质量"],
        })),richContent,
      },
    }),
  };
 render(<CompetitorStudyColumn record={record} projectId={1} busy={false} onMark={vi.fn()}/>);
 const module=within(screen.getByTestId("aplus-row-0"));
 expect(module.getAllByText("主要卖点：")).toHaveLength(1);expect(module.getAllByText("耐用")).toHaveLength(1);expect(module.getByText("透气")).toBeInTheDocument();
 expect(module.getAllByRole("button",{name: "调整结果（AI）" })).toHaveLength(1);expect(module.queryByRole("button",{name: "用于改进" })).toBeNull();
 expect(module.getAllByRole("button",{name: "加入单图图库" })).toHaveLength(2);
});

it("marks bullet text with source offsets even when the selection includes the displayed number", () => {
  const onMark = vi.fn().mockResolvedValue(undefined);
  const record = { id: 1, asin: "B012345678", title: "Test", bulletPoints: JSON.stringify(["Durable mesh"]), rawData: "{}" };
  render(<CompetitorStudyColumn record={record} projectId={11} busy={false} onMark={onMark} />);
  fireEvent.click(screen.getByRole("button", { name: "标记重点" }));
  const p = screen.getByTestId("bullet-row-0").querySelector("p")!;
  const range = document.createRange();
  range.setStart(p.querySelector("strong")!.firstChild!, 0);
  range.setEnd(p.querySelector("[data-bullet-source] span")!.firstChild!, 7);
  window.getSelection()!.addRange(range);
  fireEvent.mouseUp(p);
  expect(onMark).toHaveBeenCalledWith({ type: "highlight", bulletIndex: 0, start: 0, end: 7, text: "Durable" });
});
