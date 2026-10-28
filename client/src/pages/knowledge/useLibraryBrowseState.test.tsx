// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, renderHook, act } from "@testing-library/react";
import { useLibraryBrowseState } from "./useLibraryBrowseState";

const initial = { style: "", category: "", primaryColor: "", accentColor: "" };
afterEach(() => { cleanup(); sessionStorage.clear(); });
describe("library browse session state", () => {
  it.each([null, "null", "[]", "broken", '"old-value"'])("opens a new view safely with %s cache", saved => {
    if (saved !== null) sessionStorage.setItem("knowledge-browse:sets.filters", saved);
    const { result } = renderHook(() => useLibraryBrowseState("sets.filters", initial));
    expect(result.current[0]).toEqual(initial);
  });
  it("merges supported saved fields and rejects malformed values", () => {
    sessionStorage.setItem("knowledge-browse:sets.filters", JSON.stringify({style:"现代都市风",category:null,primaryColor:7,oldField:"old"}));
    const { result } = renderHook(() => useLibraryBrowseState("sets.filters", initial));
    expect(result.current[0]).toEqual({...initial,style:"现代都市风"});
  });
  it("keeps filters across reopening without changing another view", () => {
    const first = renderHook(() => useLibraryBrowseState("single.filters", initial));
    act(() => first.result.current[1]({...initial,category:"宠物"}));
    first.unmount();
    const restored = renderHook(() => useLibraryBrowseState("single.filters", initial));
    const other = renderHook(() => useLibraryBrowseState("sets.filters", initial));
    expect(restored.result.current[0].category).toBe("宠物");
    expect(other.result.current[0]).toEqual(initial);
  });
});
