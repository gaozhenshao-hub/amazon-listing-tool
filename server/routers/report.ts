import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

// ─── Report HTML Generator ──────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateReportHtml(
  project: any,
  listing: any,
  analysisSummary: {
    productAttributes: any;
    competitorAnalyses: any[];
    keywordSceneTags: any;
    keywordStrategyMatrix: any;
  }
): string {
  const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

  // Parse listing data
  let bulletPoints: any[] = [];
  let bulletPointsCn: any[] = [];
  let imageAdvice: any = null;

  try { bulletPoints = listing?.bulletPoints ? JSON.parse(listing.bulletPoints) : []; } catch {}
  try { bulletPointsCn = listing?.bulletPointsCn ? JSON.parse(listing.bulletPointsCn) : []; } catch {}
  try { imageAdvice = listing?.imageAdvice ? JSON.parse(listing.imageAdvice) : null; } catch {}

  // If bulletPoints is an object with .bulletPoints array
  if (bulletPoints && !Array.isArray(bulletPoints) && (bulletPoints as any).bulletPoints) {
    bulletPoints = (bulletPoints as any).bulletPoints;
  }
  if (bulletPointsCn && !Array.isArray(bulletPointsCn) && (bulletPointsCn as any).bulletPoints) {
    bulletPointsCn = (bulletPointsCn as any).bulletPoints;
  }

  const pa = analysisSummary.productAttributes;
  const analyses = analysisSummary.competitorAnalyses || [];
  const sceneTags = analysisSummary.keywordSceneTags;
  const strategyMatrix = analysisSummary.keywordStrategyMatrix;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(project.name)} - Amazon Listing 完整报告</title>
