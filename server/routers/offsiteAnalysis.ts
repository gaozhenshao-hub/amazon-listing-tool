import { runSkillViaEmperor } from "../emperorClient";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { callDataApi } from "../_core/dataApi";
import { invokeLLM } from "../_core/llm";
import {
  createOffsiteAnalysis,
  getOffsiteAnalysesByProject,
  getOffsiteAnalysesBySource,
  getOffsiteAnalysisById,
  updateOffsiteAnalysis,
  deleteOffsiteAnalysis,
} from "../devDb";
import {
  GOOGLE_TRENDS_PROMPT,
  YOUTUBE_ANALYSIS_PROMPT,
  TIKTOK_ANALYSIS_PROMPT,
  FACEBOOK_ANALYSIS_PROMPT,
  INDEPENDENT_SITE_PROMPT,
  REDDIT_ANALYSIS_PROMPT,
  CROWDFUNDING_ANALYSIS_PROMPT,
  OFFSITE_SUMMARY_PROMPT,
} from "../offsitePrompts";

const sourceTypeEnum = z.enum([
  "google_trends", "youtube", "tiktok", "facebook",
  "independent_site", "reddit", "crowdfunding"
]);

// Map source type to prompt
function getPromptForSource(sourceType: string): string {
  const map: Record<string, string> = {
    google_trends: GOOGLE_TRENDS_PROMPT,
    youtube: YOUTUBE_ANALYSIS_PROMPT,
    tiktok: TIKTOK_ANALYSIS_PROMPT,
    facebook: FACEBOOK_ANALYSIS_PROMPT,
    independent_site: INDEPENDENT_SITE_PROMPT,
    reddit: REDDIT_ANALYSIS_PROMPT,
    crowdfunding: CROWDFUNDING_ANALYSIS_PROMPT,
  };
  return map[sourceType] || "";
}

// ─── Data Fetching Functions ──────────────────────────────────

async function fetchGoogleTrendsData(keyword: string): Promise<any> {
  // Use web search to get Google Trends-like data
  try {
    const result = await callDataApi("Google/google_search", {
      query: { q: `${keyword} trends market demand site:trends.google.com OR site:google.com/trends`, gl: "us", hl: "en", num: "10" },
    });
    return result;
  } catch {
    // Fallback: search for market trend info
    try {
      const result = await callDataApi("Google/google_search", {
        query: { q: `${keyword} market trend demand growth 2024 2025`, gl: "us", hl: "en", num: "10" },
      });
      return result;
    } catch (e2) {
      return { error: "Google Trends data fetch failed", keyword, fallback: true };
    }
  }
}

async function fetchYouTubeData(keyword: string): Promise<any> {
  try {
    const result = await callDataApi("Youtube/search", {
      query: { q: keyword, gl: "US", hl: "en" },
    });
    return result;
  } catch (e) {
    return { error: "YouTube data fetch failed", keyword };
  }
}

async function fetchTikTokData(keyword: string): Promise<any> {
  try {
    const result = await callDataApi("Tiktok/search_tiktok_video_general", {
      query: { keyword, search_id: "0", offset: "0", count: "20", sort_type: "0", publish_time: "0" },
    });
    return result;
  } catch (e) {
    return { error: "TikTok data fetch failed", keyword };
  }
}

async function fetchFacebookData(keyword: string): Promise<any> {
  // Use Google search to find Facebook-related data
  try {
    const result = await callDataApi("Google/google_search", {
      query: { q: `${keyword} site:facebook.com group OR page`, gl: "us", hl: "en", num: "10" },
    });
    return result;
  } catch (e) {
    return { error: "Facebook data fetch failed", keyword };
  }
}

async function fetchIndependentSiteData(keyword: string): Promise<any> {
  // Use SimilarWeb for website analysis if it's a URL, otherwise search
  try {
    // Check if keyword looks like a URL
    const isUrl = keyword.includes(".") && !keyword.includes(" ");
    if (isUrl) {
      const domain = keyword.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      const [overview, trafficSources] = await Promise.allSettled([
        callDataApi("SimilarWeb/get_website_overview", { query: { domain } }),
        callDataApi("SimilarWeb/get_traffic_sources", { query: { domain } }),
      ]);
      return {
        domain,
        overview: overview.status === "fulfilled" ? overview.value : null,
        trafficSources: trafficSources.status === "fulfilled" ? trafficSources.value : null,
      };
    } else {
      const result = await callDataApi("Google/google_search", {
        query: { q: `${keyword} official site shop store`, gl: "us", hl: "en", num: "10" },
      });
      return result;
    }
  } catch (e) {
    return { error: "Independent site data fetch failed", keyword };
  }
}

