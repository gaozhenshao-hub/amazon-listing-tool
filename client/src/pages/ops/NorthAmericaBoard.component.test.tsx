// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MONTHLY_FINANCIAL_METRICS } from "@shared/monthlyFinancialRead";
import Board from "./NorthAmericaBoard";
const state=vi.hoisted(()=>({query:vi.fn(),mutate:vi.fn(),user:{id:3,role:"admin",defaultWorkspaceId:7}}));
const api={get:{query:state.query},saveNote:{mutate:state.mutate}};
vi.mock("@/lib/trpc",()=>({trpc:{useUtils:()=>({client:{northAmericaBoard:api}})}}));
vi.mock("@/_core/hooks/useAuth",()=>({useAuth:()=>({user:state.user,loading:false,error:null})}));
const metrics=(profit:number)=>({...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key=>[key,0])),financialProfit:profit,salesQty:100,salesAmount:10000,returnQty:10,purchaseCost:20,freight:30});
const months={"2026-08":{metrics:metrics(2000),sources:[]},"2026-09":{metrics:metrics(3000),sources:[]}};
function response(){return {identity:{workspaceId:7,userId:3},canViewAll:true,operators:[{id:3,name:"管理员"}],edition:{id:1,archived:false},notes:[],history:[],legacyHistory:[],legacy:null,
 payload:{version:1,country:"US",currency:"USD",month:"2026-09",availableMonths:["2026-08","2026-09"],unallocated:{},sourceRule:"latest_complete_batch_per_month_store_country_current_us_parent_explicit_usd",products:[
 {asin:"B000000001",storeName:"Store",title:"单子体产品",ownerIds:[3],months,children:[{asin:"B000000011",title:"子体一",months}]},
 {asin:"B000000002",storeName:"Store",title:"多子体产品",ownerIds:[3],months,children:[{asin:"B000000021",title:"子体二",months},{asin:"B000000022",title:"子体三",months}]},
 ]}};}
beforeEach(()=>{vi.resetAllMocks();state.query.mockResolvedValue(response());});
afterEach(cleanup);
describe("consolidated operational board interactions",()=>{
 it("uses actual months and expands only multiple children",async()=>{
  render(<Board kind="profit"/>);await screen.findByText("单子体产品");
  expect(screen.getByText("月度利润（9月）")).toBeInTheDocument();expect(screen.getByText("月度利润（8月）")).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"展开B000000001子体"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"展开B000000002子体"}));expect(screen.getByText("子体二")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"收起B000000002子体"}));expect(screen.queryByText("子体二")).not.toBeInTheDocument();
 });
 it("never displays data returned with another identity",async()=>{
  state.query.mockResolvedValue({...response(),identity:{workspaceId:8,userId:3}});render(<Board kind="profit"/>);
  await screen.findByRole("alert");expect(screen.queryByText("单子体产品")).not.toBeInTheDocument();
 });
 it("clears previously visible financial data while refreshing a failed request",async()=>{
  render(<Board kind="products"/>);await screen.findAllByText("单子体产品");
  state.query.mockRejectedValue(new Error("scope changed"));fireEvent.click(screen.getByRole("button",{name:"刷新"}));
  await screen.findByRole("alert");expect(screen.queryByText("单子体产品")).not.toBeInTheDocument();
 });
});
