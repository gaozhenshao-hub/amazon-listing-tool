// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildCompetitorResearchEvidencePlan } from "@shared/competitorResearchEvidence";
import { buildCompetitorReviewCorpus } from "../../../../server/domains/listing/services/competitorReviewCorpus";
import { createCompetitorDeepExecution, type DeepSkillPlan } from "../../../../server/domains/listing/services/competitorDeepExecution";
import { buildCompetitorDeepResult } from "../../../../server/domains/listing/services/competitorDeepResult";
import { parseCompetitorDeepResultView, type CompetitorDeepResultView } from "./competitorDeepResultView";
import CompetitorDeepResultPanel from "./CompetitorDeepResultPanel";

type View = Extract<CompetitorDeepResultView, { status: "available" }>;
const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const scope = { userId: 3, workspaceId: 7, projectId: 11, analysisId: 21, asin: "B000000001", revision: "f".repeat(64) };
const longOriginal = `Original positive review with exact prose. ${"unabridged ".repeat(150)}END`;
let saved: View;

// Build one real, fully validated synthetic view without a network, DB or model.
// Component tests then exercise display-only variants; the parser has its own
// independent hostile-input suite.
async function fixture(): Promise<View> {
  const bodies = [longOriginal, "Useful in camp", '<img src=x onerror=alert(1)> Literal review text', "Easy to carry", "Good light", "Switch is awkward", "Neutral description only"];
  const bytes = Buffer.from("ASIN,Review ID,Content,Rating\n" + bodies.map((body, index) => `${scope.asin},platform-${index},${body},${index === 5 ? 1 : 5}`).join("\n"));
  const fileName = `${scope.asin}.csv`, corpus = buildCompetitorReviewCorpus({ bytes, fileName, asin: scope.asin, projectId: 11, analysisId: 21, sourceFileHash: sha256(bytes) });
  const evidence = buildCompetitorResearchEvidencePlan({ identity: { userId: 3, workspaceId: 7, sourceWorkspaceId: 7, projectId: 11, analysisId: 21,
    asin: scope.asin, revision: "d".repeat(64) }, title: "Portable Light for camps", bullets: ["Long runtime in daily use"],
    reviews: { status: "available", corpus, source: { runId: "synthetic-original", fileName, fileHash: sha256(bytes) }, authorizedCorpusHash: "e".repeat(64) } }, sha256);
  const binding = { skillSlug: "synthetic-display", version: "1", status: "Released" as const, systemPromptHash: "a".repeat(16), userPromptHash: "b".repeat(16), manifestHash: "c".repeat(16) };
  const skills: DeepSkillPlan = { version: 1, authority: "user-primary", approvalRef: "synthetic-only-not-approved", title: binding, selling: binding,
    buyers_batch: binding, buyers_synthesis: binding, summary: binding };
  const kernel = createCompetitorDeepExecution(evidence, skills); let journal = kernel.initial();
  const quote = (sourceId: string, text: string, start = 0) => ({ sourceId, start, end: start + text.length, quote: text });
  const claim = (text: string, basis: "seller_claim" | "review_feedback" | "inference", references: string[]) => ({ text, basis, references });
  for (let index = 0; index < journal.steps.length; index++) await kernel.runNext({ read: async () => journal,
    compareAndSwap: async (_expected, value) => journal = value, assertCurrent: async () => undefined }, async request => {
    let raw: unknown;
    if (request.stage === "title") raw = { keywords: [{ text: "Light", zh: "灯", citation: quote("analysis:21:title", "Light", 9) }],
      modifiers: [{ text: "Portable", zh: "便携", citation: quote("analysis:21:title", "Portable") }],
      scenarios: [{ text: "camps", zh: "露营", citation: quote("analysis:21:title", "camps", 19) }], titleZh: "适合露营的便携灯" };
    else if (request.stage === "selling") raw = { points: [{ name: "Runtime", description: "Seller runtime claim", strength: "高",
      occurrences: [quote("analysis:21:bullet:1", "Long runtime in daily use")], goldenQuote: quote("analysis:21:bullet:1", "Long runtime in daily use") }],
    bulletTranslations: [{ sourceId: "analysis:21:bullet:1", zh: "日常使用续航长" }] };
    else if (request.stage.startsWith("buyers:")) {
      const items = evidence.reviews.batches[Number(request.stage.slice(7))].items;
      raw = { themes: items.slice(0, 6).map((review, i) => ({ name: `Theme ${i}`, sentiment: i === 5 ? "negative" : "positive", reviewIds: [review.reviewId],
        citations: [quote(`${review.reviewId}:body`, review.body)] })), noThemeReviewIds: [items[6].reviewId] };
    } else if (request.stage === "buyers_synthesis") raw = { groups: [
      { name: "Useful light", sentiment: "positive", themeIds: [1, 2, 3, 4, 5].map(i => `buyers:batch:0:theme:${i}`) },
      { name: "Awkward switch", sentiment: "negative", themeIds: ["buyers:batch:0:theme:6"] }],
    concerns: [{ question: "Is it easy to use?", status: "证据不足", explanation: "Inferred from review themes", themeIds: ["buyers:batch:0:theme:1", "buyers:batch:0:theme:6"] }] };
    else raw = { positioning: claim("A portable camping light", "seller_claim", ["title:keyword:1"]),
      advantages: [claim("Useful for some buyers", "review_feedback", ["buyers:group:1"])], weaknesses: [claim("Some buyers report an awkward switch", "review_feedback", ["buyers:group:2"])],
      learnings: [claim("Explain everyday runtime", "inference", ["selling:point:1"])], opportunities: [claim("Clarify switch operation", "inference", ["buyers:group:2"])] };
    return { raw, receipt: { runId: `synthetic-${request.stage}`, skillSlug: binding.skillSlug, skillVersion: binding.version,
      skillPromptHash: binding.systemPromptHash, skillManifestHash: binding.manifestHash, modelSlug: "synthetic-only" } };
  }, new AbortController().signal);
  const result = buildCompetitorDeepResult({ evidence, skills, journal, jobRunId: "synthetic-job", generatedAt: "2026-10-17T09:00:00.000Z" });
  const parsed = parseCompetitorDeepResultView({ status: "available", identity: { userId: 3, workspaceId: 7, sourceWorkspaceId: 7,
    projectId: 11, analysisId: 21, asin: scope.asin }, currentRevision: scope.revision, sourceChanged: false, reviewRequired: true, result }, scope);
  if (parsed.status !== "available") throw new Error("Expected available synthetic view");
  return parsed;
}
beforeAll(async () => { saved = await fixture(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("friend-structured four-section research presentation", () => {
  it("retains the four named sections and selling table columns in the friend's order", () => {
    render(<CompetitorDeepResultPanel view={saved} />);
    expect(screen.getAllByRole("heading", { level: 3 }).map(node => node.textContent)).toEqual(["标题分析", "卖点分析", "买家问题与评论分析", "总结分析"]);
    const table = screen.getByRole("table", { name: "卖点分析表" });
    expect(within(table).getAllByRole("columnheader").map(node => node.textContent)).toEqual(["卖点", "卖点描述", "表达强度", "频次", "位置", "金句"]);
    for (const label of ["主要关键词", "主要修饰词", "场景 / 适配词", "主要好评点", "主要差评点", "优势", "劣势", "值得借鉴的点", "可超越的点"]) expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
  });
  it("shows English originals, Chinese translations and exact-position citations without rewriting them", () => {
    render(<CompetitorDeepResultPanel view={saved} />);
    for (const text of ["Portable Light for camps", "适合露营的便携灯", "Light", "灯", "Portable", "便携", "camps", "露营", "日常使用续航长"]) expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Long runtime in daily use").length).toBeGreaterThan(1);
    expect(screen.getByText("analysis:21:title · 字符位置 [9, 14)")).toBeInTheDocument();
    expect(screen.getByText("Seller runtime claim")).toBeInTheDocument();
    expect(screen.getByText("高")).toBeInTheDocument(); expect(screen.getByText("1 个文字来源")).toBeInTheDocument();
    expect(screen.getByText(/频次仅按标题和五点原文中的独立表达位置统计/)).toHaveTextContent("不是评论提及次数");
  });
  it("uses the full imported denominator and labels representative samples separately", () => {
    render(<CompetitorDeepResultPanel view={saved} />);
    expect(screen.getByText(/本次导入样本共 7 条原评论/)).toHaveTextContent("好差评主题比例不必相加为 100%");
    expect(screen.getByText("71.4%")).toBeInTheDocument(); expect(screen.getByText("14.3%")).toBeInTheDocument();
    expect(screen.getByText(/1\. Useful light/)).toHaveTextContent("（5/7）");
    expect(screen.getByText(/本主题匹配 5 条/)).toHaveTextContent("另有 2 条未在此展示");
    expect(screen.getByText(/本主题匹配 5 条/)).toHaveTextContent("展示样例数不是统计分母");
    expect(screen.getByText(/未归入主题的已核对原评论（1 条）/)).toBeInTheDocument();
  });
  it("preserves complete review bodies and original/platform identities and file locations", () => {
    render(<CompetitorDeepResultPanel view={saved} />);
    expect(screen.getByText(longOriginal, { exact: true, normalizer: text => text })).toBeInTheDocument();
    expect(screen.getByText("平台评论编号：platform-0")).toBeInTheDocument();
    expect(screen.getByText("原文件位置：CSV · 第 2 行")).toBeInTheDocument();
    const body = screen.getByText(longOriginal, { exact: true, normalizer: text => text });
    expect(body).toHaveClass("whitespace-pre-wrap"); expect(body.closest("blockquote")).toHaveTextContent("原评论编号：review_");
    expect(body.textContent).toBe(longOriginal);
  });
  it("distinguishes inferred concerns, seller claims, buyer feedback and analysis inference", () => {
    render(<CompetitorDeepResultPanel view={saved} />);
    expect(screen.getByText(/以下关注点由评论主题推导/)).toHaveTextContent("不是真实问答");
    expect(screen.getByText("Is it easy to use?")).toBeInTheDocument(); expect(screen.getByText(/证据不足 · Inferred/)).toBeInTheDocument();
    for (const name of ["依据与引用 · 商家宣称", "依据与引用 · 评论反馈", "依据与引用 · 分析推断"]) expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    expect(screen.getByText("selling:point:1")).toBeInTheDocument();
    expect(screen.getByText("Clarify switch operation")).toBeInTheDocument();
  });
  it("always states the unconfirmed limited scope and has no confirmation or execution control", () => {
    const { container } = render(<CompetitorDeepResultPanel view={saved} />);
    expect(screen.getByText(/已保存研究候选 · 未确认/)).toBeInTheDocument();
    expect(screen.getByText(/范围仅限已保存的标题/)).toHaveTextContent("图片内容与 OCR、真实问答均未分析");
    expect(screen.getByText("候选结果，仅供复核；此处不确认或自动用于 Listing 生成。")).toBeInTheDocument();
    expect(screen.getByText(/四栏内容而自动标记完成或确认/)).toBeInTheDocument();
    expect(container.querySelectorAll("button,input,form,textarea,select")).toHaveLength(0);
    expect(container.textContent).not.toContain("已确认并保存"); expect(container.textContent).not.toContain("已读取 0 张图片");
  });
  it("labels source-changed results as historical rather than usable current conclusions", () => {
    render(<CompetitorDeepResultPanel view={{ ...saved, sourceChanged: true }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("历史候选，未确认，不能视为当前资料的分析结论");
    expect(screen.getByText("Portable Light for camps")).toBeInTheDocument();
  });
  it("does not show a stale warning for a source-matched candidate", () => {
    render(<CompetitorDeepResultPanel view={saved} />); expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("renders literal markup safely and creates no embedded images/scripts or external links", () => {
    const { container } = render(<CompetitorDeepResultPanel view={saved} />);
    expect(screen.getByText('<img src=x onerror=alert(1)> Literal review text')).toBeInTheDocument();
    expect(container.querySelectorAll("img,script,iframe,object,embed,a")).toHaveLength(0);
  });
  it("makes missing title and selling sources explicit without fabricating output", () => {
    const value = copy(saved); value.result.title.status = "missing"; value.result.title.titleZh = null;
    value.result.title.keywords = []; value.result.title.modifiers = []; value.result.title.scenarios = [];
    value.result.selling.status = "missing"; value.result.selling.points = []; value.result.selling.bulletTranslations = []; value.result.listingSources = [];
    render(<CompetitorDeepResultPanel view={value} />);
    expect(screen.getByText("标题原文未保存。")).toBeInTheDocument(); expect(screen.getByText("暂无已核对的标题译文。")).toBeInTheDocument();
    expect(screen.getByText(/标题与五点资料缺失/)).toBeInTheDocument(); expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("日常使用续航长")).not.toBeInTheDocument();
  });
  it("does not turn unavailable reviews or absent ratings into zero", () => {
    const value = copy(saved); value.result.coverage.reviews.status = "unavailable"; value.result.buyers.sampleCount = null;
    value.result.buyers.accountedReviewCount = null; value.result.buyers.groups = []; value.result.buyers.concerns = []; value.result.buyers.noThemeReviewIds = [];
    render(<CompetitorDeepResultPanel view={value} />);
    expect(screen.getByText(/原评论来源不可用/)).toHaveTextContent("样本总数未知，不能视为 0 条");
    expect(screen.queryByText(/本次导入样本共/)).not.toBeInTheDocument(); expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });
  it("distinguishes a verified zero-match imported sample from unknown reviews", () => {
    const value = copy(saved); value.result.buyers.sampleCount = 0; value.result.buyers.accountedReviewCount = 0; value.result.buyers.missingReason = "no_matching_reviews";
    value.result.buyers.groups = []; value.result.buyers.concerns = []; value.result.buyers.noThemeReviewIds = [];
    render(<CompetitorDeepResultPanel view={value} />);
    expect(screen.getByText(/本次导入样本共 0 条原评论/)).toBeInTheDocument(); expect(screen.getByText(/没有匹配当前 ASIN 的原评论/)).toBeInTheDocument();
    expect(screen.queryByText(/样本总数未知/)).not.toBeInTheDocument();
  });
  it("labels unknown ratings and missing optional review titles without adding fake facts", () => {
    const value = copy(saved); value.result.buyers.groups[0].evidence[0].rating = null; value.result.buyers.groups[0].evidence[0].title = null;
    render(<CompetitorDeepResultPanel view={value} />); expect(screen.getByText("评分：未知")).toBeInTheDocument(); expect(screen.queryByText("评分：0 / 5")).not.toBeInTheDocument();
  });
  it("retains all summary headings when a conclusion list is empty", () => {
    const value = copy(saved); value.result.summary.advantages = []; value.result.summary.weaknesses = []; value.result.summary.learnings = []; value.result.summary.opportunities = [];
    render(<CompetitorDeepResultPanel view={value} />);
    const section = screen.getByRole("region", { name: "总结分析" });
    expect(within(section).getAllByText("本次资料不足以形成此类结论。")).toHaveLength(4);
    expect(within(section).queryByText("无劣势")).not.toBeInTheDocument();
  });
  it("constrains long strings and restricts horizontal overflow to the selling table", () => {
    const value = copy(saved), long = "X".repeat(6000); value.result.selling.points[0].description = long;
    const { container } = render(<CompetitorDeepResultPanel view={value} />);
    expect(screen.getByTestId("competitor-deep-result-panel")).toHaveClass("min-w-0", "max-w-full", "[overflow-wrap:anywhere]");
    expect(screen.getByTestId("competitor-selling-table-scroll")).toHaveClass("min-w-0", "max-w-full", "overflow-x-auto");
    expect(screen.getByText(long)).toHaveClass("whitespace-pre-wrap", "[overflow-wrap:anywhere]");
    expect(container.querySelectorAll(".overflow-x-auto")).toHaveLength(1);
  });
  it("has no IO even during StrictMode, rerenders or disclosure clicks", () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network"));
    const { container, rerender } = render(<StrictMode><CompetitorDeepResultPanel view={saved} /></StrictMode>);
    for (const summary of container.querySelectorAll("summary")) fireEvent.click(summary);
    rerender(<StrictMode><CompetitorDeepResultPanel view={{ ...saved, sourceChanged: true }} /></StrictMode>);
    expect(fetch).not.toHaveBeenCalled();
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/listing/CompetitorDeepResultPanel.tsx"), "utf8");
    expect(source).not.toMatch(/dangerouslySetInnerHTML|\bfetch\s*\(|useQuery|useMutation|trpc|localStorage|sessionStorage/);
  });
});