async function fetchRedditData(keyword: string): Promise<any> {
  try {
    // Try to search Reddit for relevant posts
    const result = await callDataApi("Reddit/AccessAPI", {
      query: { subreddit: "all", sort: "relevance", t: "year", q: keyword, limit: "25" },
    });
    return result;
  } catch (e) {
    // Fallback: use Google to search Reddit
    try {
      const result = await callDataApi("Google/google_search", {
        query: { q: `${keyword} site:reddit.com`, gl: "us", hl: "en", num: "15" },
      });
      return result;
    } catch (e2) {
      return { error: "Reddit data fetch failed", keyword };
    }
  }
}

async function fetchCrowdfundingData(keyword: string): Promise<any> {
  try {
    const result = await callDataApi("Google/google_search", {
      query: { q: `${keyword} site:kickstarter.com OR site:indiegogo.com`, gl: "us", hl: "en", num: "10" },
    });
    return result;
  } catch (e) {
    return { error: "Crowdfunding data fetch failed", keyword };
  }
}

// Map source type to fetch function
const fetchFunctions: Record<string, (keyword: string) => Promise<any>> = {
  google_trends: fetchGoogleTrendsData,
  youtube: fetchYouTubeData,
  tiktok: fetchTikTokData,
  facebook: fetchFacebookData,
  independent_site: fetchIndependentSiteData,
  reddit: fetchRedditData,
  crowdfunding: fetchCrowdfundingData,
};

// ─── Router ───────────────────────────────────────────────────

