import { describe, it, expect } from "vitest";
import {
  meetingDateSchema,
  meetingTitle,
  exactMeetingAssignee,
  exactMeetingProduct,
  meetingAnalysisSchema,
} from "../../../shared/meetingNotes";
describe("meeting evidence contracts", () => {
  it("uses the US product for the same North America ASIN without guessing ambiguous names", () => {
    const us = { identity: { parentAsin: "B0GFHHGC7Y", country: "US" }, title: "盖板" };
    const mx = { ...us, identity: { ...us.identity, country: "MX" } };
    expect(exactMeetingProduct("B0GFHHGC7Y", [mx, us])).toBe(us);
    expect(exactMeetingProduct("盖板", [mx, us])).toBe(us);
    expect(exactMeetingProduct("盖板", [us, {...us, identity: {...us.identity, parentAsin:"B000000002"}}])).toBeUndefined();
    expect(exactMeetingProduct("B0GFHHGC7Y", [us, {...us}])).toBeUndefined();
  });
  it("names meetings by actual date and rejects impossible dates", () => {
    expect(meetingTitle("2026-10-21", "10月21号库存讨论")).toBe("10月21号库存讨论");
    expect(meetingTitle("2026-10-21", "库存讨论")).toBe("10月21号库存讨论");
    expect(meetingTitle("2026-10-21")).toBe("10月21号运营会");
    expect(meetingDateSchema.safeParse("2026-02-30").success).toBe(false);
  });
  it("never defaults a missing or ambiguous name to the logged-in user", () => {
    const members = [
      { id: 1, displayName: "张三" },
      { id: 2, displayName: "张三" },
    ];
    expect(exactMeetingAssignee("张三", members, [2])).toBe(2);
    expect(exactMeetingAssignee("张三", members, [1,2])).toBeNull();
    expect(exactMeetingAssignee(null, members, [2])).toBeNull();
    expect(exactMeetingAssignee(null, members)).toBeNull();
    expect(exactMeetingAssignee("张三", members)).toBeNull();
    expect(exactMeetingAssignee("张三", members.slice(0, 1))).toBe(1);
  });
  it("allows incomplete suggestions but rejects fabricated date formats", () => {
    const task = {
      title: "核对尺寸",
      description: "",
      assigneeName: null,
      dueDate: null,
      productHint: null,
      category: "其他",
      evidence: "需要核对尺寸",
    };
    expect(
      meetingAnalysisSchema.safeParse({
        summary: "待确认负责人",
        tasks: [task],
      }).success
    ).toBe(true);
    expect(
      meetingAnalysisSchema.safeParse({
        summary: "纪要",
        tasks: [{ ...task, dueDate: "下周" }],
      }).success
    ).toBe(false);
  });
});
