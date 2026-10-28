import { describe, it, expect } from "vitest";
import {
  VIDEO_CONTENT_TAGS,
  VIDEO_TYPES,
  readVideoLabels,
  validateVideoLabels,
  VideoLabelsSchema,
} from "../../../shared/videoLabels";
import {
  inheritedVideoLabels,
  videoObjectAllowed,
  videoAccess,
  type VideoRow,
} from "./videoLibrary";
import { MySqlDialect } from "drizzle-orm/mysql-core";
const labels = {
  type: "产品展示（侧重安操）",
  category: "工具",
  style: "极简",
  primaryColor: "白色",
  accentColor: "蓝色",
  summary: "操作演示",
  segments: [
    { label: "安装上手", start: 10, end: 15, description: "装配支架" },
    { label: "安装上手", start: 2, end: 5, description: "取出配件" },
  ],
};
describe("video label contracts", () => {
  it("preserves the user's ten content names and multiple ranges per label", () => {
    expect(VIDEO_CONTENT_TAGS).toEqual([
      "钩子",
      "开箱清单",
      "尺寸规格",
      "安装上手",
      "核心使用",
      "卖点证明",
      "使用场景",
      "外观展示",
      "细节特写",
      "信任背书",
    ]);
    expect(validateVideoLabels(labels, 20).segments.map(s => s.start)).toEqual([
      2, 10,
    ]);
    expect(() =>
      validateVideoLabels(
        { ...labels, segments: [{ ...labels.segments[0], label: "安装教程" }] },
        20
      )
    ).toThrow();
  });
  it("accepts exactly five primary types and rejects obsolete sub-tags", () => {
    expect(() => validateVideoLabels(labels, 11)).toThrow("超出");
    expect(() =>
      validateVideoLabels(
        {
          ...labels,
          segments: [{ ...labels.segments[0], start: 15, end: 10 }],
        },
        20
      )
    ).toThrow();
    expect(
      VideoLabelsSchema.safeParse({ ...labels, type: "故事片" }).success
    ).toBe(true);
    expect(
      VideoLabelsSchema.safeParse({ ...labels, displayTags: [] }).success
    ).toBe(false);
    expect(VIDEO_TYPES).toEqual(["口播","故事片","产品展示（侧重外观）","产品展示（侧重场景）","产品展示（侧重安操）"]);
    expect(VideoLabelsSchema.safeParse({...labels,type:"解说展示"}).success).toBe(false);
    const old = {...labels,type:"产品展示",displayTags:["场景展示"]};
    expect(readVideoLabels(old)?.type).toBe("产品展示（侧重场景）");
    expect(old.type).toBe("产品展示");
  });
  it("reads collection labels live while standalone videos retain their own", () => {
    const row = {
      imageSetId: 1,
      aiAnalysis: JSON.stringify(labels),
      setCategory: "宠物",
      setStyle: "家居",
      setPrimaryColor: "米色",
      setAccentColor: "橙色",
    } as VideoRow;
    expect(inheritedVideoLabels(row)).toMatchObject({
      category: "宠物",
      primaryColor: "米色",
      segments: expect.any(Array),
    });
    expect(inheritedVideoLabels({ ...row, imageSetId: null })?.category).toBe(
      "工具"
    );
  });
  it("does not deliver a foreign workspace or arbitrary object", () => {
    const scope = { workspaceId: 3, userId: 8 };
    const reference = `storage://local/knowledge/3/videos/8/${"a".repeat(64)}.mp4`;
    expect(videoObjectAllowed(reference, scope)).toBe(true);
    expect(videoObjectAllowed(reference, { ...scope, workspaceId: 4 })).toBe(
      false
    );
    expect(videoObjectAllowed(reference.replace("/8/", "/../"), scope)).toBe(
      false
    );
  });
  it("enforces workspace, ownership and collection visibility in SQL", () => {
    const dialect = new MySqlDialect();
    const regular = dialect.sqlToQuery(
      videoAccess({ workspaceId: 3, userId: 8, role: "user" }, "all", true)
    );
    expect(regular.sql).toContain("v.workspaceId=?");
    expect(regular.sql).toContain("v.userId=?");
    expect(regular.sql).toContain("s.workspaceId=?");
    expect(regular.params).toContain(3);
    expect(regular.params).toContain(8);
    const admin = dialect.sqlToQuery(
      videoAccess({ workspaceId: 3, userId: 8, role: "admin" }, "all", true)
    );
    expect(admin.sql).toContain("OR v.status='confirmed'");
  });
});
