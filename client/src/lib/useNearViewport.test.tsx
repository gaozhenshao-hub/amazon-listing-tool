// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useNearViewport } from "./useNearViewport";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("defers detail loading until a card approaches the viewport and then disconnects", () => {
  let notify: IntersectionObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { notify = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const hook = renderHook(useNearViewport);
  expect(hook.result.current.visible).toBe(false);
  act(() => notify([{isIntersecting: false}] as IntersectionObserverEntry[], {} as IntersectionObserver));
  expect(hook.result.current.visible).toBe(false);
  act(() => notify([{isIntersecting: true}] as IntersectionObserverEntry[], {} as IntersectionObserver));
  expect(hook.result.current.visible).toBe(true);
  expect(disconnect).toHaveBeenCalledOnce();
  hook.unmount();
  expect(disconnect).toHaveBeenCalledTimes(2);
});
