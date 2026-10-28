// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
const calls=vi.hoisted(()=>({upload:vi.fn(),invalidate:vi.fn()}));
vi.mock("@/lib/trpc",()=>({trpc:{useUtils:()=>({kbImages:{listAllImages:{invalidate:calls.invalidate}}}),kbImages:{uploadStandalone:{useMutation:()=>({mutateAsync:calls.upload})}}}}));
import StandaloneImageUpload from "./StandaloneImageUpload";
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("uploads each selected file independently and retries only the failed one",async()=>{
  const close=vi.fn();calls.upload.mockResolvedValueOnce({id:1,tagging:true}).mockRejectedValueOnce(new Error("上传中断"));
  render(<StandaloneImageUpload onClose={close}/>);
  fireEvent.change(screen.getByLabelText("选择图片文件"),{target:{files:[new File(["first"],"first.png",{type:"image/png"}),new File(["second"],"second.png",{type:"image/png"})]}});
  fireEvent.click(screen.getByRole("button",{name:"上传并自动打标"}));
  await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("second.png"));
  expect(calls.upload.mock.calls.map(([v])=>v.filename)).toEqual(["first.png","second.png"]);
  expect(calls.upload.mock.calls.every(([v])=>!('asin' in v)&&!('imageSetId' in v))).toBe(true);
  expect(close).not.toHaveBeenCalled();
  calls.upload.mockResolvedValueOnce({id:2,tagging:true});fireEvent.click(screen.getByRole("button",{name:"重试未上传的图片"}));
  await waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(calls.upload.mock.calls[2][0].filename).toBe("second.png");
});
