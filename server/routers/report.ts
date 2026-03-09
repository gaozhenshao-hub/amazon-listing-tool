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
  analysisSummary: any
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

  const pa = analysisSummary?.productAttributes;
  const cl = analysisSummary?.competitorListings;
  const cs = analysisSummary?.cosmoScenes;
  const a9 = analysisSummary?.a9Keywords;

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

${cl ? `
<h3>2.2 Module 2: 多竞品格局分析</h3>
<div class="section">
  ${cl.parityPoints?.length ? `
    <p><strong>共性卖点 (Parity):</strong></p>
    <table>
      <tr><th>卖点</th><th>频率</th><th>重要性</th></tr>
      ${cl.parityPoints.map((p: any) => `<tr><td>${escapeHtml(p.sellingPoint || '')}</td><td>${escapeHtml(p.frequency || '')}</td><td><span class="badge ${p.importance === 'must-have' ? 'badge-high' : p.importance === 'important' ? 'badge-medium' : 'badge-low'}">${escapeHtml(p.importance || '')}</span></td></tr>`).join('')}
    </table>
  ` : ''}
  ${cl.gapOpportunities?.length ? `
    <p style="margin-top:8px;"><strong>缺口机会 (Gap):</strong></p>
    <table>
      <tr><th>缺口</th><th>类型</th><th>机会等级</th></tr>
      ${cl.gapOpportunities.map((g: any) => `<tr><td>${escapeHtml(g.gap || '')}</td><td>${escapeHtml(g.type || '')}</td><td><span class="badge ${g.opportunityLevel === 'high' ? 'badge-high' : g.opportunityLevel === 'medium' ? 'badge-medium' : 'badge-low'}">${escapeHtml(g.opportunityLevel || '')}</span></td></tr>`).join('')}
    </table>
  ` : ''}
  ${cl.strategicRecommendations ? `
    <p style="margin-top:8px;"><strong>策略建议:</strong></p>
    ${cl.strategicRecommendations.mustInclude?.length ? `<p>必须包含: ${cl.strategicRecommendations.mustInclude.map((m: string) => `<span class="tag tag-red">${escapeHtml(m)}</span>`).join(' ')}</p>` : ''}
    ${cl.strategicRecommendations.differentiators?.length ? `<p>差异化: ${cl.strategicRecommendations.differentiators.map((d: string) => `<span class="tag tag-green">${escapeHtml(d)}</span>`).join(' ')}</p>` : ''}
  ` : ''}
</div>
` : '<div class="section"><p style="color:#999;">未上传竞品Listing文本</p></div>'}

${cs ? `
<h3>2.3 Module 3: COSMO 场景映射</h3>
<div class="section">
  ${cs.sceneClusters?.length ? `
    <p><strong>使用场景聚类:</strong></p>
    <table>
      <tr><th>场景</th><th>代表搜索词</th><th>搜索量占比</th></tr>
      ${cs.sceneClusters.map((s: any) => `<tr><td>${escapeHtml(s.sceneName || '')}</td><td>${escapeHtml((s.representativeTerms || []).join(', '))}</td><td>${escapeHtml(s.volumeShare || '')}</td></tr>`).join('')}
    </table>
  ` : ''}
  ${cs.topScenes?.length ? `
    <p style="margin-top:8px;"><strong>Top场景:</strong></p>
    <div>${cs.topScenes.map((t: string) => `<span class="tag tag-purple">${escapeHtml(t)}</span>`).join(' ')}</div>
  ` : ''}
</div>
` : '<div class="section"><p style="color:#999;">未上传竞品出单词报告</p></div>'}

${a9 ? `
<h3>2.4 Module 4: A9 关键词分级</h3>
<div class="section">
  ${a9.titleKeywords?.length ? `
    <p><strong>标题关键词 (Title Keywords):</strong></p>
    <div>${a9.titleKeywords.map((k: string) => `<span class="tag tag-red">${escapeHtml(k)}</span>`).join(' ')}</div>
  ` : ''}
  ${a9.bulletKeywords?.length ? `
    <p style="margin-top:8px;"><strong>五点关键词 (Bullet Keywords):</strong></p>
    <div>${a9.bulletKeywords.map((k: string) => `<span class="tag tag-amber">${escapeHtml(k)}</span>`).join(' ')}</div>
  ` : ''}
  ${a9.backendKeywords?.length ? `
    <p style="margin-top:8px;"><strong>后台关键词 (Backend Keywords):</strong></p>
    <div>${a9.backendKeywords.map((k: string) => `<span class="tag tag-blue">${escapeHtml(k)}</span>`).join(' ')}</div>
  ` : ''}
  ${a9.goldenKeywords?.length ? `
    <p style="margin-top:8px;"><strong>黄金关键词 (Golden Keywords):</strong></p>
    <div>${a9.goldenKeywords.map((k: string) => `<span class="tag tag-green">${escapeHtml(k)}</span>`).join(' ')}</div>
  ` : ''}
  ${a9.keywordStrategy ? `
    <p style="margin-top:8px;"><strong>关键词策略:</strong></p>
    <div class="content-box">${escapeHtml(a9.keywordStrategy)}</div>
  ` : ''}
</div>
` : '<div class="section"><p style="color:#999;">未上传ABA关键词数据</p></div>'}

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

      // Get analysis summary
      const files = await db.getProjectFilesByProject(input.projectId);
      const analysisSummary: Record<string, any> = {
        productAttributes: null,
        competitorListings: null,
        cosmoScenes: null,
        a9Keywords: null,
      };

      for (const file of files) {
        if (file.status !== "completed" || !file.analysisResult) continue;
        try {
          const result = JSON.parse(file.analysisResult);
          switch (file.fileType) {
            case "product_attributes": analysisSummary.productAttributes = result; break;
            case "competitor_listings": analysisSummary.competitorListings = result; break;
            case "search_term_report": analysisSummary.cosmoScenes = result; break;
            case "aba_keywords": analysisSummary.a9Keywords = result; break;
          }
        } catch {}
      }

      const html = generateReportHtml(project, listing, analysisSummary);

      return {
        html,
        projectName: project.name,
        hasListing: !!listing,
        hasAnalysis: !!(analysisSummary.productAttributes || analysisSummary.competitorListings || analysisSummary.cosmoScenes || analysisSummary.a9Keywords),
      };
    }),
});
