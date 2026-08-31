// ─── PDF content builder (Step 5 only) ──────────────────────────────
export type FullPlanExportAssets = {
  expressionGroups?: any[];
  asinReferenceSets?: any[];
};

export function buildPdfContent(enData: any, cnData: any): string {
  return buildFullPlanContent(null, enData, cnData);
}

function safeText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseObject(value: unknown): any {
  if (!value) return {};
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return {}; }
}

function inferImageNumber(item: any, fallback: number): number {
  const explicit = Number(item?.imageNumber);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const label = String(item?.imageLabel || item?.label || item?.imageName || "");
  const matched = label.match(/(?:图片|辅图|主图|A\+\s*模块|#)\s*(\d+)/i);
  return matched ? Number(matched[1]) : fallback;
}

function readableDetail(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) return value.map(readableDetail).filter(Boolean).join("；");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, detail]) => `${key}：${readableDetail(detail)}`)
      .filter((item) => !item.endsWith("："))
      .join("；");
  }
  return String(value);
}

function renderImageAsset(img: any, source: string, label?: string) {
  const url = safeText(img?.imageUrl || img?.url || img?.thumbnailUrl || "");
  if (!url) return "";
  const caption = [label, img?.competitorName, img?.imagePosition && `位置：${img.imagePosition}${img?.positionIndex ?? ""}`, source]
    .filter(Boolean).map(safeText).join(" · ");
  return `<figure class="asset-card"><img class="asset-img" src="${url}" alt="${caption}"/><figcaption>${caption}</figcaption></figure>`;
}

