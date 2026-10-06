import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const dbSource = readFileSync(new URL("./kbDb.ts", import.meta.url), "utf8");
const skillsSource = readFileSync(new URL("./routers/kbSkills.ts", import.meta.url), "utf8");
const videosSource = readFileSync(new URL("./routers/kbVideos.ts", import.meta.url), "utf8");
const searchSource = readFileSync(new URL("./routers/kbSearch.ts", import.meta.url), "utf8");
const workspaceProcedureSource = readFileSync(new URL("./domains/ai_os/workspaceScopedProcedure.ts", import.meta.url), "utf8");

describe("knowledge-base workspace scope contract", () => {
  it("uses the shared knowledge authorization procedure, which rejects a missing workspace before resolver execution", () => {
    for (const source of [skillsSource, videosSource, searchSource]) {
      expect(source).toContain('const protectedProcedure = workspaceScopedProcedure("knowledge")');
    }
    expect(workspaceProcedureSource).toContain("当前用户尚未绑定工作空间");
    expect(workspaceProcedureSource).toContain("assertResourceAction");
  });

  it("propagates the authenticated workspace into every affected list, search, stats, and RAG call", () => {
    expect(skillsSource).toContain('listOperationSkills(ctx.user.id, ctx.workspaceId!, input?.scope ?? "mine")');
    expect(skillsSource).toContain('listOperationSkills(ctx.user.id, ctx.workspaceId!, "mine")');
    expect(videosSource).toContain('listVideos(ctx.user.id, ctx.workspaceId!, input?.scope ?? "mine")');

    for (const call of [
      'searchKnowledgeBase(ctx.user.id, ctx.workspaceId!, input.query, input.scope ?? "mine")',
      'searchKnowledgeBase(ctx.user.id, ctx.workspaceId!, asin, input.scope ?? "mine")',
      'getKbStats(ctx.user.id, ctx.workspaceId!, input?.scope ?? "mine")',
      'searchKnowledgeBase(ctx.user.id, ctx.workspaceId!, input.query, "shared")',
      'searchKnowledgeBase(ctx.user.id, ctx.workspaceId!, "", "shared")',
    ]) {
      expect(searchSource).toContain(call);
    }
  });

  it("writes new Skills and Videos with the authenticated workspace and keeps later owner writes in that workspace", () => {
    expect(skillsSource).toContain("workspaceId: ctx.workspaceId!");
    expect(skillsSource).toContain("updateOperationSkill(Number(id), ctx.user.id, ctx.workspaceId!");
    expect(skillsSource).toContain("deleteOperationSkill(input.id, ctx.user.id, ctx.workspaceId!)");
    expect(videosSource).toContain("workspaceId: ctx.workspaceId!");
    expect(videosSource).toContain("updateVideo(Number(id), ctx.user.id, ctx.workspaceId!");
    expect(videosSource).toContain("findVideoByAsin(asin, ctx.workspaceId!)");
    expect(videosSource).toContain("deleteVideo(input.id, ctx.user.id, ctx.workspaceId!)");
  });

  it("limits shared and all database scopes to the requested workspace without exposing other users' drafts", () => {
    expect(dbSource).toContain("const workspace = eq(table.workspaceId, workspaceId)");
    expect(dbSource).toContain('const shared = and(eq(table.status, "confirmed"), ne(table.visibility, "private"))');
    expect(dbSource).toContain("return and(workspace, or(eq(table.userId, userId), shared))");
    expect(dbSource).toContain("searchKnowledgeBase(userId: number, workspaceId: number");
    expect(dbSource).toContain("getKbStats(userId: number, workspaceId: number");
  });
});
