// ─── PDF content builder (Step 5 only) ──────────────────────────────
export function buildPdfContent(enData: any, cnData: any): string {
  return buildFullPlanContent(null, enData, cnData);
}

// ─── Full Plan HTML builder (all 5 steps) ─────────────────────────
export function buildFullPlanContent(session: any, enData?: any, cnData?: any): string {
  const s: string[] = [];
  s.push(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>产品图片设计完整方案</title>
<style>
* { box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; max-width: 960px; margin: 0 auto; padding: 24px; color: #333; line-height: 1.6; }
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
table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 13px; }
th { background: #f3f4f6; padding: 8px; text-align: left; border: 1px solid #e5e7eb; }
td { padding: 8px; border: 1px solid #e5e7eb; }
.toc { background: #f9fafb; padding: 16px; border-radius: 8px; margin: 16px 0; }
.toc a { color: #8B4513; text-decoration: none; }
.toc a:hover { text-decoration: underline; }
@media print { body { max-width: 100%; padding: 12px; } h2 { break-before: auto; } }
</style></head><body>`);

  s.push(`<h1>📷 产品图片设计完整方案</h1>`);
  s.push(`<p style="color:#888;font-size:12px;">生成时间: ${new Date().toLocaleString('zh-CN')}</p>`);

  // Table of Contents
  s.push(`<div class="toc"><strong>目录</strong><br/>`);
  s.push(`<a href="#step1">Step 1: 卖点梳理</a><br/>`);
  s.push(`<a href="#step2">Step 2: 图片大纲</a><br/>`);
  s.push(`<a href="#step3">Step 3: 风格确认</a><br/>`);
  s.push(`<a href="#step4">Step 4: 参考图确认</a><br/>`);
  s.push(`<a href="#step5">Step 5: 图片结构及内容建议</a>`);
  s.push(`</div>`);

  // ===== Step 1: Selling Points =====
  if (session) {
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
  }

  // ===== Step 2: Image Outline =====
  if (session) {
    s.push(`<hr class="divider"/>`);
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
  }

  // ===== Step 3: Style Confirmation =====
  if (session) {
    s.push(`<hr class="divider"/>`);
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
            imgs.forEach((img: any) => {
              s.push(`<img class="ref-img" src="${img.imageUrl}" alt="ref"/>`);
            });
            s.push(`</div>`);
          }
        });
      }
    }
    if (!styleData) {
      s.push(`<p style="color:#999;">未生成或未确认</p>`);
    }
  }

  // ===== Step 4: Reference Images =====
  if (session) {
    s.push(`<hr class="divider"/>`);
    s.push(`<h2 id="step4"><span class="step-badge">Step 4</span>参考图确认</h2>`);
    const refData = safeJsonParse(session.step4UserEdit || session.step4AiResult);
    if (refData?.imageReferences?.length) {
      refData.imageReferences.forEach((ref: any) => {
        s.push(`<div class="card">`);
        s.push(`<h4>${ref.imageLabel || ''}</h4>`);
        if (ref.compositionReference) {
          s.push(`<p><strong>构图参考:</strong></p>`);
          s.push(`<p>类型: ${ref.compositionReference.type || ''}</p>`);
          s.push(`<p>描述: ${ref.compositionReference.description || ''}</p>`);
          if (ref.compositionReference.source) s.push(`<p>来源: ${ref.compositionReference.source}</p>`);
        }
        if (ref.effectReference) {
          s.push(`<p><strong>效果图参考:</strong></p>`);
          s.push(`<p>风格: ${ref.effectReference.style || ''}</p>`);
          s.push(`<p>描述: ${ref.effectReference.description || ''}</p>`);
        }
        // KB reference images
        if (ref.kbReferenceImages?.length) {
          s.push(`<p><strong>知识库参考图:</strong></p>`);
          ref.kbReferenceImages.forEach((img: any) => {
            s.push(`<img class="ref-img" src="${img.imageUrl}" alt="ref"/>`);
          });
        }
        s.push(`</div>`);
      });
    }
    if (!refData) {
      s.push(`<p style="color:#999;">未生成或未确认</p>`);
    }
  }

  // ===== Step 5: Final Image Suggestions =====
  s.push(`<hr class="divider"/>`);
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
      s.push(`<h3>A+ Content</h3>`);
      en.aPlusContent.sections.forEach((sec: any, idx: number) => {
        const cnSec = cn?.aPlusContent?.sections?.[idx];
        const moduleMeta = [sec.selectedModuleName, sec.selectedModuleStructure, sec.selectedModuleSpecs].filter(Boolean).join(' | ');
        const moduleSpecific = sec.moduleSpecificContent ? `<div class="fabe"><strong>模块专属结构:</strong> ${JSON.stringify(sec.moduleSpecificContent)}</div>` : '';
        s.push(`<h4>Module ${idx + 1}: ${sec.title || ''}</h4><div class="grid"><div class="en">${moduleMeta ? `<p><strong>A+ Module:</strong> ${moduleMeta}</p>` : ''}<p><strong>Purpose:</strong> ${sec.purpose || ''}</p><p>${sec.content || ''}</p>${sec.fabe ? `<div class="fabe">FABE: F: ${sec.fabe.feature || ''} | A: ${sec.fabe.advantage || ''} | B: ${sec.fabe.benefit || ''} | E: ${sec.fabe.evidence || ''}</div>` : ''}${moduleSpecific}</div><div class="cn"><p><strong>目的:</strong> ${cnSec?.purpose || ''}</p><p>${cnSec?.content || ''}</p>${cnSec?.fabe ? `<div class="fabe">FABE: F: ${cnSec.fabe.feature || ''} | A: ${cnSec.fabe.advantage || ''} | B: ${cnSec.fabe.benefit || ''} | E: ${cnSec.fabe.evidence || ''}</div>` : ''}</div></div>`);
      });
    }
  } else {
    s.push(`<p style="color:#999;">未生成或未确认</p>`);
  }

  s.push(`</body></html>`);
  return s.join("\n");
}

export function safeJsonParse(str: string | null | undefined): any {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}