<style>
  @page { margin: 15mm; size: A4; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 11px; line-height: 1.6; color: #1a1a1a; background: #fff; }
  .page-break { page-break-before: always; }
  h1 { font-size: 22px; color: #8B4513; border-bottom: 3px solid #8B4513; padding-bottom: 8px; margin-bottom: 16px; }
  h2 { font-size: 16px; color: #A0522D; margin: 20px 0 10px; padding: 6px 12px; background: #FFF8F0; border-left: 4px solid #D2691E; }
  h3 { font-size: 13px; color: #555; margin: 12px 0 6px; }
  .header { text-align: center; padding: 20px 0; border-bottom: 2px solid #D2691E; margin-bottom: 20px; }
  .header h1 { border: none; margin: 0; font-size: 26px; }
  .header .subtitle { color: #666; font-size: 12px; margin-top: 6px; }
  .meta-row { display: flex; gap: 20px; margin-bottom: 16px; flex-wrap: wrap; }
  .meta-item { background: #f9f5f0; padding: 8px 14px; border-radius: 6px; font-size: 11px; }
  .meta-item strong { color: #8B4513; }
  .bilingual { display: flex; gap: 16px; margin: 10px 0; }
  .bilingual .col { flex: 1; min-width: 0; }
  .bilingual .col-en { border-right: 1px solid #e5e5e5; padding-right: 16px; }
  .bilingual .col-cn { padding-left: 0; }
  .col-header { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #999; letter-spacing: 1px; margin-bottom: 6px; }
  .content-box { background: #fafafa; border: 1px solid #eee; border-radius: 6px; padding: 12px; margin: 8px 0; }
  .bullet-item { margin-bottom: 10px; padding: 8px; background: #fff; border: 1px solid #f0f0f0; border-radius: 4px; }
  .bullet-subtitle { font-weight: 700; color: #333; font-size: 11px; }
  .bullet-text { color: #555; font-size: 10.5px; margin-top: 2px; }
  .char-count { font-size: 9px; color: #999; margin-top: 2px; }
  .tag { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 10px; margin: 2px; border: 1px solid #ddd; }
  .tag-blue { background: #EBF5FF; color: #1E40AF; border-color: #93C5FD; }
  .tag-green { background: #ECFDF5; color: #065F46; border-color: #6EE7B7; }
  .tag-purple { background: #F5F3FF; color: #5B21B6; border-color: #C4B5FD; }
  .tag-amber { background: #FFFBEB; color: #92400E; border-color: #FCD34D; }
  .tag-red { background: #FEF2F2; color: #991B1B; border-color: #FCA5A5; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 10.5px; }
  th, td { padding: 6px 10px; text-align: left; border: 1px solid #e5e5e5; }
  th { background: #f5f0eb; color: #8B4513; font-weight: 600; }
  .section { margin-bottom: 16px; }
  .footer { text-align: center; color: #999; font-size: 10px; margin-top: 30px; padding-top: 10px; border-top: 1px solid #eee; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 10px; font-size: 9px; font-weight: 600; }
  .badge-high { background: #FEE2E2; color: #991B1B; }
  .badge-medium { background: #FEF3C7; color: #92400E; }
  .badge-low { background: #F3F4F6; color: #6B7280; }
</style>
</head>
<body>

<div class="header">
  <h1>${escapeHtml(project.name)} — Amazon Listing 完整报告</h1>
  <div class="subtitle">
    品牌: ${escapeHtml(project.brand || "N/A")} | 类目: ${escapeHtml(project.category || "N/A")} | 市场: ${escapeHtml(project.targetMarket || "US")} | 生成时间: ${now}
  </div>
</div>

${listing ? `
<!-- ═══ SECTION 1: LISTING BILINGUAL ═══ -->
<h2>一、Listing 内容 (中英文对比)</h2>

<h3>1.1 标题 Title</h3>
<div class="bilingual">
  <div class="col col-en">
    <div class="col-header">English</div>
    <div class="content-box">${escapeHtml(listing.title || "")}</div>
    <div class="char-count">${(listing.title || "").length} characters</div>
  </div>
  <div class="col col-cn">
    <div class="col-header">中文</div>
    <div class="content-box">${escapeHtml(listing.titleCn || "暂无中文翻译")}</div>
  </div>
</div>

<h3>1.2 五点描述 Bullet Points</h3>
${(Array.isArray(bulletPoints) ? bulletPoints : []).map((bp: any, i: number) => {
  const cnBp = bulletPointsCn?.[i];
  const combined = bp.subtitle && bp.fullText ? `${bp.subtitle} ${bp.fullText}` : bp.fullText || bp.subtitle || bp;
  const cnCombined = cnBp ? (cnBp.subtitle && cnBp.fullText ? `${cnBp.subtitle} ${cnBp.fullText}` : cnBp.fullText || cnBp.subtitle || cnBp) : "暂无中文翻译";
  return `
  <div class="bilingual">
    <div class="col col-en">
      ${i === 0 ? '<div class="col-header">English</div>' : ''}
      <div class="bullet-item">
        <div class="bullet-subtitle">Bullet ${i + 1}${bp.subtitle ? `: ${escapeHtml(String(bp.subtitle))}` : ''}</div>
        <div class="bullet-text">${escapeHtml(String(typeof combined === 'string' ? combined : JSON.stringify(combined)))}</div>
        <div class="char-count">${String(combined).length} chars</div>
      </div>
    </div>
    <div class="col col-cn">
      ${i === 0 ? '<div class="col-header">中文</div>' : ''}
      <div class="bullet-item">
        <div class="bullet-subtitle">要点 ${i + 1}${cnBp?.subtitle ? `: ${escapeHtml(String(cnBp.subtitle))}` : ''}</div>
        <div class="bullet-text">${escapeHtml(String(typeof cnCombined === 'string' ? cnCombined : JSON.stringify(cnCombined)))}</div>
      </div>
    </div>
  </div>`;
}).join("")}

<h3>1.3 产品描述 Description</h3>
<div class="bilingual">
  <div class="col col-en">
    <div class="col-header">English</div>
    <div class="content-box">${escapeHtml(listing.description || "")}</div>
  </div>
  <div class="col col-cn">
    <div class="col-header">中文</div>
    <div class="content-box">${escapeHtml(listing.descriptionCn || "暂无中文翻译")}</div>
  </div>
</div>

<h3>1.4 后台搜索词 Search Terms</h3>
<div class="bilingual">
  <div class="col col-en">
    <div class="col-header">English</div>
    <div class="content-box">${escapeHtml(listing.searchTerms || "")}</div>
  </div>
  <div class="col col-cn">
    <div class="col-header">中文</div>
    <div class="content-box">${escapeHtml(listing.searchTermsCn || "暂无中文翻译")}</div>
  </div>
</div>

${imageAdvice ? `
<h3>1.5 图片建议 Image Advice</h3>
<div class="content-box">
  ${imageAdvice.mainImage ? `<p><strong>主图建议:</strong> ${escapeHtml(typeof imageAdvice.mainImage === 'string' ? imageAdvice.mainImage : JSON.stringify(imageAdvice.mainImage))}</p>` : ''}
  ${imageAdvice.subImages?.length ? `<p><strong>副图建议:</strong></p><ul>${imageAdvice.subImages.map((s: any) => `<li>${escapeHtml(typeof s === 'string' ? s : s.description || JSON.stringify(s))}</li>`).join('')}</ul>` : ''}
  ${imageAdvice.aPlusContent ? `<p><strong>A+内容建议:</strong> ${escapeHtml(typeof imageAdvice.aPlusContent === 'string' ? imageAdvice.aPlusContent : JSON.stringify(imageAdvice.aPlusContent))}</p>` : ''}
</div>
` : ''}
` : '<p style="color:#999;">暂未生成Listing内容</p>'}

<div class="page-break"></div>

<!-- ═══ SECTION 2: ANALYSIS MODULES ═══ -->
<h2>二、四大分析模块结果</h2>

${pa ? `
<h3>2.1 Module 1: Rufus 属性提取</h3>
<div class="section">
  ${pa.uniqueSellingPoints?.length ? `
    <p><strong>独特卖点 (USP):</strong></p>
    <div>${pa.uniqueSellingPoints.map((u: string) => `<span class="tag tag-blue">${escapeHtml(u)}</span>`).join(' ')}</div>
  ` : ''}
  ${pa.coreSpecs?.length ? `
    <p style="margin-top:8px;"><strong>核心规格:</strong></p>
    <table>
      <tr><th>属性</th><th>值</th></tr>
      ${pa.coreSpecs.map((s: any) => `<tr><td>${escapeHtml(s.attribute || '')}</td><td>${escapeHtml(s.value || '')}</td></tr>`).join('')}
    </table>
  ` : ''}
  ${pa.rufusFriendlyAttributes?.length ? `
    <p style="margin-top:8px;"><strong>Rufus友好属性:</strong></p>
    <div>${pa.rufusFriendlyAttributes.map((a: string) => `<span class="tag tag-green">${escapeHtml(a)}</span>`).join(' ')}</div>
  ` : ''}
  ${pa.suggestedKeywordsFromAttributes?.length ? `
    <p style="margin-top:8px;"><strong>建议关键词:</strong></p>
    <div>${pa.suggestedKeywordsFromAttributes.map((k: string) => `<span class="tag tag-amber">${escapeHtml(k)}</span>`).join(' ')}</div>
  ` : ''}
</div>
` : '<div class="section"><p style="color:#999;">未上传本品属性表</p></div>'}

${analyses.length > 0 ? `
<h3>2.2 Module 2: 多竞品格局分析 (基于竞品分析模块)</h3>
<div class="section">
  <p><strong>已分析竞品数量: ${analyses.length}</strong></p>
  <table>
    <tr><th>ASIN</th><th>标题</th><th>价格</th><th>评分</th><th>评论数</th></tr>
    ${analyses.map((a: any) => `<tr>
      <td>${escapeHtml(a.asin || '')}</td>
      <td>${escapeHtml((a.title || '').substring(0, 60))}${(a.title || '').length > 60 ? '...' : ''}</td>
      <td>${escapeHtml(a.price ? '$' + a.price : 'N/A')}</td>
      <td>${escapeHtml(a.rating ? String(a.rating) : 'N/A')}</td>
      <td>${escapeHtml(a.reviewCount ? String(a.reviewCount) : 'N/A')}</td>
    </tr>`).join('')}
  </table>

  ${(() => {
    // Extract parity (common selling points across competitors)
    const allSellingPoints: Record<string, number> = {};
    const allPainPoints: string[] = [];
    const allDelightPoints: string[] = [];
    
    for (const analysis of analyses) {
      if (analysis.bulletPoints) {
        try {
          const bps = JSON.parse(analysis.bulletPoints);
          if (Array.isArray(bps)) {
            bps.forEach((bp: string) => {
              const key = String(bp).substring(0, 80).toLowerCase();
              allSellingPoints[key] = (allSellingPoints[key] || 0) + 1;
            });
          }
        } catch {}
      }
      if (analysis.reviewAnalysis) {
        try {
          const ra = JSON.parse(analysis.reviewAnalysis);
          if (ra.painPoints) allPainPoints.push(...ra.painPoints.map((p: any) => p.issue || p));
          if (ra.delightPoints) allDelightPoints.push(...ra.delightPoints.map((p: any) => p.feature || p));
        } catch {}
      }
    }

    const parityPoints = Object.entries(allSellingPoints)
      .filter(([_, count]) => count >= 2)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);

    const uniquePains = Array.from(new Set(allPainPoints)).slice(0, 8);
    const uniqueDelights = Array.from(new Set(allDelightPoints)).slice(0, 8);

    let html = '';
    if (parityPoints.length > 0) {
      html += `<p style="margin-top:12px;"><strong>共性卖点 (Parity - 多竞品共同强调):</strong></p>
      <table><tr><th>卖点</th><th>出现次数</th></tr>
      ${parityPoints.map(([point, count]) => `<tr><td>${escapeHtml(point)}</td><td>${count} 个竞品</td></tr>`).join('')}
      </table>`;
    }
    if (uniquePains.length > 0) {
      html += `<p style="margin-top:12px;"><strong>用户痛点 (来自竞品评论分析):</strong></p>
      <div>${uniquePains.map((p: string) => `<span class="tag tag-red">${escapeHtml(p)}</span>`).join(' ')}</div>`;
    }
    if (uniqueDelights.length > 0) {
      html += `<p style="margin-top:12px;"><strong>用户好评点 (来自竞品评论分析):</strong></p>
      <div>${uniqueDelights.map((d: string) => `<span class="tag tag-green">${escapeHtml(d)}</span>`).join(' ')}</div>`;
    }
    return html;
  })()}

  ${analyses.some((a: any) => a.keywords) ? `
    <p style="margin-top:12px;"><strong>竞品核心关键词:</strong></p>
    <table><tr><th>ASIN</th><th>核心关键词</th></tr>
    ${analyses.filter((a: any) => a.keywords).map((a: any) => {
      let kwStr = '';
      try {
        const kw = JSON.parse(a.keywords);
        if (kw.core) kwStr = kw.core.map((k: any) => k.keyword || k).join(', ');
        else if (Array.isArray(kw)) kwStr = kw.map((k: any) => k.keyword || k).join(', ');
      } catch { kwStr = a.keywords; }
      return `<tr><td>${escapeHtml(a.asin || '')}</td><td>${escapeHtml(kwStr)}</td></tr>`;
    }).join('')}
    </table>
  ` : ''}
</div>
` : '<div class="section"><p style="color:#999;">暂无竞品分析数据，请先在竞品分析页面分析竞品ASIN</p></div>'}

${sceneTags ? `
<h3>2.3 Module 3: COSMO 场景映射 (基于关键词场景打标)</h3>
<div class="section">
  ${sceneTags.sceneGroups && Object.keys(sceneTags.sceneGroups).length > 0 ? `
    <p><strong>使用场景聚类 (来自关键词AI场景打标):</strong></p>
    <table>
      <tr><th>场景</th><th>关键词数量</th><th>代表关键词</th></tr>
      ${Object.entries(sceneTags.sceneGroups)
        .sort(([, a]: any, [, b]: any) => (b as string[]).length - (a as string[]).length)
        .slice(0, 15)
        .map(([scene, kws]: [string, any]) => 
          `<tr><td>${escapeHtml(scene)}</td><td>${(kws as string[]).length}</td><td>${escapeHtml((kws as string[]).slice(0, 5).join(', '))}${(kws as string[]).length > 5 ? ` (+${(kws as string[]).length - 5} more)` : ''}</td></tr>`
        ).join('')}
    </table>
  ` : ''}
  ${sceneTags.intentGroups && Object.keys(sceneTags.intentGroups).length > 0 ? `
    <p style="margin-top:12px;"><strong>购买意图分组:</strong></p>
    <table>
      <tr><th>意图类型</th><th>关键词数量</th><th>代表关键词</th></tr>
      ${Object.entries(sceneTags.intentGroups)
        .map(([intent, kws]: [string, any]) => 
          `<tr><td>${escapeHtml(intent)}</td><td>${(kws as string[]).length}</td><td>${escapeHtml((kws as string[]).slice(0, 5).join(', '))}</td></tr>`
        ).join('')}
    </table>
  ` : ''}
  ${sceneTags.topScenes?.length ? `
    <p style="margin-top:8px;"><strong>Top场景:</strong></p>
    <div>${sceneTags.topScenes.map((t: string) => `<span class="tag tag-purple">${escapeHtml(t)}</span>`).join(' ')}</div>
  ` : ''}
</div>
` : '<div class="section"><p style="color:#999;">暂无场景打标数据，请先在关键词管理中运行COSMO场景打标</p></div>'}

${strategyMatrix ? `
<h3>2.4 Module 4: A9 关键词分级 (基于3D策略矩阵 + Listing布局建议)</h3>
<div class="section">
  ${strategyMatrix.strategyGroups && Object.keys(strategyMatrix.strategyGroups).length > 0 ? (() => {
    const categoryLabels: Record<string, string> = {
      core_main: "核心主词 (Core Main)",
      sub_core: "次核心词 (Sub-Core)",
      precise_longtail: "精准长尾词 (Precise Long-tail)",
      scene_intent: "场景意图词 (Scene Intent)",
      longtail_main: "长尾主词 (Long-tail Main)",
      observe_test: "观察测试词 (Observe/Test)",
    };
    return `<p><strong>3D策略矩阵分类:</strong></p>
    <table>
      <tr><th>策略分类</th><th>关键词数量</th><th>代表关键词</th></tr>
      ${Object.entries(categoryLabels).map(([cat, label]) => {
        const kws = strategyMatrix.strategyGroups[cat];
        if (!kws?.length) return '';
        return `<tr><td>${escapeHtml(label)}</td><td>${kws.length}</td><td>${escapeHtml(kws.slice(0, 8).join(', '))}${kws.length > 8 ? ` (+${kws.length - 8} more)` : ''}</td></tr>`;
      }).filter(Boolean).join('')}
    </table>`;
  })() : ''}

  ${strategyMatrix.placementGroups && Object.keys(strategyMatrix.placementGroups).length > 0 ? (() => {
    const placementLabels: Record<string, string> = {
      title_front: "标题前段 (Title Front)",
      title_mid: "标题中段 (Title Mid)",
      title_end: "标题尾段 (Title End)",
      bullet_first: "五点首行 (Bullet First)",
      bullet_body: "五点正文 (Bullet Body)",
      aplus: "A+内容 (A+ Content)",
      backend: "后台搜索词 (Backend)",
      ppc_only: "仅PPC投放 (PPC Only)",
    };
    return `<p style="margin-top:12px;"><strong>Listing关键词布局建议:</strong></p>
    <table>
      <tr><th>布局位置</th><th>关键词数量</th><th>关键词</th></tr>
      ${Object.entries(placementLabels).map(([placement, label]) => {
        const kws = strategyMatrix.placementGroups[placement];
        if (!kws?.length) return '';
        return `<tr><td>${escapeHtml(label)}</td><td>${kws.length}</td><td>${escapeHtml(kws.slice(0, 8).join(', '))}${kws.length > 8 ? ` (+${kws.length - 8} more)` : ''}</td></tr>`;
      }).filter(Boolean).join('')}
    </table>`;
  })() : ''}

  ${strategyMatrix.rootGroups && Object.keys(strategyMatrix.rootGroups).length > 0 ? (() => {
    const rootLabels: Record<string, string> = {
      core: "核心词根 (Core)",
      function: "功能词根 (Function)",
      scene: "场景词根 (Scene)",
      audience: "人群词根 (Audience)",
      spec: "规格词根 (Spec)",
      painpoint: "痛点词根 (Pain Point)",
      gift_holiday: "节日礼品词根 (Gift/Holiday)",
    };
    return `<p style="margin-top:12px;"><strong>关键词词根分类 (语义地图):</strong></p>
    <table>
      <tr><th>词根分类</th><th>关键词数量</th><th>关键词</th></tr>
      ${Object.entries(rootLabels).map(([root, label]) => {
        const kws = strategyMatrix.rootGroups[root];
        if (!kws?.length) return '';
        return `<tr><td>${escapeHtml(label)}</td><td>${kws.length}</td><td>${escapeHtml(kws.slice(0, 8).join(', '))}${kws.length > 8 ? ` (+${kws.length - 8} more)` : ''}</td></tr>`;
      }).filter(Boolean).join('')}
    </table>`;
  })() : ''}
</div>
` : '<div class="section"><p style="color:#999;">暂无A9关键词分级数据，请先在关键词管理中运行3D策略矩阵分析</p></div>'}

<div class="footer">
  Amazon Listing 智能生成工具 — 报告生成于 ${now}
</div>

</body>
</html>`;
}

// ─── Router ──────────────────────────────────────────────────────

export const reportRouter = router({
  // Generate full report data (returns HTML string for client-side PDF generation)
  generateReport: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      // Get active listing
      const listing = await db.getActiveListingByProject(input.projectId);

      // ─── Module 1: Rufus attributes from file analysis (unchanged) ───
      let productAttributes: any = null;
      const files = await db.getProjectFilesByProject(input.projectId);
      for (const file of files) {
        if (file.status !== "completed" || !file.analysisResult) continue;
        try {
          const result = JSON.parse(file.analysisResult);
          if (file.fileType === "product_attributes") {
            productAttributes = result;
          }
        } catch {}
      }

      // ─── Module 2: Competitor analyses from competitor analysis module ───
      const competitorAnalyses = await db.getCompetitorAnalysesByProject(input.projectId);

      // ─── Module 3 & 4: Keywords from keyword module ───
      const allKeywords = await db.getKeywordsByProject(input.projectId);
      
      let keywordSceneTags: any = null;
      let keywordStrategyMatrix: any = null;

      if (allKeywords.length > 0) {
        // Build scene tag groups (Module 3: COSMO scene mapping)
        const sceneGroups: Record<string, string[]> = {};
        const intentGroups: Record<string, string[]> = {};
        for (const kw of allKeywords) {
          if (kw.sceneTags) {
            try {
              const tags = JSON.parse(kw.sceneTags);
              if (Array.isArray(tags)) {
                tags.forEach((tag: string) => {
                  if (!sceneGroups[tag]) sceneGroups[tag] = [];
                  sceneGroups[tag].push(kw.keyword);
                });
              }
            } catch {}
          }
          if (kw.intentTag) {
            if (!intentGroups[kw.intentTag]) intentGroups[kw.intentTag] = [];
            intentGroups[kw.intentTag].push(kw.keyword);
          }
        }
        const topScenes = Object.entries(sceneGroups)
          .sort(([, a], [, b]) => b.length - a.length)
          .slice(0, 8)
          .map(([scene]) => scene);

        if (Object.keys(sceneGroups).length > 0 || Object.keys(intentGroups).length > 0) {
          keywordSceneTags = { sceneGroups, intentGroups, topScenes };
        }

        // Build strategy matrix groups and placement groups (Module 4: A9 keyword grading)
        const strategyGroups: Record<string, string[]> = {};
        const placementGroups: Record<string, string[]> = {};
        const rootGroups: Record<string, string[]> = {};
        for (const kw of allKeywords) {
          if (kw.strategyCategory && kw.strategyCategory !== "negative") {
            if (!strategyGroups[kw.strategyCategory]) strategyGroups[kw.strategyCategory] = [];
            strategyGroups[kw.strategyCategory].push(kw.keyword);
          }
          if (kw.listingPlacement) {
            if (!placementGroups[kw.listingPlacement]) placementGroups[kw.listingPlacement] = [];
            placementGroups[kw.listingPlacement].push(kw.keyword);
          }
          if (kw.rootCategory) {
            if (!rootGroups[kw.rootCategory]) rootGroups[kw.rootCategory] = [];
            rootGroups[kw.rootCategory].push(kw.keyword);
          }
        }

        if (Object.keys(strategyGroups).length > 0 || Object.keys(placementGroups).length > 0) {
          keywordStrategyMatrix = { strategyGroups, placementGroups, rootGroups };
        }
      }

      const analysisSummary = {
        productAttributes,
        competitorAnalyses,
        keywordSceneTags,
        keywordStrategyMatrix,
      };

      const html = generateReportHtml(project, listing, analysisSummary);

      return {
        html,
        projectName: project.name,
        hasListing: !!listing,
        hasAnalysis: !!(productAttributes || competitorAnalyses.length > 0 || keywordSceneTags || keywordStrategyMatrix),
      };
    }),
});