// ─── Full Plan HTML builder (Step0-6) ─────────────────────────────
export function buildFullPlanContent(session: any, enData?: any, cnData?: any, assets: FullPlanExportAssets = {}): string {
  const s: string[] = [];
  s.push(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>产品图片设计完整方案</title>
<style>
* { box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; min-width: 1860px; margin: 0; padding: 24px; color: #333; line-height: 1.6; }
h1 { color: #8B4513; border-bottom: 3px solid #8B4513; padding-bottom: 10px; font-size: 24px; }
h2 { color: #8B4513; margin-top: 32px; padding: 8px 12px; background: #fdf2e9; border-left: 4px solid #8B4513; font-size: 18px; }
h3 { color: #555; margin-top: 16px; font-size: 15px; }
h4 { color: #666; margin-top: 12px; font-size: 14px; }
.step-badge { display: inline-block; background: #8B4513; color: white; padding: 3px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-right: 8px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 8px 0; }
.en { background: #f0f7ff; padding: 14px; border-radius: 8px; border: 1px solid #d0e3ff; }
.cn { background: #fff7ed; padding: 14px; border-radius: 8px; border: 1px solid #ffe0c0; }
.card { background: #fafafa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; margin: 8px 0; }
.card-selected { border-color: #8B4513; background: #fdf8f4; }
.fabe { background: #f5f5f5; padding: 8px 10px; border-radius: 4px; margin: 6px 0; font-size: 12px; border-left: 3px solid #d4a574; }
.badge { display: inline-block; background: #e5e7eb; padding: 2px 8px; border-radius: 12px; font-size: 11px; margin: 2px; }
.badge-primary { background: #8B4513; color: white; }
.badge-green { background: #dcfce7; color: #166534; }
.badge-red { background: #fee2e2; color: #991b1b; }
.color-dot { display: inline-block; width: 16px; height: 16px; border-radius: 50%; border: 1px solid #ccc; vertical-align: middle; margin-right: 4px; }
.tag-list { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0; }
p { margin: 4px 0; font-size: 13px; }
.divider { border: none; border-top: 1px dashed #d4a574; margin: 24px 0; }
.ref-img { width: 60px; height: 60px; object-fit: cover; border-radius: 4px; border: 1px solid #ddd; margin: 2px; }
.asset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin: 10px 0; }
.asset-card { margin: 0; padding: 6px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; break-inside: avoid; }
.asset-img { width: 100%; height: 130px; object-fit: cover; border-radius: 5px; display: block; }
figcaption { color: #666; font-size: 10px; margin-top: 5px; line-height: 1.35; word-break: break-word; }
.source-line { color: #8B4513; font-size: 12px; margin: 5px 0; }
.section-note { color: #6b7280; font-size: 12px; margin-bottom: 10px; }
table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 13px; }
th { background: #f3f4f6; padding: 8px; text-align: left; border: 1px solid #e5e7eb; }
td { padding: 8px; border: 1px solid #e5e7eb; }
.toc { background: #f9fafb; padding: 16px; border-radius: 8px; margin: 16px 0; }
.toc a { color: #8B4513; text-decoration: none; }
.toc a:hover { text-decoration: underline; }
	.six-step-waterfall { display: grid; grid-template-columns: repeat(7, minmax(280px, 1fr)); align-items: start; gap: 16px; min-width: 2100px; }
.workflow-step { min-width: 0; padding: 12px; border: 1px solid #e5e7eb; border-radius: 10px; background: #fff; break-inside: avoid; }
.workflow-step h2 { margin-top: 0; font-size: 16px; }
.workflow-step .divider { display: none; }
.image-waterfall { margin-top: 16px; }
.image-flow-card { background: #fff; border: 1px solid #d9e1ea; border-radius: 12px; padding: 18px; margin: 16px 0; break-inside: avoid; box-shadow: 0 2px 8px rgba(15,23,42,.05); }
.image-flow-title { display: flex; align-items: baseline; gap: 8px; border-bottom: 2px solid #8B4513; padding-bottom: 8px; margin-bottom: 12px; }
.image-flow-title strong { color: #8B4513; font-size: 17px; }
.flow-stage { margin: 12px 0; padding: 12px; border-radius: 8px; background: #fafafa; border-left: 4px solid #d4a574; }
.flow-stage h4 { margin: 0 0 7px; color: #8B4513; }
.flow-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media print { @page { size: landscape; margin: 8mm; } body { min-width: 0; padding: 0; } .six-step-waterfall { min-width: 0; gap: 6px; } .workflow-step { padding: 7px; } .workflow-step h2 { font-size: 12px; } .workflow-step p, .workflow-step td, .workflow-step th { font-size: 9px; } .workflow-step .asset-img { height: 88px; } h2 { break-before: auto; } }
</style></head><body>`);

  s.push(`<h1>📷 产品图片设计完整方案</h1>`);
  s.push(`<p style="color:#888;font-size:12px;">生成时间: ${new Date().toLocaleString('zh-CN')}</p>`);

  // Table of Contents
  s.push(`<div class="toc"><strong>目录</strong><br/>`);
  s.push(`<a href="#step0">Step 0: 竞品图片分析</a><br/>`);
  s.push(`<a href="#step1">Step 1: 卖点梳理</a><br/>`);
  s.push(`<a href="#step2">Step 2: 图片大纲</a><br/>`);
  s.push(`<a href="#step3">Step 3: 风格确认</a><br/>`);
  s.push(`<a href="#step4">Step 4: 参考图确认</a><br/>`);
  s.push(`<a href="#step5">Step 5: 图片结构及内容建议</a><br/>`);
  s.push(`<a href="#step6">Step 6: 作图提示词包</a>`);
  s.push(`</div>`);
  s.push(`<div class="six-step-waterfall">`);

  // ===== Step 0: Competitor Image Analysis =====
  s.push(`<section class="workflow-step">`);
  s.push(`<h2 id="step0"><span class="step-badge">Step 0</span>竞品图片分析</h2>`);
  s.push(`<p class="section-note">按卖点表达方向归档竞品图片、竞品名称和人工确认的分析结论，为后续卖点、图片大纲与视觉风格提供依据。</p>`);
  const step0Summary = safeJsonParse(session?.step0UserEdit || session?.step0AiResult);
  if (step0Summary?.overallSummary || step0Summary?.summary) {
    s.push(`<div class="card"><strong>竞品图片总体洞察：</strong>${safeText(step0Summary.overallSummary || step0Summary.summary)}</div>`);
  }
  if (assets.expressionGroups?.length) {
    assets.expressionGroups.forEach((group: any, groupIndex: number) => {
      const analysis = parseObject(group.userEdit || group.aiAnalysis);
      s.push(`<div class="card"><h3>表达方向 ${groupIndex + 1}：${safeText(group.expressionName || "未命名方向")}</h3>`);
      if (analysis?.summary || analysis?.analysis) s.push(`<p>${safeText(analysis.summary || analysis.analysis)}</p>`);
      if (analysis?.highlights?.length) s.push(`<div class="tag-list">${analysis.highlights.map((item: any) => `<span class="badge">${safeText(item.text || item)}</span>`).join("")}</div>`);
      if (group.images?.length) s.push(`<p class="source-line">竞品参考图片（按同一表达方向汇集，不按单一竞品堆叠）：</p><div class="asset-grid">${group.images.map((img: any) => renderImageAsset(img, "Step0 竞品表达组")).join("")}</div>`);
      s.push(`</div>`);
    });
  } else if (!step0Summary) {
    s.push(`<p style="color:#999;">未生成或未确认竞品图片分析</p>`);
  }
  s.push(`</section>`);

  // ===== Step 1: Selling Points =====
  if (session) {
    s.push(`<section class="workflow-step">`);
    s.push(`<h2 id="step1"><span class="step-badge">Step 1</span>卖点梳理</h2>`);
    const sp = safeJsonParse(session.step1UserEdit || session.step1AiResult);
    if (sp) {
      if (sp.coreSellingPoints?.length) {
        s.push(`<h3>⭐ 核心卖点（主卖点）</h3>`);
        sp.coreSellingPoints.forEach((p: any) => {
          s.push(`<div class="card"><strong>${p.point || p}</strong>${p.memoryHook ? `<br/><span style="color:#8B4513;font-size:12px;">记忆点: ${p.memoryHook}</span>` : ''}${p.expressions?.length ? `<br/><span class="tag-list">${p.expressions.map((e: string) => `<span class="badge">${e}</span>`).join('')}</span>` : ''}</div>`);
        });
      }
      if (sp.secondarySellingPoints?.length) {
        s.push(`<h3>○ 次要卖点</h3>`);
        sp.secondarySellingPoints.forEach((p: any) => {
          s.push(`<div class="card"><strong>${p.point || p}</strong>${p.addedValue ? `<br/><span style="font-size:12px;color:#666;">附加价值: ${p.addedValue}</span>` : ''}</div>`);
        });
      }
      if (sp.positiveReviewPoints?.length) {
        s.push(`<h3>✅ 好评点（需强化）</h3>`);
        s.push(`<div class="tag-list">${sp.positiveReviewPoints.map((p: any) => `<span class="badge badge-green">${p.point || p}</span>`).join('')}</div>`);
      }
      if (sp.negativeReviewPoints?.length) {
        s.push(`<h3>⚠️ 差评点</h3>`);
        sp.negativeReviewPoints.forEach((p: any) => {
          s.push(`<div class="card"><strong>${p.point || p}</strong>${p.resolved !== undefined ? `<br/><span class="badge ${p.resolved ? 'badge-green' : 'badge-red'}">${p.resolved ? '已解决 - 做对比' : '未解决 - 做引导'}</span>` : ''}${p.strategy ? `<br/><span style="font-size:12px;">策略: ${p.strategy}</span>` : ''}</div>`);
        });
      }
      if (sp.necessityDescriptions?.length) {
        s.push(`<h3>📏 必要性描述</h3>`);
        s.push(`<table><tr><th>类型</th><th>内容</th></tr>`);
        sp.necessityDescriptions.forEach((n: any) => {
          s.push(`<tr><td>${n.type || ''}</td><td>${n.description || n}</td></tr>`);
        });
        s.push(`</table>`);
      }
      if (sp.scenes?.length) {
        s.push(`<h3>🎬 场景及占比</h3>`);
        s.push(`<table><tr><th>场景</th><th>占比</th><th>优先级</th></tr>`);
        sp.scenes.forEach((sc: any) => {
          s.push(`<tr><td>${sc.scene || sc.name || sc}</td><td>${sc.percentage || sc.ratio || '-'}</td><td>${sc.priority || '-'}</td></tr>`);
        });
        s.push(`</table>`);
      }
    } else {
      s.push(`<p style="color:#999;">未生成或未确认</p>`);
    }
    s.push(`</section>`);
  }

  // ===== Step 2: Image Outline =====
  if (session) {
    s.push(`<section class="workflow-step">`);
    s.push(`<h2 id="step2"><span class="step-badge">Step 2</span>图片大纲</h2>`);
    const outline = safeJsonParse(session.step2UserEdit || session.step2AiResult);
    const outlineImages = outline?.images || [
      outline?.mainImage ? {
        imageLabel: '主图',
        imageType: '主图',
        content: outline.mainImage.contentBrief,
        sellingPoint: outline.mainImage.sellingPointRef,
        expressionMethod: outline.mainImage.purpose,
      } : null,
      ...(outline?.secondaryImages || []).map((img: any) => ({
        imageLabel: `辅图 ${img.imageNumber || ''}`,
        imageType: '辅图',
        content: img.contentBrief,
        sellingPoint: Array.isArray(img.sellingPointRefs) ? img.sellingPointRefs.join(', ') : img.sellingPointRefs,
        expressionMethod: img.expressionType,
      })),
    ].filter(Boolean);
    if (outlineImages?.length) {
      s.push(`<table><tr><th>图片</th><th>内容规划</th><th>呼应卖点</th><th>表达方式</th></tr>`);
      outlineImages.forEach((img: any) => {
        s.push(`<tr><td><strong>${img.imageLabel || img.label || ''}</strong><br/><span class="badge">${img.imageType || ''}</span></td><td>${img.content || img.description || ''}</td><td>${img.sellingPoint || img.linkedSellingPoint || ''}</td><td>${img.expressionMethod || ''}</td></tr>`);
      });
      s.push(`</table>`);
    }
    if (outline?.brandStory) {
      s.push(`<h3>品牌故事</h3><div class="card">${typeof outline.brandStory === 'string' ? outline.brandStory : JSON.stringify(outline.brandStory)}</div>`);
    }
    if (outline?.aPlusOutline) {
      s.push(`<h3>A+ 内容大纲</h3><div class="card">${typeof outline.aPlusOutline === 'string' ? outline.aPlusOutline : JSON.stringify(outline.aPlusOutline)}</div>`);
    }
    if (outline?.aPlusModules?.length) {
      s.push(`<h3>A+ 模块样式</h3>`);
      outline.aPlusModules.forEach((mod: any, idx: number) => {
        s.push(`<div class="card">`);
        s.push(`<h4>A+ 模块 ${mod.moduleNumber || idx + 1}: ${mod.selectedModuleName || mod.moduleType || ''}</h4>`);
        if (mod.selectedModuleStructure) s.push(`<p><strong>结构:</strong> ${mod.selectedModuleStructure}</p>`);
        if (mod.selectedModuleSpecs) s.push(`<p><strong>规格:</strong> ${mod.selectedModuleSpecs}</p>`);
        if (mod.purpose) s.push(`<p><strong>目的:</strong> ${mod.purpose}</p>`);
        if (mod.contentBrief) s.push(`<p><strong>内容:</strong> ${mod.contentBrief}</p>`);
        if (mod.position) s.push(`<p><strong>位置:</strong> ${mod.position}</p>`);
        s.push(`</div>`);
      });
    }
    if (!outline) {
      s.push(`<p style="color:#999;">未生成或未确认</p>`);
    }
    s.push(`</section>`);
  }

  // ===== Step 3: Style Confirmation =====
  if (session) {
    s.push(`<section class="workflow-step">`);
    s.push(`<h2 id="step3"><span class="step-badge">Step 3</span>风格确认</h2>`);
    const styleData = safeJsonParse(session.step3UserEdit || session.step3AiResult);
    if (styleData?.selectedStyles?.length) {
      styleData.selectedStyles.forEach((style: any) => {
        s.push(`<div class="card card-selected">`);
        s.push(`<h4>✅ ${style.name || '已选风格'}</h4>`);
        if (style.description) s.push(`<p>${style.description}</p>`);
        if (style.colorPalette) {
          s.push(`<p><strong>配色:</strong> `);
          Object.entries(style.colorPalette).forEach(([k, v]: [string, any]) => {
            const hex = String(v).match(/#[0-9A-Fa-f]{3,8}/)?.[0] || '#ccc';
            s.push(`<span class="color-dot" style="background:${hex}"></span>${k}: ${v} &nbsp;`);
          });
          s.push(`</p>`);
        }
        if (style.typography) s.push(`<p><strong>字体:</strong> 标题: ${style.typography.headingFont || ''} | 正文: ${style.typography.bodyFont || ''}</p>`);
        if (style.overallTone) s.push(`<p><strong>调性:</strong> ${style.overallTone}</p>`);
        if (style.whyRecommend) s.push(`<p style="font-size:12px;color:#888;"><em>${style.whyRecommend}</em></p>`);
        if (style.source) s.push(`<p class="source-line">来源：${safeText(style.source === 'kb_asin' ? `知识库 ASIN 集 · ${style.asin || ''}` : style.source === 'kb_style_tag' ? '知识库设计风格标签' : `AI 推荐 · ${style.source}`)}</p>`);
        if (style.thumbnailUrl) s.push(`<div class="asset-grid">${renderImageAsset({ imageUrl: style.thumbnailUrl }, "Step3 ASIN 集缩略图", style.asin || style.name)}</div>`);
        s.push(`</div>`);
      });
    }
    // KB reference images for styles
    if (styleData?.styleKbImages) {
      const hasAny = Object.values(styleData.styleKbImages).some((arr: any) => arr?.length > 0);
      if (hasAny) {
        s.push(`<h3>知识库参考图</h3>`);
        Object.entries(styleData.styleKbImages).forEach(([styleId, imgs]: [string, any]) => {
          if (imgs?.length) {
            s.push(`<div class="card"><strong>风格 ${styleId} 参考图:</strong><br/>`);
            s.push(`<div class="asset-grid">${imgs.map((img: any) => renderImageAsset(img, `Step3 知识库风格图 #${img.id || ''}`)).join('')}</div>`);
            s.push(`</div>`);
          }
        });
      }
    }
    if (assets.asinReferenceSets?.length) {
      s.push(`<h3>风格参考 ASIN 集（全部已选集合图片）</h3>`);
      s.push(`<p class="section-note">以下图片来自用户在 Step 3 主动选择的共享 ASIN 图片集，保留 ASIN、产品信息、套图风格及每张图片的类型标签，方便设计师追溯参考来源。</p>`);
      assets.asinReferenceSets.forEach((set: any) => {
        s.push(`<div class="card"><h4>${safeText(set.productTitle || set.asin || `ASIN 集 ${set.id}`)}</h4>`);
        s.push(`<p class="source-line">来源：知识库共享 ASIN 集 · ASIN：${safeText(set.asin || '')}${set.setStyle ? ` · 套图风格：${safeText(set.setStyle)}` : ''}${set.category ? ` · 类目：${safeText(set.category)}` : ''}</p>`);
        if (set.overallAnalysis) {
          const overall = parseObject(set.userEditedOverallAnalysis || set.overallAnalysis);
          if (overall.summary || overall.overallStrategy) s.push(`<p>${safeText(overall.summary || overall.overallStrategy)}</p>`);
        }
        if (set.images?.length) s.push(`<div class="asset-grid">${set.images.map((img: any) => renderImageAsset(img, `知识库 ASIN ${set.asin || ''}`, `${img.imagePosition || '图片'} ${img.positionIndex ?? ''}`)).join('')}</div>`);
        s.push(`</div>`);
      });
    }
    if (!styleData) {
      s.push(`<p style="color:#999;">未生成或未确认</p>`);
    }
    s.push(`</section>`);
  }

  // ===== Step 4: Reference Images =====
  if (session) {
    s.push(`<section class="workflow-step">`);
    s.push(`<h2 id="step4"><span class="step-badge">Step 4</span>参考图确认</h2>`);
    const refData = safeJsonParse(session.step4UserEdit || session.step4AiResult);
    if (refData?.imageReferences?.length) {
      refData.imageReferences.forEach((ref: any, index: number) => {
        s.push(`<div class="card">`);
        const imageNumber = inferImageNumber(ref, index + 1);
        const imageType = String(ref.imageType || "");
        const sequenceLabel = imageType.includes("A+") ? `A+ 模块 #${imageNumber}` : imageNumber === 1 ? "主图 #1" : `辅图 #${imageNumber}`;
        const rawLabel = String(ref.imageLabel || ref.label || ref.imageName || "").trim();
        const referenceTitle = rawLabel && rawLabel !== "图片参考"
          ? (rawLabel.includes(String(imageNumber)) ? rawLabel : `${sequenceLabel} · ${rawLabel}`)
          : sequenceLabel;
        s.push(`<h4>${safeText(referenceTitle)}</h4>`);
        const composition = ref.compositionReference || {};
        const effect = ref.effectReference || {};
        if (Object.keys(composition).length) {
          s.push(`<p><strong>构图方案:</strong></p>`);
          if (composition.compositionType || composition.type) s.push(`<p><strong>构图方式:</strong> ${safeText(composition.compositionType || composition.type)}</p>`);
          if (composition.layout || composition.description) s.push(`<p><strong>布局:</strong> ${safeText(composition.layout || composition.description)}</p>`);
          if (composition.focalPoint || composition.focus) s.push(`<p><strong>焦点:</strong> ${safeText(composition.focalPoint || composition.focus)}</p>`);
          if (composition.visualFlow || composition.visualGuide) s.push(`<p><strong>视觉引导:</strong> ${safeText(composition.visualFlow || composition.visualGuide)}</p>`);
          if (composition.proportions || composition.ratio) s.push(`<p><strong>比例:</strong> ${safeText(composition.proportions || composition.ratio)}</p>`);
          if (composition.designNotes || composition.notes) s.push(`<p><strong>设计注意事项:</strong> ${safeText(composition.designNotes || composition.notes)}</p>`);
          if (composition.source) s.push(`<p class="source-line">来源: ${safeText(composition.source)}</p>`);
        }
        const compositionImageUrl = ref.compositionRefImageUrl || ref.compositionReference?.imageUrl || ref.compositionReference?.url;
        if (compositionImageUrl) s.push(`<div class="asset-grid">${renderImageAsset({ imageUrl: compositionImageUrl }, "Step4 构图参考图", ref.imageLabel || '')}</div>`);
        if (Object.keys(effect).length) {
          s.push(`<p><strong>效果方案:</strong></p>`);
          if (effect.colorApplication || effect.colorScheme) s.push(`<p><strong>配色应用:</strong> ${safeText(effect.colorApplication || effect.colorScheme)}</p>`);
          if (effect.typographyApplication || effect.typography) s.push(`<p><strong>字体应用:</strong> ${safeText(effect.typographyApplication || effect.typography)}</p>`);
          if (effect.iconApplication || effect.icons) s.push(`<p><strong>图标应用:</strong> ${safeText(effect.iconApplication || effect.icons)}</p>`);
          if (effect.atmosphere || effect.style) s.push(`<p><strong>氛围:</strong> ${safeText(effect.atmosphere || effect.style)}</p>`);
          if (effect.lightingStyle || effect.lighting) s.push(`<p><strong>光影:</strong> ${safeText(effect.lightingStyle || effect.lighting)}</p>`);
          if (effect.description) s.push(`<p><strong>效果说明:</strong> ${safeText(effect.description)}</p>`);
          if (effect.designNotes || effect.notes) s.push(`<p><strong>设计注意事项:</strong> ${safeText(effect.designNotes || effect.notes)}</p>`);
        }
        const effectImageUrl = ref.effectRefImageUrl || ref.effectReference?.imageUrl || ref.effectReference?.url;
        if (effectImageUrl) s.push(`<div class="asset-grid">${renderImageAsset({ imageUrl: effectImageUrl }, "Step4 效果参考图", ref.imageLabel || '')}</div>`);
        // KB reference images
        if (ref.kbReferenceImages?.length) {
          s.push(`<p><strong>知识库参考图:</strong></p>`);
          s.push(`<div class="asset-grid">${ref.kbReferenceImages.map((img: any) => renderImageAsset(img, `Step4 知识库参考图 #${img.id || ''}`)).join('')}</div>`);
        }
        const designerNotes = [
          ref.designNotes,
          ref.designerNotes,
          ref.notes,
          composition.designNotes,
          composition.notes,
          effect.designNotes,
          effect.notes,
        ].map(readableDetail).filter(Boolean);
        const uniqueDesignerNotes = Array.from(new Set(designerNotes));
        if (uniqueDesignerNotes.length) {
          s.push(`<div class="fabe"><strong>设计师注意事项：</strong>${safeText(uniqueDesignerNotes.join("；"))}</div>`);
        }
        s.push(`</div>`);
      });
    }
    if (!refData) {
      s.push(`<p style="color:#999;">未生成或未确认</p>`);
    }
    s.push(`</section>`);
  }

  // ===== Step 5: Final Image Suggestions =====
  s.push(`<section class="workflow-step">`);
  s.push(`<h2 id="step5"><span class="step-badge">Step 5</span>图片结构及内容建议</h2>`);

  const en = enData || (session ? safeJsonParse(session.step5UserEdit || session.step5OptimizedResult || session.step5AiResult) : null);
  const cn = cnData || (session ? safeJsonParse(session.step5AiResultCn || session.step5OptimizedResultCn) : null);

  if (en) {
    if (en.designGuidelines) {
      const stringify = (v: any) => typeof v === 'object' && v !== null ? JSON.stringify(v) : (v || '');
      s.push(`<h3>设计指南 / Design Guidelines</h3><div class="grid"><div class="en"><p><strong>Font:</strong> ${stringify(en.designGuidelines.fontRecommendation)}</p><p><strong>Color:</strong> ${stringify(en.designGuidelines.overallColorPalette)}</p><p><strong>Tone:</strong> ${stringify(en.designGuidelines.brandTone)}</p></div><div class="cn"><p><strong>字体:</strong> ${stringify(cn?.designGuidelines?.fontRecommendation)}</p><p><strong>配色:</strong> ${stringify(cn?.designGuidelines?.overallColorPalette)}</p><p><strong>调性:</strong> ${stringify(cn?.designGuidelines?.brandTone)}</p></div></div>`);
    }
    if (en.mainImage) {
      s.push(`<h3>主图 / Main Image</h3><div class="grid"><div class="en"><p><strong>${en.mainImage.title || ''}</strong></p><p>${en.mainImage.concept || ''}</p><p><strong>Composition:</strong> ${en.mainImage.composition || ''}</p><p><strong>Shooting:</strong> ${en.mainImage.shootingNotes || ''}</p></div><div class="cn"><p><strong>${cn?.mainImage?.title || ''}</strong></p><p>${cn?.mainImage?.concept || ''}</p><p><strong>构图:</strong> ${cn?.mainImage?.composition || ''}</p><p><strong>拍摄:</strong> ${cn?.mainImage?.shootingNotes || ''}</p></div></div>`);
    }
    en.secondaryImages?.forEach((img: any, idx: number) => {
      const cnImg = cn?.secondaryImages?.[idx];
      s.push(`<h3>辅图 ${img.imageNumber || idx + 2}</h3><div class="grid"><div class="en"><p><strong>${img.title || ''}</strong></p><p><strong>Focus:</strong> ${img.focus || ''}</p>${img.fabe ? `<div class="fabe"><strong>FABE:</strong> F: ${img.fabe.feature || ''} | A: ${img.fabe.advantage || ''} | B: ${img.fabe.benefit || ''} | E: ${img.fabe.evidence || ''}</div>` : ''}<p><strong>Expression:</strong> ${img.expressionMethod || ''}</p><p><strong>Composition:</strong> ${img.composition || ''}</p><p><strong>Text:</strong> ${img.textOverlay || ''}</p></div><div class="cn"><p><strong>${cnImg?.title || ''}</strong></p><p><strong>聚焦:</strong> ${cnImg?.focus || ''}</p>${cnImg?.fabe ? `<div class="fabe"><strong>FABE:</strong> F: ${cnImg.fabe.feature || ''} | A: ${cnImg.fabe.advantage || ''} | B: ${cnImg.fabe.benefit || ''} | E: ${cnImg.fabe.evidence || ''}</div>` : ''}<p><strong>表达:</strong> ${cnImg?.expressionMethod || ''}</p><p><strong>构图:</strong> ${cnImg?.composition || ''}</p><p><strong>文案:</strong> ${cnImg?.textOverlay || ''}</p></div></div>`);
    });
    if (en.aPlusContent?.sections) {
      const narrative = en.aPlusContent;
      if (narrative.overallStrategy || narrative.overallStory || narrative.consistency || narrative.modularDesign) {
        s.push(`<h3>整套图片叙事逻辑 / Overall Image Story</h3>`);
        s.push(`<div class="card card-selected">`);
        if (narrative.overallStrategy) s.push(`<p><strong>叙事策略:</strong> ${safeText(narrative.overallStrategy)}</p>`);
        if (narrative.overallStory) s.push(`<p><strong>故事线:</strong> ${safeText(narrative.overallStory)}</p>`);
        if (narrative.consistency) s.push(`<p><strong>视觉一致性:</strong> ${safeText(narrative.consistency)}</p>`);
        if (narrative.modularDesign) s.push(`<p><strong>模块化衔接:</strong> ${safeText(narrative.modularDesign)}</p>`);
        s.push(`</div>`);
      }
      s.push(`<h3>A+ Content</h3>`);
      en.aPlusContent.sections.forEach((sec: any, idx: number) => {
        const cnSec = cn?.aPlusContent?.sections?.[idx];
        const moduleMeta = [sec.selectedModuleName, sec.selectedModuleStructure, sec.selectedModuleSpecs].filter(Boolean).join(' | ');
        const moduleSpecific = sec.moduleSpecificContent ? `<div class="fabe"><strong>模块专属结构:</strong> ${JSON.stringify(sec.moduleSpecificContent)}</div>` : '';
        s.push(`<h4>Module ${idx + 1}: ${sec.title || ''}</h4><div class="grid"><div class="en">${moduleMeta ? `<p><strong>A+ Module:</strong> ${moduleMeta}</p>` : ''}<p><strong>Purpose:</strong> ${sec.purpose || ''}</p><p>${sec.content || ''}</p>${sec.fabe ? `<div class="fabe">FABE: F: ${sec.fabe.feature || ''} | A: ${sec.fabe.advantage || ''} | B: ${sec.fabe.benefit || ''} | E: ${sec.fabe.evidence || ''}</div>` : ''}${moduleSpecific}</div><div class="cn"><p><strong>目的:</strong> ${cnSec?.purpose || ''}</p><p>${cnSec?.content || ''}</p>${cnSec?.fabe ? `<div class="fabe">FABE: F: ${cnSec.fabe.feature || ''} | A: ${cnSec.fabe.advantage || ''} | B: ${cnSec.fabe.benefit || ''} | E: ${cnSec.fabe.evidence || ''}</div>` : ''}</div></div>`);
      });
    }
    const designerUploads = safeJsonParse(session?.step5DesignerUploads);
    if (Array.isArray(designerUploads) && designerUploads.length) {
      s.push(`<h3>设计师补充图片 / Designer Uploads</h3>`);
      s.push(`<p class="section-note">以下为在最终图片建议阶段补充上传的图片资产，保留图片编号、备注及上传时间。</p>`);
      s.push(`<div class="asset-grid">${designerUploads.map((img: any) => renderImageAsset(img, `Step5 设计师上传 · ${img.uploadedAt || ''}`, img.imageNumber ? `图片 ${img.imageNumber}` : img.notes || '')).join('')}</div>`);
    }
  } else {
    s.push(`<p style="color:#999;">未生成或未确认</p>`);
  }
  s.push(`</section>`);

  // ===== Step 6: Editable Prompt Pack =====
  s.push(`<section class="workflow-step">`);
  s.push(`<h2 id="step6"><span class="step-badge">Step 6</span>作图提示词包</h2>`);
  s.push(`<p class="section-note">基于人工确认的图片建议生成的可编辑生产提示词；确认不代表自动出图。</p>`);
  const step6 = session ? safeJsonParse(session.step6UserEdit || session.step6AiResult) : null;
  if (step6?.summary) s.push(`<div class="card"><strong>提示词包摘要：</strong>${safeText(step6.summary)}</div>`);
  if (Array.isArray(step6?.prompts) && step6.prompts.length) {
    step6.prompts.forEach((prompt: any, index: number) => {
      s.push(`<div class="card"><h3>${safeText(prompt.target || `提示词 ${index + 1}`)}</h3><p><strong>English Prompt:</strong> ${safeText(prompt.englishPrompt || prompt.prompt || "")}</p>${Array.isArray(prompt.negativeConstraints) && prompt.negativeConstraints.length ? `<p><strong>Negative Constraints:</strong> ${safeText(prompt.negativeConstraints.join("；"))}</p>` : ""}${Array.isArray(prompt.claimKeys) && prompt.claimKeys.length ? `<p><strong>Claim References:</strong> ${safeText(prompt.claimKeys.join("，"))}</p>` : ""}${prompt.reviewNote ? `<p><strong>人工复核备注:</strong> ${safeText(prompt.reviewNote)}</p>` : ""}</div>`);
    });
  } else {
    s.push(`<p style="color:#999;">未生成或未确认Step6提示词包</p>`);
  }
  s.push(`</section></div>`);

  // ===== Designer waterfall: one image, one complete execution context =====
  if (false && session) {
    const waterfallOutline = safeJsonParse(session.step2UserEdit || session.step2AiResult) || {};
    const waterfallRefs = safeJsonParse(session.step4UserEdit || session.step4AiResult) || {};
    const outlineItems = waterfallOutline.images || [
      waterfallOutline.mainImage ? { ...waterfallOutline.mainImage, imageNumber: 1, imageLabel: "主图", imageType: "主图", content: waterfallOutline.mainImage.contentBrief, sellingPoint: waterfallOutline.mainImage.sellingPointRef, expressionMethod: waterfallOutline.mainImage.purpose } : null,
      ...(waterfallOutline.secondaryImages || []).map((item: any, idx: number) => ({ ...item, imageNumber: item.imageNumber || idx + 2, imageLabel: item.imageLabel || `辅图 ${item.imageNumber || idx + 2}`, imageType: "辅图", content: item.contentBrief || item.content, sellingPoint: item.sellingPointRefs || item.sellingPoint, expressionMethod: item.expressionType || item.expressionMethod })),
    ].filter(Boolean);
    const refs = waterfallRefs.imageReferences || [];
    const finalSecondary = en?.secondaryImages || [];
    const allNumbers = Array.from(new Set([
      ...refs.map((item: any, idx: number) => inferImageNumber(item, idx + 1)),
      ...outlineItems.map((item: any, idx: number) => inferImageNumber(item, idx + 1)),
      ...(en?.mainImage ? [1] : []),
      ...finalSecondary.map((item: any, idx: number) => inferImageNumber(item, idx + 2)),
    ])).filter(Number.isFinite).sort((a, b) => a - b);

    if (allNumbers.length) {
      s.push(`<hr class="divider"/><h2 id="designer-waterfall"><span class="step-badge">设计师执行版</span>逐图瀑布流方案</h2>`);
      s.push(`<p class="section-note">按图片编号纵向对应 Step2 图片大纲、Step4 参考图方案及 Step5 图片建议。每张卡片即为一张图片的完整设计执行单。</p><div class="image-waterfall">`);
      allNumbers.forEach((imageNumber) => {
        const ref = refs.find((item: any, idx: number) => inferImageNumber(item, idx + 1) === imageNumber) || {};
        const outlineItem = outlineItems.find((item: any, idx: number) => inferImageNumber(item, idx + 1) === imageNumber) || {};
        const finalItem = imageNumber === 1 ? en?.mainImage : finalSecondary.find((item: any, idx: number) => inferImageNumber(item, idx + 2) === imageNumber);
        const aplusIndex = refs.filter((item: any) => String(item.imageType || "").includes("A+")).findIndex((item: any, idx: number) => inferImageNumber(item, idx + 1) === imageNumber);
        const aplusItem = aplusIndex >= 0 ? en?.aPlusContent?.sections?.[aplusIndex] : null;
        const displayName = ref.imageLabel || outlineItem.imageLabel || finalItem?.title || (aplusItem ? `A+ 模块 ${aplusIndex + 1}` : imageNumber === 1 ? "主图" : `辅图 ${imageNumber}`);
        const displayType = ref.imageType || outlineItem.imageType || (aplusItem ? "A+ 模块" : imageNumber === 1 ? "主图" : "辅图");
        const composition = ref.compositionReference || {};
        const effect = ref.effectReference || {};
        s.push(`<article class="image-flow-card" id="image-${imageNumber}"><div class="image-flow-title"><strong>图片 #${imageNumber} · ${safeText(displayName)}</strong><span class="badge">${safeText(displayType)}</span>${ref.purpose ? `<span style="font-size:12px;color:#667085;">${safeText(ref.purpose)}</span>` : ""}</div>`);

        s.push(`<section class="flow-stage"><h4>Step 2 · 图片大纲</h4>`);
        if (outlineItem.content || outlineItem.description) s.push(`<p><strong>内容规划：</strong>${safeText(outlineItem.content || outlineItem.description)}</p>`);
        if (outlineItem.sellingPoint || outlineItem.linkedSellingPoint) s.push(`<p><strong>对应卖点：</strong>${safeText(Array.isArray(outlineItem.sellingPoint) ? outlineItem.sellingPoint.join("、") : outlineItem.sellingPoint || outlineItem.linkedSellingPoint)}</p>`);
        if (outlineItem.expressionMethod) s.push(`<p><strong>表达方式：</strong>${safeText(outlineItem.expressionMethod)}</p>`);
        if (!outlineItem.content && !outlineItem.description) s.push(`<p style="color:#888;">该图片未配置独立大纲，以下参考方案和图片建议可直接作为执行依据。</p>`);
        s.push(`</section>`);

        s.push(`<section class="flow-stage"><h4>Step 4 · 参考图方案</h4><div class="flow-columns"><div>`);
        if (composition.compositionType || composition.type) s.push(`<p><strong>构图方式：</strong>${safeText(composition.compositionType || composition.type)}</p>`);
        if (composition.layout || composition.description) s.push(`<p><strong>布局：</strong>${safeText(composition.layout || composition.description)}</p>`);
        if (composition.focalPoint || composition.focus) s.push(`<p><strong>焦点：</strong>${safeText(composition.focalPoint || composition.focus)}</p>`);
        if (composition.visualFlow || composition.visualGuide) s.push(`<p><strong>视觉引导：</strong>${safeText(composition.visualFlow || composition.visualGuide)}</p>`);
        if (composition.proportions || composition.ratio) s.push(`<p><strong>比例：</strong>${safeText(composition.proportions || composition.ratio)}</p>`);
        s.push(`</div><div>`);
        if (effect.colorApplication || effect.colorScheme) s.push(`<p><strong>配色应用：</strong>${safeText(effect.colorApplication || effect.colorScheme)}</p>`);
        if (effect.typographyApplication || effect.typography) s.push(`<p><strong>字体应用：</strong>${safeText(effect.typographyApplication || effect.typography)}</p>`);
        if (effect.iconApplication || effect.icons) s.push(`<p><strong>图标应用：</strong>${safeText(effect.iconApplication || effect.icons)}</p>`);
        if (effect.atmosphere || effect.style) s.push(`<p><strong>氛围：</strong>${safeText(effect.atmosphere || effect.style)}</p>`);
        if (effect.lightingStyle || effect.lighting) s.push(`<p><strong>光影：</strong>${safeText(effect.lightingStyle || effect.lighting)}</p>`);
        s.push(`</div></div>`);
        const referenceAssets = [
          ref.compositionRefImageUrl ? renderImageAsset({ imageUrl: ref.compositionRefImageUrl }, "构图参考图", displayName) : "",
          ref.effectRefImageUrl ? renderImageAsset({ imageUrl: ref.effectRefImageUrl }, "效果参考图", displayName) : "",
          ...(ref.kbReferenceImages || []).map((img: any) => renderImageAsset(img, `知识库参考图 #${img.id || ""}`, img.note || displayName)),
        ].filter(Boolean);
        if (referenceAssets.length) s.push(`<div class="asset-grid">${referenceAssets.join("")}</div>`);
        if (ref.designNotes || composition.designNotes) s.push(`<p><strong>设计注意事项：</strong>${safeText(ref.designNotes || composition.designNotes)}</p>`);
        s.push(`</section>`);

        s.push(`<section class="flow-stage"><h4>Step 5 · 图片建议</h4>`);
        if (finalItem) {
          if (finalItem.title) s.push(`<p><strong>标题：</strong>${safeText(finalItem.title)}</p>`);
          if (finalItem.concept || finalItem.focus) s.push(`<p><strong>核心表达：</strong>${safeText(finalItem.concept || finalItem.focus)}</p>`);
          if (finalItem.expressionMethod) s.push(`<p><strong>表达方式：</strong>${safeText(finalItem.expressionMethod)}</p>`);
          if (finalItem.composition) s.push(`<p><strong>建议构图：</strong>${safeText(finalItem.composition)}</p>`);
          if (finalItem.textOverlay) s.push(`<p><strong>画面文案：</strong>${safeText(finalItem.textOverlay)}</p>`);
          if (finalItem.shootingNotes) s.push(`<p><strong>拍摄提示：</strong>${safeText(finalItem.shootingNotes)}</p>`);
          if (finalItem.fabe) s.push(`<div class="fabe"><strong>FABE：</strong>F: ${safeText(finalItem.fabe.feature)} | A: ${safeText(finalItem.fabe.advantage)} | B: ${safeText(finalItem.fabe.benefit)} | E: ${safeText(finalItem.fabe.evidence)}</div>`);
        } else if (aplusItem) {
          s.push(`<p><strong>${safeText(aplusItem.title || `A+ 模块 ${aplusIndex + 1}`)}</strong></p>`);
          if (aplusItem.purpose) s.push(`<p><strong>目的：</strong>${safeText(aplusItem.purpose)}</p>`);
          if (aplusItem.content) s.push(`<p><strong>内容：</strong>${safeText(aplusItem.content)}</p>`);
          if (aplusItem.expressionMethod) s.push(`<p><strong>表达方式：</strong>${safeText(aplusItem.expressionMethod)}</p>`);
        } else {
          s.push(`<p style="color:#888;">该图片尚未生成 Step5 独立建议，可依据 Step2 大纲和 Step4 参考方案执行。</p>`);
        }
        s.push(`</section></article>`);
      });
      s.push(`</div>`);
    }
  }

  s.push(`</body></html>`);
  return s.join("\n");
}

export function safeJsonParse(str: string | null | undefined): any {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}
