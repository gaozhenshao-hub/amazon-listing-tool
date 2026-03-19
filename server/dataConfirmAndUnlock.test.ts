import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── Test: Data Confirmation Schema ─────────────────────────────
describe("Data Confirmation - Schema", () => {
  const schemaPath = path.join(__dirname, "../drizzle/schema.ts");
  const schema = fs.readFileSync(schemaPath, "utf-8");

  it("devUploadedFiles should have confirmed column", () => {
    expect(schema).toContain('confirmed: int("confirmed")');
  });

  it("devUploadedFiles should have confirmedAt column", () => {
    expect(schema).toContain('confirmedAt: timestamp("confirmedAt")');
  });

  it("confirmed should default to 0", () => {
    expect(schema).toContain(".default(0).notNull()");
  });
});

// ─── Test: Data Confirmation DB Functions ───────────────────────
describe("Data Confirmation - DB Functions", () => {
  const dbPath = path.join(__dirname, "devDb.ts");
  const dbCode = fs.readFileSync(dbPath, "utf-8");

  it("should export confirmDevFilesByType function", () => {
    expect(dbCode).toContain("export async function confirmDevFilesByType");
  });

  it("confirmDevFilesByType should set confirmed=1 and confirmedAt", () => {
    expect(dbCode).toContain("confirmed: 1");
    expect(dbCode).toContain("confirmedAt: new Date()");
  });

  it("should export unconfirmDevFilesByType function", () => {
    expect(dbCode).toContain("export async function unconfirmDevFilesByType");
  });

  it("unconfirmDevFilesByType should set confirmed=0 and confirmedAt=null", () => {
    expect(dbCode).toContain("confirmed: 0");
    expect(dbCode).toContain("confirmedAt: null");
  });

  it("should export getDataConfirmationStatus function", () => {
    expect(dbCode).toContain("export async function getDataConfirmationStatus");
  });

  it("getDataConfirmationStatus should check all 4 file types", () => {
    expect(dbCode).toContain('"sales"');
    expect(dbCode).toContain('"bullet_points"');
    expect(dbCode).toContain('"reviews"');
    expect(dbCode).toContain('"history_sales"');
  });
});

// ─── Test: Data Confirmation Router Endpoints ───────────────────
describe("Data Confirmation - Router Endpoints", () => {
  const routerPath = path.join(__dirname, "routers/devProject.ts");
  const routerCode = fs.readFileSync(routerPath, "utf-8");

  it("should have getDataStatus endpoint", () => {
    expect(routerCode).toContain("getDataStatus:");
  });

  it("should have confirmData endpoint", () => {
    expect(routerCode).toContain("confirmData:");
  });

  it("should have unconfirmData endpoint", () => {
    expect(routerCode).toContain("unconfirmData:");
  });

  it("confirmData should accept fileType enum", () => {
    expect(routerCode).toContain('z.enum(["sales", "bullet_points", "reviews", "history_sales"])');
  });

  it("confirmData should verify project ownership", () => {
    const confirmSection = routerCode.slice(routerCode.indexOf("confirmData:"));
    expect(confirmSection).toContain("resolveDevProjectAccess");
  });
});

// ─── Test: Stage Unlock DB Function ─────────────────────────────
describe("Stage Unlock - DB Function", () => {
  const dbPath = path.join(__dirname, "devDb.ts");
  const dbCode = fs.readFileSync(dbPath, "utf-8");

  it("should export unlockDevAnalysisStage function", () => {
    expect(dbCode).toContain("export async function unlockDevAnalysisStage");
  });

  it("unlockDevAnalysisStage should set status to generated", () => {
    const funcStart = dbCode.indexOf("async function unlockDevAnalysisStage");
    const funcEnd = dbCode.indexOf("}", funcStart + 100);
    const funcBody = dbCode.slice(funcStart, funcEnd + 1);
    expect(funcBody).toContain('status: "generated"');
  });

  it("unlockDevAnalysisStage should clear confirmedAt", () => {
    const funcStart = dbCode.indexOf("async function unlockDevAnalysisStage");
    const funcEnd = dbCode.indexOf("}", funcStart + 100);
    const funcBody = dbCode.slice(funcStart, funcEnd + 1);
    expect(funcBody).toContain("confirmedAt: null");
  });
});

// ─── Test: Stage Unlock Router Endpoint ─────────────────────────
describe("Stage Unlock - Router Endpoint", () => {
  const routerPath = path.join(__dirname, "routers/devAnalysis.ts");
  const routerCode = fs.readFileSync(routerPath, "utf-8");

  it("should have unlockStage endpoint", () => {
    expect(routerCode).toContain("unlockStage:");
  });

  it("unlockStage should accept projectId and stageType", () => {
    const unlockSection = routerCode.slice(routerCode.indexOf("unlockStage:"));
    expect(unlockSection).toContain("projectId: z.number()");
    expect(unlockSection).toContain("stageType: z.enum(STAGE_TYPES)");
  });

  it("unlockStage should call unlockDevAnalysisStage", () => {
    const unlockSection = routerCode.slice(routerCode.indexOf("unlockStage:"));
    expect(unlockSection).toContain("unlockDevAnalysisStage");
  });
});

// ─── Test: Frontend Data Upload Component ───────────────────────
describe("Frontend - DevDataUpload Component", () => {
  const componentPath = path.join(__dirname, "../client/src/pages/dev/DevDataUpload.tsx");
  const component = fs.readFileSync(componentPath, "utf-8");

  it("should use confirmData mutation", () => {
    expect(component).toContain("trpc.devProject.confirmData.useMutation");
  });

  it("should use unconfirmData mutation", () => {
    expect(component).toContain("trpc.devProject.unconfirmData.useMutation");
  });

  it("should use getDataStatus query", () => {
    expect(component).toContain("trpc.devProject.getDataStatus.useQuery");
  });

  it("should show confirm save button", () => {
    expect(component).toContain("确认保存为基础数据");
  });

  it("should show cancel confirm button for confirmed data", () => {
    expect(component).toContain("取消确认");
  });

  it("should show confirmation progress", () => {
    expect(component).toContain("数据确认进度");
  });

  it("should support all 4 file types", () => {
    expect(component).toContain('"sales"');
    expect(component).toContain('"bullet_points"');
    expect(component).toContain('"reviews"');
    expect(component).toContain('"history_sales"');
  });

  it("should support batch upload for reviews", () => {
    expect(component).toContain("handleBatchFileSelect");
    expect(component).toContain("multiple: true");
  });
});

// ─── Test: Frontend Analysis Flow - Unlock Button ───────────────
describe("Frontend - DevAnalysisFlow Unlock", () => {
  const flowPath = path.join(__dirname, "../client/src/pages/dev/DevAnalysisFlow.tsx");
  const flow = fs.readFileSync(flowPath, "utf-8");

  it("should use unlockStage mutation", () => {
    expect(flow).toContain("trpc.devAnalysis.unlockStage.useMutation");
  });

  it("should show unlock button for confirmed stages", () => {
    expect(flow).toContain("解锁重新分析");
  });

  it("should have confirmation dialog before unlock", () => {
    expect(flow).toContain("window.confirm");
    expect(flow).toContain("解锁后可重新分析或编辑此阶段结果");
  });

  it("should import Unlock icon", () => {
    expect(flow).toContain("Unlock");
  });

  it("should still show lock status for confirmed stages", () => {
    expect(flow).toContain("此阶段已确认锁定");
  });

  it("should show confirmed timestamp", () => {
    expect(flow).toContain("stageData?.confirmedAt");
  });
});
