import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── Test: Backend - unconfirmSection endpoint ─────────────────
describe("Profile Unlock - Backend Router", () => {
  const routerPath = path.join(__dirname, "routers/devProfile.ts");
  const routerCode = fs.readFileSync(routerPath, "utf-8");

  it("should have unconfirmSection endpoint", () => {
    expect(routerCode).toContain("unconfirmSection:");
  });

  it("unconfirmSection should be a protectedProcedure", () => {
    const idx = routerCode.indexOf("unconfirmSection:");
    const section = routerCode.slice(idx, idx + 300);
    expect(section).toContain("protectedProcedure");
  });

  it("unconfirmSection should accept projectId and section", () => {
    const idx = routerCode.indexOf("unconfirmSection:");
    const section = routerCode.slice(idx, idx + 300);
    expect(section).toContain("projectId: z.number()");
    expect(section).toContain("section: z.enum(PROFILE_SECTIONS)");
  });

  it("unconfirmSection should set confirmed to 0", () => {
    const idx = routerCode.indexOf("unconfirmSection:");
    const section = routerCode.slice(idx, idx + 400);
    expect(section).toContain("[cols.confirmed]: 0");
  });

  it("unconfirmSection should call upsertDevProductProfile", () => {
    const idx = routerCode.indexOf("unconfirmSection:");
    const section = routerCode.slice(idx, idx + 500);
    expect(section).toContain("upsertDevProductProfile");
  });

  it("confirmSection should still exist alongside unconfirmSection", () => {
    expect(routerCode).toContain("confirmSection:");
    expect(routerCode).toContain("unconfirmSection:");
  });

  it("SECTION_DB_MAP should have confirmed field for all 8 sections", () => {
    const sections = ["appearance", "function", "cost", "package", "packageDesign", "userPersona", "usageScenarios", "productMap"];
    for (const s of sections) {
      expect(routerCode).toContain(`${s}:`);
    }
    // Check confirmed fields exist
    expect(routerCode).toContain("appearanceConfirmed");
    expect(routerCode).toContain("functionsConfirmed");
    expect(routerCode).toContain("costConfirmed");
    expect(routerCode).toContain("packageConfirmed");
    expect(routerCode).toContain("packageDesignConfirmed");
    expect(routerCode).toContain("userPersonaConfirmed");
    expect(routerCode).toContain("usageScenariosConfirmed");
    expect(routerCode).toContain("productMapConfirmed");
  });
});

// ─── Test: Frontend - ProfileEditor unlock UI ──────────────────
describe("Profile Unlock - Frontend ProfileEditor", () => {
  const editorPath = path.join(__dirname, "../client/src/pages/dev/ProfileEditor.tsx");
  const editor = fs.readFileSync(editorPath, "utf-8");

  it("should use unconfirmSection mutation", () => {
    expect(editor).toContain("trpc.devProfile.unconfirmSection.useMutation");
  });

  it("should show success toast on unlock", () => {
    expect(editor).toContain("已解锁，可重新编辑");
  });

  it("should show error toast on unlock failure", () => {
    expect(editor).toContain("解锁失败");
  });

  it("should have handleUnconfirm function", () => {
    expect(editor).toContain("handleUnconfirm");
  });

  it("should show confirmation dialog before unlocking", () => {
    expect(editor).toContain("确定要解锁");
    expect(editor).toContain("解锁后可重新编辑内容");
  });

  it("should import Unlock icon from lucide-react", () => {
    expect(editor).toContain("Unlock");
  });

  it("should show 解锁编辑 button in CardHeader when confirmed and not readOnly", () => {
    expect(editor).toContain("isConfirmed && !readOnly");
    expect(editor).toContain("解锁编辑");
  });

  it("should show AI生成建议 button when not confirmed and not readOnly", () => {
    expect(editor).toContain("!isConfirmed && !readOnly");
    expect(editor).toContain("AI生成建议");
  });

  it("should pass isConfirmed (not isConfirmed || readOnly) to SectionEditor", () => {
    // SectionEditor should receive isConfirmed and readOnly separately
    const sectionEditorCall = editor.slice(editor.indexOf("<SectionEditor"));
    expect(sectionEditorCall).toContain("isConfirmed={isConfirmed}");
    expect(sectionEditorCall).toContain("readOnly={readOnly}");
  });

  it("should pass onUnconfirm and unconfirmPending to SectionEditor", () => {
    const sectionEditorCall = editor.slice(editor.indexOf("<SectionEditor"));
    expect(sectionEditorCall).toContain("onUnconfirm={handleUnconfirm}");
    expect(sectionEditorCall).toContain("unconfirmPending={unconfirmMutation.isPending}");
  });
});