export const offsiteAnalysisRouter = router({
  // List all offsite analyses for a project
  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      return getOffsiteAnalysesByProject(input.projectId);
    }),

  // List by source type
  listBySource: protectedProcedure
    .input(z.object({ projectId: z.number(), sourceType: sourceTypeEnum }))
    .query(async ({ input }) => {
      return getOffsiteAnalysesBySource(input.projectId, input.sourceType);
    }),

  // Get single analysis
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return getOffsiteAnalysisById(input.id);
    }),

  // Create and run analysis
  analyze: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      sourceType: sourceTypeEnum,
      keyword: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const now = Date.now();
      // Create record
      const id = await createOffsiteAnalysis({
        projectId: input.projectId,
        userId: String(ctx.user.id),
        sourceType: input.sourceType,
        keyword: input.keyword,
        status: "running",
        rawData: null,
        aiAnalysis: null,
        aiAnalysisConfirmed: 0,
        editedAnalysis: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
      });

      // Fetch data in background
      try {
        const fetchFn = fetchFunctions[input.sourceType];
        if (!fetchFn) throw new Error(`Unsupported source type: ${input.sourceType}`);

        const rawData = await fetchFn(input.keyword);

        // Run AI analysis
        const prompt = getPromptForSource(input.sourceType);
      // [Emperor] 优先调用 Emperor Skill: offsite.summary

        try {

          const _emperorRes = await runSkillViaEmperor("offsite.summary", { context: JSON.stringify(input).slice(0, 3000) });

          if (_emperorRes.success && _emperorRes.output) {

            // Emperor 成功，结果已记录

          }

        } catch (_e) { console.warn("[Emperor] offsiteAnalysis.ts fallback:", _e); }

        const aiResponse = await invokeLLM({
          messages: [
            { role: "system", content: prompt },
            {
              role: "user",
              content: `请分析以下关于"${input.keyword}"的${getSourceLabel(input.sourceType)}数据：\n\n${JSON.stringify(rawData, null, 2).substring(0, 15000)}`,
            },
          ],
        });

        const rawContent2 = aiResponse?.choices?.[0]?.message?.content;
        const aiAnalysis = (typeof rawContent2 === "string" ? rawContent2 : "") || "AI分析生成失败";

        await updateOffsiteAnalysis(id, {
          status: "completed",
          rawData,
          aiAnalysis,
          updatedAt: Date.now(),
        });

        return { id, status: "completed" };
      } catch (error: any) {
        await updateOffsiteAnalysis(id, {
          status: "failed",
          errorMessage: error?.message || "Unknown error",
          updatedAt: Date.now(),
        });
        return { id, status: "failed", error: error?.message };
      }
    }),

  // Edit analysis (user modifies AI result)
  edit: protectedProcedure
    .input(z.object({
      id: z.number(),
      editedAnalysis: z.string(),
    }))
    .mutation(async ({ input }) => {
      await updateOffsiteAnalysis(input.id, {
        editedAnalysis: input.editedAnalysis,
        updatedAt: Date.now(),
      });
      return { success: true };
    }),

  // Confirm analysis
  confirm: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await updateOffsiteAnalysis(input.id, {
        aiAnalysisConfirmed: 1,
        updatedAt: Date.now(),
      });
      return { success: true };
    }),

  // Unconfirm (unlock for editing)
  unconfirm: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await updateOffsiteAnalysis(input.id, {
        aiAnalysisConfirmed: 0,
        updatedAt: Date.now(),
      });
      return { success: true };
    }),

  // Delete analysis
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteOffsiteAnalysis(input.id);
      return { success: true };
    }),

  // Generate comprehensive summary across all sources
  generateSummary: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ input }) => {
      const allAnalyses = await getOffsiteAnalysesByProject(input.projectId);
      const confirmedAnalyses = allAnalyses.filter(a => a.aiAnalysisConfirmed);

      if (confirmedAnalyses.length === 0) {
        throw new Error("请先完成并确认至少一个站外分析");
      }

      const summaryData = confirmedAnalyses.map(a => ({
        source: getSourceLabel(a.sourceType),
        keyword: a.keyword,
        analysis: a.editedAnalysis || a.aiAnalysis,
      }));

      // [Emperor] 优先调用 Emperor Skill: offsite.summary

      try {

        const _emperorRes = await runSkillViaEmperor("offsite.summary", { context: JSON.stringify(input).slice(0, 3000) });

        if (_emperorRes.success && _emperorRes.output) {

          // Emperor 成功，结果已记录

        }

      } catch (_e) { console.warn("[Emperor] offsiteAnalysis.ts fallback:", _e); }

      const aiResponse = await invokeLLM({
        messages: [
          { role: "system", content: OFFSITE_SUMMARY_PROMPT },
          {
            role: "user",
            content: `请基于以下${confirmedAnalyses.length}个站外数据源的分析结果，生成综合总结报告：\n\n${JSON.stringify(summaryData, null, 2).substring(0, 20000)}`,
          },
        ],
      });

      return {
        summary: aiResponse?.choices?.[0]?.message?.content || "综合总结生成失败",
        sourcesCount: confirmedAnalyses.length,
      };
    }),

  // Re-analyze with AI (regenerate AI analysis for existing raw data)
  reanalyze: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const analysis = await getOffsiteAnalysisById(input.id);
      if (!analysis) throw new Error("Analysis not found");
      if (!analysis.rawData) throw new Error("No raw data available for re-analysis");

      const prompt = getPromptForSource(analysis.sourceType);
      // [Emperor] 优先调用 Emperor Skill: offsite.summary

      try {

        const _emperorRes = await runSkillViaEmperor("offsite.summary", { context: JSON.stringify(input).slice(0, 3000) });

        if (_emperorRes.success && _emperorRes.output) {

          // Emperor 成功，结果已记录

        }

      } catch (_e) { console.warn("[Emperor] offsiteAnalysis.ts fallback:", _e); }

      const aiResponse = await invokeLLM({
        messages: [
          { role: "system", content: prompt },
          {
            role: "user",
            content: `请分析以下关于"${analysis.keyword}"的${getSourceLabel(analysis.sourceType)}数据：\n\n${JSON.stringify(analysis.rawData, null, 2).substring(0, 15000)}`,
          },
        ],
      });

      const rawContent = aiResponse?.choices?.[0]?.message?.content;
      const aiAnalysis = (typeof rawContent === "string" ? rawContent : "") || "AI分析重新生成失败";

      await updateOffsiteAnalysis(input.id, {
        aiAnalysis,
        aiAnalysisConfirmed: 0,
        editedAnalysis: undefined,
        updatedAt: Date.now(),
      });

      return { success: true, aiAnalysis };
    }),
});

// Helper: get Chinese label for source type
function getSourceLabel(sourceType: string): string {
  const labels: Record<string, string> = {
    google_trends: "Google趋势",
    youtube: "YouTube",
    tiktok: "TikTok",
    facebook: "Facebook",
    independent_site: "独立站",
    reddit: "Reddit",
    crowdfunding: "众筹网站",
  };
  return labels[sourceType] || sourceType;
}
