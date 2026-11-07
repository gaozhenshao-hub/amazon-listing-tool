// @vitest-environment jsdom
import { afterEach, it, expect, vi } from "vitest";
import { act,cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PreparedImage } from "./PreparedImage";
afterEach(cleanup);
const hash = "a".repeat(64),
  translation = {
    version: 1,
    sourceHash: hash,
    audited: true,
    status: "complete",
    regions: [
      {
        source: "Cotton",
        translation: "棉质",
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.1,
      },
    ],
    notes: "",
  };
it("only toggles previously saved regions locally and defaults to the original image", () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const { container } = render(
    <PreparedImage
      src="/image.jpg"
      alt="素材"
      sourceHash={hash}
      translation={translation}
    />
  );
  expect(screen.queryByText("棉质")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "显示中文" }));
  expect(screen.getByText("棉质")).toBeTruthy();
  expect(
    container.querySelector(
      '[aria-label="预先保存的中文译图"] [style*="left: 10%"]'
    )
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "显示原图" }));
  expect(screen.queryByText("棉质")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
it("never applies a saved overlay to a different source image", () => {
  render(
    <PreparedImage
      src="/other.jpg"
      alt="素材"
      sourceHash={"b".repeat(64)}
      translation={translation}
    />
  );
  expect(
    (screen.getByRole("button", { name: "中文未准备" }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
});
it("shows partial recognition honestly and keeps unknown source text out of fabricated overlays", () => {
  render(
    <PreparedImage
      src="/image.jpg"
      alt="素材"
      sourceHash={hash}
      translation={{
        ...translation,
        status: "partial",
        notes: "右下角小字模糊",
      }}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "显示已识别中文" }));
  expect(screen.getByRole("status").textContent).toContain("右下角小字模糊");
});
it('keeps regions on the actual contained image after padding and frame resizing',()=>{
 const callbacks:Array<()=>void>=[];vi.stubGlobal('ResizeObserver',class{constructor(cb:()=>void){callbacks.push(cb);}observe(){}disconnect(){}});
 const {container}=render(<PreparedImage src="/image.jpg" alt="素材" sourceHash={hash} translation={translation} imageStyle={{padding:'10px',border:'0px solid transparent'}}/>);
 const image=screen.getByRole('img') as HTMLImageElement;let width=300;
 Object.defineProperties(image,{naturalWidth:{value:1500},naturalHeight:{value:1500}});
 vi.spyOn(image,'getBoundingClientRect').mockImplementation(()=>({left:0,top:0,width,height:200,right:width,bottom:200,x:0,y:0,toJSON:()=>null}));
 fireEvent.load(image);fireEvent.click(screen.getByRole('button',{name:'显示中文'}));
 const overlay=container.querySelector<HTMLElement>('[aria-label="预先保存的中文译图"]')!;
 expect([overlay.style.left,overlay.style.top,overlay.style.width,overlay.style.height]).toEqual(['60px','10px','180px','180px']);
 width=400;act(()=>callbacks[0]());expect(overlay.style.left).toBe('110px');expect(overlay.style.width).toBe('180px');vi.unstubAllGlobals();
});
it('returns to the original when the source changes, even if a legacy source hash is reused',()=>{
 const {rerender}=render(<PreparedImage src="/old.jpg" alt="素材" sourceHash={hash} translation={translation}/>);
 fireEvent.click(screen.getByRole('button',{name:'显示中文'}));expect(screen.getByText('棉质')).toBeTruthy();
 rerender(<PreparedImage src="/new.jpg" alt="素材" sourceHash={hash} translation={translation}/>);expect(screen.queryByText('棉质')).toBeNull();
});
