import { describe, it, expect } from "vitest";
import * as fs from "fs";

const SOURCE_PATH = "/home/ubuntu/amazon-listing-tool/server/routers/productOps.ts";
const SCHEMA_PATH = "/home/ubuntu/amazon-listing-tool/drizzle/schema.ts";
const FRONTEND_PATH = "/home/ubuntu/amazon-listing-tool/client/src/pages/ops/OpsProductConversion.tsx";

describe("Check Item Customization - Backend APIs", () => {
  const source = fs.readFileSync(SOURCE_PATH, "utf-8");

  it("editCheckItem mutation should exist and accept checkItemId, subDimension, standard", () => {
    expect(source).toContain("editCheckItem: protectedProcedure.input(z.object({");
    expect(source).toContain("checkItemId: z.number()");
    expect(source).toContain("subDimension: z.string().optional()");
    expect(source).toContain("standard: z.string().optional()");
  });

  it("editCheckItem should handle both custom items (direct edit) and system items (override)", () => {
    // Should check if item is custom
    expect(source).toContain("item.isCustom === 1 && item.userId === ctx.user.id");
    // Should create/update override for system items
    expect(source).toContain("type: 'direct_edit'");
    expect(source).toContain("type: 'override'");
  });

  it("toggleCheckItemHidden mutation should exist and accept checkItemId, isHidden", () => {
    expect(source).toContain("toggleCheckItemHidden: protectedProcedure.input(z.object({");
    expect(source).toContain("isHidden: z.boolean()");
  });

  it("toggleCheckItemHidden should create/update user override", () => {
    const toggleSection = source.substring(
      source.indexOf("toggleCheckItemHidden:"),
      source.indexOf("resetCheckItemOverride:")
    );
    // Should check for existing override
    expect(toggleSection).toContain("existingOverride");
    // Should insert or update
    expect(toggleSection).toContain("insert(checkItemOverrides)");
    expect(toggleSection).toContain("update(checkItemOverrides)");
    // Should return isHidden status
    expect(toggleSection).toContain("isHidden: input.isHidden");
  });

  it("resetCheckItemOverride mutation should exist and delete user override", () => {
    expect(source).toContain("resetCheckItemOverride: protectedProcedure.input(z.object({");
    const resetSection = source.substring(
      source.indexOf("resetCheckItemOverride:"),
      source.indexOf("removeCustomCheckItem:")
    );
    expect(resetSection).toContain("delete(checkItemOverrides)");
    expect(resetSection).toContain("checkItemOverrides.userId");
    expect(resetSection).toContain("checkItemOverrides.checkItemId");
  });

  it("removeCustomCheckItem mutation should exist and only delete user's custom items", () => {
    expect(source).toContain("removeCustomCheckItem: protectedProcedure.input(z.object({ itemId: z.number() })");
    const removeSection = source.substring(
      source.indexOf("removeCustomCheckItem:"),
      source.indexOf("removeCustomCheckItem:") + 800
    );
    // Should also clean up overrides
    expect(removeSection).toContain("delete(checkItemOverrides)");
    // Should only delete custom items owned by user
    expect(removeSection).toContain("conversionCheckItems.isCustom");
  });

  it("getCheckItems should support includeHidden parameter", () => {
    expect(source).toContain("includeHidden: z.boolean().optional()");
  });

  it("getCheckItems should merge user overrides into items", () => {
    const getSection = source.substring(
      source.indexOf("getCheckItems: protectedProcedure"),
      source.indexOf("initDefaultCheckItems:")
    );
    // Should query overrides
    expect(getSection).toContain("select().from(checkItemOverrides)");
    expect(getSection).toContain("overrideMap");
    // Should merge fields
    expect(getSection).toContain("override?.customSubDimension");
    expect(getSection).toContain("override?.customStandard");
    expect(getSection).toContain("isHidden");
    expect(getSection).toContain("hasOverride");
    // Should filter hidden items when includeHidden is false
    expect(getSection).toContain("!input?.includeHidden");
    expect(getSection).toContain("filter(item => !item.isHidden)");
  });
});

describe("Check Item Customization - Database Schema", () => {
  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");

  it("check_item_overrides table should exist with correct columns", () => {
    expect(schema).toContain("checkItemOverrides");
    expect(schema).toContain("check_item_overrides");
    expect(schema).toContain("userId");
    expect(schema).toContain("checkItemId");
    expect(schema).toContain("customSubDimension");
    expect(schema).toContain("customStandard");
    expect(schema).toContain("isHidden");
  });
});

describe("Check Item Customization - Frontend UI", () => {
  const frontend = fs.readFileSync(FRONTEND_PATH, "utf-8");

  it("should have manage mode toggle button", () => {
    expect(frontend).toContain("manageMode");
    expect(frontend).toContain("管理检查项");
    expect(frontend).toContain("退出管理");
  });

  it("should have show hidden items toggle", () => {
    expect(frontend).toContain("showHidden");
    expect(frontend).toContain("显示已隐藏项");
  });

  it("should have edit check item dialog", () => {
    expect(frontend).toContain("editItemDialog");
    expect(frontend).toContain("editCheckItemMut");
    expect(frontend).toContain("编辑检查项");
    expect(frontend).toContain("编辑自定义检查项");
    expect(frontend).toContain("保存修改");
  });

  it("should have edit/hide/delete action buttons in manage mode", () => {
    // Edit button
    expect(frontend).toContain("编辑检查项");
    expect(frontend).toContain("Pencil");
    // Hide button
    expect(frontend).toContain("toggleHiddenMut");
    expect(frontend).toContain("隐藏检查项");
    expect(frontend).toContain("取消隐藏");
    expect(frontend).toContain("EyeOff");
    // Reset button
    expect(frontend).toContain("resetOverrideMut");
    expect(frontend).toContain("恢复默认设置");
    expect(frontend).toContain("RotateCcw");
    // Delete custom item button
    expect(frontend).toContain("removeCheckItem");
    expect(frontend).toContain("删除自定义项");
  });

  it("should show badges for custom, modified, and hidden items", () => {
    expect(frontend).toContain("自定义");
    expect(frontend).toContain("已修改");
    expect(frontend).toContain("已隐藏");
    expect(frontend).toContain("item.isCustom === 1");
    expect(frontend).toContain("item.hasOverride");
    expect(frontend).toContain("item.isHidden");
  });

  it("should show system item notice in edit dialog", () => {
    expect(frontend).toContain("这是系统默认检查项");
    expect(frontend).toContain("修改后仅对您生效");
    expect(frontend).toContain("恢复默认设置");
  });

  it("should pass includeHidden parameter to getCheckItems query", () => {
    expect(frontend).toContain("includeHidden: showHidden || manageMode");
  });

  it("should display hidden item count badge", () => {
    expect(frontend).toContain("项已隐藏");
    expect(frontend).toContain("filter((i: any) => i.isHidden).length");
  });

  it("should add operations column header in manage mode", () => {
    expect(frontend).toContain("{manageMode && <TableHead");
    expect(frontend).toContain("操作");
  });

  it("should style hidden items with reduced opacity", () => {
    expect(frontend).toContain("item.isHidden ? \"opacity-50 bg-muted/30\" : \"\"");
  });
});