// ─── Test: ActionBar unlock button ─────────────────────────────
describe("Profile Unlock - ActionBar Component", () => {
  const editorPath = path.join(__dirname, "../client/src/pages/dev/ProfileEditor.tsx");
  const editor = fs.readFileSync(editorPath, "utf-8");

  it("ActionBar should accept onUnconfirm prop", () => {
    const actionBarDef = editor.slice(editor.indexOf("function ActionBar"));
    expect(actionBarDef).toContain("onUnconfirm");
  });

  it("ActionBar should accept unconfirmPending prop", () => {
    const actionBarDef = editor.slice(editor.indexOf("function ActionBar"));
    expect(actionBarDef).toContain("unconfirmPending");
  });

  it("ActionBar should accept isActuallyConfirmed prop", () => {
    const actionBarDef = editor.slice(editor.indexOf("function ActionBar"));
    expect(actionBarDef).toContain("isActuallyConfirmed");
  });

  it("ActionBar should accept readOnly prop", () => {
    const actionBarDef = editor.slice(editor.indexOf("function ActionBar"));
    expect(actionBarDef).toContain("readOnly");
  });

  it("ActionBar should show unlock button when confirmed and not readOnly", () => {
    const actionBarDef = editor.slice(editor.indexOf("function ActionBar"));
    expect(actionBarDef).toContain("!readOnly && onUnconfirm");
    expect(actionBarDef).toContain("解锁编辑");
  });

  it("ActionBar should show locked message when confirmed", () => {
    const actionBarDef = editor.slice(editor.indexOf("function ActionBar"));
    expect(actionBarDef).toContain("此模块已确认锁定，数据可被其他模块引用");
  });

  it("ActionBar should show parent lock message when readOnly (not confirmed)", () => {
    const actionBarDef = editor.slice(editor.indexOf("function ActionBar"));
    expect(actionBarDef).toContain("产品画像模块已锁定，请先在顶部解锁");
  });

  it("ActionBar should show save and confirm buttons when unlocked", () => {
    const actionBarDef = editor.slice(editor.indexOf("function ActionBar"));
    expect(actionBarDef).toContain("保存修改");
    expect(actionBarDef).toContain("确认锁定");
  });
});

// ─── Test: All 8 editors pass unlock props to ActionBar ────────
describe("Profile Unlock - Editor Components Props", () => {
  const editorPath = path.join(__dirname, "../client/src/pages/dev/ProfileEditor.tsx");
  const editor = fs.readFileSync(editorPath, "utf-8");

  const editors = [
    "AppearanceEditor",
    "FunctionEditor",
    "CostEditor",
    "PackageEditor",
    "PackageDesignEditor",
    "UserPersonaEditor",
    "UsageScenariosEditor",
    "ProductMapEditor",
  ];

  for (const name of editors) {
    it(`${name} should destructure onUnconfirm prop`, () => {
      const funcDef = editor.slice(editor.indexOf(`function ${name}`));
      const firstLine = funcDef.slice(0, funcDef.indexOf("{", funcDef.indexOf("{") + 1));
      expect(firstLine).toContain("onUnconfirm");
    });

    it(`${name} should destructure unconfirmPending prop`, () => {
      const funcDef = editor.slice(editor.indexOf(`function ${name}`));
      const firstLine = funcDef.slice(0, funcDef.indexOf("{", funcDef.indexOf("{") + 1));
      expect(firstLine).toContain("unconfirmPending");
    });

    it(`${name} should destructure isActuallyConfirmed prop`, () => {
      const funcDef = editor.slice(editor.indexOf(`function ${name}`));
      const firstLine = funcDef.slice(0, funcDef.indexOf("{", funcDef.indexOf("{") + 1));
      expect(firstLine).toContain("isActuallyConfirmed");
    });

    it(`${name} should destructure readOnly prop`, () => {
      const funcDef = editor.slice(editor.indexOf(`function ${name}`));
      const firstLine = funcDef.slice(0, funcDef.indexOf("{", funcDef.indexOf("{") + 1));
      expect(firstLine).toContain("readOnly");
    });

    it(`${name} should pass unlock props to ActionBar`, () => {
      const funcDef = editor.slice(editor.indexOf(`function ${name}`));
      const funcEnd = funcDef.indexOf(`\nfunction `, 100);
      const funcBody = funcEnd > 0 ? funcDef.slice(0, funcEnd) : funcDef;
      expect(funcBody).toContain("onUnconfirm={onUnconfirm}");
      expect(funcBody).toContain("unconfirmPending={unconfirmPending}");
      expect(funcBody).toContain("isActuallyConfirmed={isActuallyConfirmed}");
      expect(funcBody).toContain("readOnly={readOnly}");
    });
  }
});

// ─── Test: SectionEditor dispatches with correct props ─────────
describe("Profile Unlock - SectionEditor Dispatch", () => {
  const editorPath = path.join(__dirname, "../client/src/pages/dev/ProfileEditor.tsx");
  const editor = fs.readFileSync(editorPath, "utf-8");

  it("SectionEditor should accept readOnly prop", () => {
    const seDef = editor.slice(editor.indexOf("function SectionEditor"));
    const firstLine = seDef.slice(0, seDef.indexOf(") {") + 3);
    expect(firstLine).toContain("readOnly");
  });

  it("SectionEditor should accept onUnconfirm prop", () => {
    const seDef = editor.slice(editor.indexOf("function SectionEditor"));
    const firstLine = seDef.slice(0, seDef.indexOf(") {") + 3);
    expect(firstLine).toContain("onUnconfirm");
  });

  it("SectionEditor should compute disabled = isConfirmed || readOnly", () => {
    const seDef = editor.slice(editor.indexOf("function SectionEditor"));
    expect(seDef).toContain("const disabled = isConfirmed || readOnly");
  });

  it("SectionEditor should pass isActuallyConfirmed to child editors", () => {
    const seDef = editor.slice(editor.indexOf("function SectionEditor"));
    expect(seDef).toContain("isActuallyConfirmed: isConfirmed");
  });

  it("SectionEditor should spread editorProps to all 8 editors", () => {
    const seDef = editor.slice(editor.indexOf("function SectionEditor"));
    const editors = ["AppearanceEditor", "FunctionEditor", "CostEditor", "PackageEditor", 
                     "PackageDesignEditor", "UserPersonaEditor", "UsageScenariosEditor", "ProductMapEditor"];
    for (const e of editors) {
      expect(seDef).toContain(`<${e} {...editorProps}`);
    }
  });
});
