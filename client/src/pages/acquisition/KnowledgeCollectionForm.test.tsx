// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const state=vi.hoisted(()=>({ mutate:vi.fn(),options:null as any }));
vi.mock("@/lib/trpc",()=>({trpc:{useUtils:()=>({acquisition:{listJobs:{invalidate:vi.fn()}}}),acquisition:{collectKnowledge:{useMutation:(options:any)=>{state.options=options;return {mutate:state.mutate,isPending:false};}}}}}));
vi.mock("sonner",()=>({toast:{success:vi.fn(),error:vi.fn()}}));
import { KnowledgeCollectionForm } from "./KnowledgeCollectionForm";
afterEach(()=>{cleanup();state.mutate.mockClear();});
describe("batch collection form",()=>{
  it("submits all pasted entries with one stable retry identity",()=>{
    render(<KnowledgeCollectionForm />);
    fireEvent.change(screen.getByRole("textbox"),{target:{value:"B0FKN88MFL\nB0FH1LZLD9，B0G3WN7CL2"}});
    fireEvent.click(screen.getByRole("button",{name:"开始顺序采集"}));
    expect(state.mutate.mock.calls[0][0].asins).toEqual(["B0FKN88MFL","B0FH1LZLD9","B0G3WN7CL2"]);
    fireEvent.click(screen.getByRole("button",{name:"开始顺序采集"}));
    expect(state.mutate.mock.calls[1][0].requestId).toBe(state.mutate.mock.calls[0][0].requestId);
  });
  it("shows invalid values and prevents silent partial submission",()=>{
    render(<KnowledgeCollectionForm />);
    fireEvent.change(screen.getByRole("textbox"),{target:{value:"B0FKN88MFL bad"}});
    expect(screen.getByText(/无法识别，请修改：bad/)).toBeTruthy();
    expect((screen.getByRole("button",{name:"开始顺序采集"}) as HTMLButtonElement).disabled).toBe(true);
  });
});
