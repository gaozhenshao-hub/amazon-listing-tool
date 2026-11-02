/**
 * Manual Template Engine — 5 professional themes with customizable colors and fonts
 * Themes: classic, modern, minimal, business, creative
 * Font schemes: default, serif, sans, elegant, tech
 */

export interface ManualThemeConfig {
  themeStyle: string;   // classic | modern | minimal | business | creative
  themeColor: string;   // Primary color hex, e.g. "#1a1a2e"
  fontScheme: string;   // default | serif | sans | elegant | tech
}

export interface ManualData {
  chapters: {
    key: string;
    titleEn: string;
    titleEs: string;
    contentEn: string;
    contentEs: string;
    imageUrl?: string;
  }[];
  brandName: string;
  logoUrl: string;
  coverImageUrl: string;
  contentBgUrl: string;
  qrCodeUrl: string;
}

// ─── Font Schemes ──────────────────────────────────────────────
const FONT_SCHEMES: Record<string, { heading: string; body: string; import: string }> = {
  default: {
    heading: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
    body: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
    import: "",
  },
  serif: {
    heading: "'Playfair Display', 'Georgia', serif",
    body: "'Lora', 'Georgia', serif",
    import: "@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Lora:wght@400;500;600&display=swap');",
  },
  sans: {
    heading: "'Inter', 'Helvetica Neue', Arial, sans-serif",
    body: "'Inter', 'Helvetica Neue', Arial, sans-serif",
    import: "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');",
  },
  elegant: {
    heading: "'Cormorant Garamond', 'Georgia', serif",
    body: "'Nunito Sans', 'Helvetica Neue', sans-serif",
    import: "@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Nunito+Sans:wght@300;400;600&display=swap');",
  },
  tech: {
    heading: "'Space Grotesk', 'Roboto', sans-serif",
    body: "'IBM Plex Sans', 'Roboto', sans-serif",
    import: "@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap');",
  },
};

// ─── Color Helpers ─────────────────────────────────────────────
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function lighten(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const lr = Math.min(255, Math.round(r + (255 - r) * amount));
  const lg = Math.min(255, Math.round(g + (255 - g) * amount));
  const lb = Math.min(255, Math.round(b + (255 - b) * amount));
  return `rgb(${lr}, ${lg}, ${lb})`;
}

function darken(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${Math.round(r * (1 - amount))}, ${Math.round(g * (1 - amount))}, ${Math.round(b * (1 - amount))})`;
}

// ─── Theme-specific CSS generators ─────────────────────────────

function classicCSS(color: string, fonts: typeof FONT_SCHEMES.default): string {
  return `
    ${fonts.import}
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: ${fonts.body}; color: #333; line-height: 1.7; background: #fff; }
    
    .cover {
      text-align: center; padding: 80px 40px; min-height: 100vh;
      background: linear-gradient(135deg, ${color} 0%, ${darken(color, 0.3)} 100%);
      color: white; display: flex; flex-direction: column; justify-content: center; align-items: center;
    }
    .cover img.logo { max-width: 180px; margin-bottom: 30px; filter: brightness(0) invert(1); }
    .cover img.cover-bg { max-width: 380px; margin: 24px 0; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
    .cover h1 { font-family: ${fonts.heading}; font-size: 2.8em; margin: 24px 0 12px; letter-spacing: -0.02em; }
    .cover .subtitle { font-size: 1.3em; opacity: 0.85; font-weight: 300; }
    .cover .brand-line { width: 60px; height: 3px; background: rgba(255,255,255,0.5); margin: 20px auto; }
    
    .toc { padding: 60px 40px; max-width: 700px; margin: 0 auto; }
    .toc h2 { font-family: ${fonts.heading}; font-size: 1.8em; color: ${color}; margin-bottom: 24px; padding-bottom: 12px; border-bottom: 3px solid ${color}; }
    .toc ul { list-style: none; }
    .toc li { padding: 12px 16px; border-bottom: 1px solid #eee; font-size: 1.05em; display: flex; align-items: center; gap: 12px; }
    .toc li .num { color: ${color}; font-weight: 700; font-size: 1.1em; min-width: 28px; }
    
    .chapter { padding: 50px 40px; max-width: 700px; margin: 0 auto; page-break-before: always; }
    .chapter h2 { font-family: ${fonts.heading}; font-size: 1.7em; color: ${color}; margin-bottom: 24px; padding-bottom: 12px; border-bottom: 3px solid ${lighten(color, 0.7)}; }
    .chapter .ch-num { display: inline-block; background: ${color}; color: white; width: 36px; height: 36px; line-height: 36px; text-align: center; border-radius: 50%; font-size: 0.85em; font-weight: 700; margin-right: 12px; vertical-align: middle; }
    .chapter .content { font-size: 1em; line-height: 1.8; white-space: pre-wrap; }
    .chapter .ch-image { max-width: 100%; margin: 20px 0; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    
    .footer { text-align: center; padding: 50px 40px; background: ${lighten(color, 0.92)}; border-top: 3px solid ${color}; page-break-before: always; }
    .footer img.qr { max-width: 130px; margin-bottom: 16px; }
    .footer p { color: #666; font-size: 0.9em; }
    .footer .brand-name { font-family: ${fonts.heading}; font-size: 1.4em; color: ${color}; font-weight: 700; margin-bottom: 8px; }
    
    @media print {
      .cover { page-break-after: always; }
      .chapter { page-break-before: always; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `;
}

function modernCSS(color: string, fonts: typeof FONT_SCHEMES.default): string {
  return `
    ${fonts.import}
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: ${fonts.body}; color: #1a1a1a; line-height: 1.7; background: #fafafa; }
    
    .cover {
      text-align: left; padding: 80px 60px; min-height: 100vh;
      background: #fff; display: flex; flex-direction: column; justify-content: center;
      position: relative; overflow: hidden;
    }
    .cover::before { content: ''; position: absolute; right: -10%; top: -10%; width: 60%; height: 120%; background: ${lighten(color, 0.85)}; border-radius: 0 0 0 40%; z-index: 0; }
    .cover img.logo { max-width: 140px; margin-bottom: 40px; position: relative; z-index: 1; }
    .cover img.cover-bg { max-width: 320px; position: absolute; right: 60px; top: 50%; transform: translateY(-50%); border-radius: 20px; box-shadow: 0 30px 80px rgba(0,0,0,0.15); z-index: 1; }
    .cover h1 { font-family: ${fonts.heading}; font-size: 3.2em; color: #1a1a1a; margin-bottom: 16px; letter-spacing: -0.03em; position: relative; z-index: 1; max-width: 55%; }
    .cover .subtitle { font-size: 1.2em; color: ${color}; font-weight: 500; position: relative; z-index: 1; }
    .cover .brand-line { width: 50px; height: 4px; background: ${color}; margin: 24px 0; position: relative; z-index: 1; border-radius: 2px; }
    
    .toc { padding: 60px; max-width: 700px; margin: 0 auto; }
    .toc h2 { font-family: ${fonts.heading}; font-size: 1.6em; color: #1a1a1a; margin-bottom: 30px; }
    .toc h2::after { content: ''; display: block; width: 40px; height: 4px; background: ${color}; margin-top: 12px; border-radius: 2px; }
    .toc ul { list-style: none; }
    .toc li { padding: 14px 20px; margin-bottom: 8px; background: #fff; border-radius: 12px; font-size: 1em; display: flex; align-items: center; gap: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); transition: transform 0.2s; }
    .toc li .num { color: white; background: ${color}; font-weight: 700; font-size: 0.8em; width: 28px; height: 28px; line-height: 28px; text-align: center; border-radius: 8px; }
    
    .chapter { padding: 50px 60px; max-width: 700px; margin: 0 auto; page-break-before: always; }
    .chapter h2 { font-family: ${fonts.heading}; font-size: 1.6em; color: #1a1a1a; margin-bottom: 24px; display: flex; align-items: center; gap: 14px; }
    .chapter .ch-num { display: inline-flex; align-items: center; justify-content: center; background: ${color}; color: white; width: 40px; height: 40px; border-radius: 12px; font-size: 0.85em; font-weight: 700; flex-shrink: 0; }
    .chapter .content { font-size: 0.95em; line-height: 1.85; white-space: pre-wrap; color: #444; }
    .chapter .ch-image { max-width: 100%; margin: 24px 0; border-radius: 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.08); }
    
    .footer { text-align: center; padding: 60px; background: #fff; page-break-before: always; }
    .footer img.qr { max-width: 120px; margin-bottom: 20px; border-radius: 12px; }
    .footer .brand-name { font-family: ${fonts.heading}; font-size: 1.3em; color: ${color}; font-weight: 600; margin-bottom: 8px; }
    .footer p { color: #888; font-size: 0.85em; }
    
    @media print {
      .cover { page-break-after: always; }
      .cover::before { display: none; }
      .chapter { page-break-before: always; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #fff; }
    }
  `;
}

function minimalCSS(color: string, fonts: typeof FONT_SCHEMES.default): string {
  return `
    ${fonts.import}
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: ${fonts.body}; color: #333; line-height: 1.8; background: #fff; }
    
    .cover {
      text-align: center; padding: 100px 40px; min-height: 100vh;
      background: #fff; display: flex; flex-direction: column; justify-content: center; align-items: center;
    }
    .cover img.logo { max-width: 120px; margin-bottom: 50px; opacity: 0.9; }
    .cover img.cover-bg { max-width: 300px; margin: 30px 0; border-radius: 4px; }
    .cover h1 { font-family: ${fonts.heading}; font-size: 2.4em; color: #111; margin-bottom: 12px; font-weight: 300; letter-spacing: 0.05em; }
    .cover .subtitle { font-size: 1em; color: #888; font-weight: 300; letter-spacing: 0.1em; text-transform: uppercase; }
    .cover .brand-line { width: 1px; height: 60px; background: #ddd; margin: 30px auto; }
    
    .toc { padding: 60px 40px; max-width: 600px; margin: 0 auto; }
    .toc h2 { font-family: ${fonts.heading}; font-size: 1.2em; color: #888; margin-bottom: 30px; font-weight: 300; letter-spacing: 0.1em; text-transform: uppercase; }
    .toc ul { list-style: none; }
    .toc li { padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-size: 0.95em; color: #555; display: flex; align-items: center; gap: 16px; }
    .toc li .num { color: ${color}; font-weight: 500; font-size: 0.85em; min-width: 24px; }
    
    .chapter { padding: 50px 40px; max-width: 600px; margin: 0 auto; page-break-before: always; }
    .chapter h2 { font-family: ${fonts.heading}; font-size: 1.3em; color: #111; margin-bottom: 30px; font-weight: 400; display: flex; align-items: center; gap: 12px; }
    .chapter .ch-num { color: ${color}; font-weight: 500; font-size: 0.9em; }
    .chapter .content { font-size: 0.9em; line-height: 2; white-space: pre-wrap; color: #555; }
    .chapter .ch-image { max-width: 100%; margin: 24px 0; }
    
    .footer { text-align: center; padding: 60px 40px; page-break-before: always; }
    .footer img.qr { max-width: 100px; margin-bottom: 20px; opacity: 0.8; }
    .footer .brand-name { font-family: ${fonts.heading}; font-size: 1em; color: #888; font-weight: 300; letter-spacing: 0.1em; margin-bottom: 8px; }
    .footer p { color: #aaa; font-size: 0.8em; }
    
    @media print {
      .cover { page-break-after: always; }
      .chapter { page-break-before: always; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `;
}

function businessCSS(color: string, fonts: typeof FONT_SCHEMES.default): string {
  return `
    ${fonts.import}
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: ${fonts.body}; color: #2c3e50; line-height: 1.7; background: #fff; }
    
    .cover {
      text-align: center; padding: 60px 40px; min-height: 100vh;
      background: linear-gradient(180deg, #fff 0%, ${lighten(color, 0.9)} 100%);
      display: flex; flex-direction: column; justify-content: center; align-items: center;
      border-bottom: 6px solid ${color};
    }
    .cover img.logo { max-width: 160px; margin-bottom: 30px; }
    .cover img.cover-bg { max-width: 350px; margin: 20px 0; border: 2px solid ${lighten(color, 0.6)}; border-radius: 4px; }
    .cover h1 { font-family: ${fonts.heading}; font-size: 2.6em; color: ${darken(color, 0.1)}; margin-bottom: 12px; font-weight: 700; }
    .cover .subtitle { font-size: 1.1em; color: #666; font-weight: 400; }
    .cover .brand-line { width: 80px; height: 4px; background: ${color}; margin: 24px auto; }
    
    .toc { padding: 50px 40px; max-width: 700px; margin: 0 auto; border-left: 4px solid ${lighten(color, 0.7)}; margin-left: auto; margin-right: auto; }
    .toc h2 { font-family: ${fonts.heading}; font-size: 1.6em; color: ${color}; margin-bottom: 20px; }
    .toc ul { list-style: none; }
    .toc li { padding: 10px 16px; border-bottom: 1px solid #eee; font-size: 1em; display: flex; align-items: center; gap: 12px; }
    .toc li .num { background: ${lighten(color, 0.85)}; color: ${color}; font-weight: 700; font-size: 0.8em; padding: 2px 8px; border-radius: 3px; }
    
    .chapter { padding: 50px 40px; max-width: 700px; margin: 0 auto; page-break-before: always; }
    .chapter h2 { font-family: ${fonts.heading}; font-size: 1.5em; color: ${color}; margin-bottom: 20px; padding: 12px 20px; background: ${lighten(color, 0.92)}; border-left: 4px solid ${color}; display: flex; align-items: center; gap: 12px; }
    .chapter .ch-num { background: ${color}; color: white; width: 32px; height: 32px; line-height: 32px; text-align: center; border-radius: 4px; font-size: 0.8em; font-weight: 700; flex-shrink: 0; }
    .chapter .content { font-size: 0.95em; line-height: 1.8; white-space: pre-wrap; padding: 0 4px; }
    .chapter .ch-image { max-width: 100%; margin: 20px 0; border: 1px solid #e0e0e0; border-radius: 4px; }
    
    .footer { text-align: center; padding: 50px 40px; background: ${lighten(color, 0.95)}; border-top: 4px solid ${color}; page-break-before: always; }
    .footer img.qr { max-width: 120px; margin-bottom: 16px; }
    .footer .brand-name { font-family: ${fonts.heading}; font-size: 1.3em; color: ${color}; font-weight: 700; margin-bottom: 8px; }
    .footer p { color: #666; font-size: 0.85em; }
    
    @media print {
      .cover { page-break-after: always; }
      .chapter { page-break-before: always; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `;
}

function creativeCSS(color: string, fonts: typeof FONT_SCHEMES.default): string {
  return `
    ${fonts.import}
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: ${fonts.body}; color: #333; line-height: 1.7; background: #fff; }
    
    .cover {
      text-align: center; padding: 60px 40px; min-height: 100vh;
      background: ${color}; color: white;
      display: flex; flex-direction: column; justify-content: center; align-items: center;
      position: relative; overflow: hidden;
    }
    .cover::before { content: ''; position: absolute; width: 300px; height: 300px; background: rgba(255,255,255,0.05); border-radius: 50%; top: -50px; right: -50px; }
    .cover::after { content: ''; position: absolute; width: 200px; height: 200px; background: rgba(255,255,255,0.03); border-radius: 50%; bottom: -30px; left: -30px; }
    .cover img.logo { max-width: 150px; margin-bottom: 30px; filter: brightness(0) invert(1); position: relative; z-index: 1; }
    .cover img.cover-bg { max-width: 320px; margin: 20px 0; border-radius: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.2); position: relative; z-index: 1; }
    .cover h1 { font-family: ${fonts.heading}; font-size: 3em; margin-bottom: 12px; font-weight: 700; position: relative; z-index: 1; }
    .cover .subtitle { font-size: 1.2em; opacity: 0.8; position: relative; z-index: 1; }
    .cover .brand-line { width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.3); border-radius: 50%; margin: 24px auto; position: relative; z-index: 1; }
    
    .toc { padding: 60px 40px; max-width: 700px; margin: 0 auto; }
    .toc h2 { font-family: ${fonts.heading}; font-size: 2em; color: ${color}; margin-bottom: 24px; }
    .toc ul { list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .toc li { padding: 16px; background: ${lighten(color, 0.92)}; border-radius: 12px; font-size: 0.95em; display: flex; align-items: center; gap: 12px; }
    .toc li .num { color: white; background: ${color}; font-weight: 700; font-size: 0.75em; width: 28px; height: 28px; line-height: 28px; text-align: center; border-radius: 50%; flex-shrink: 0; }
    
    .chapter { padding: 50px 40px; max-width: 700px; margin: 0 auto; page-break-before: always; }
    .chapter h2 { font-family: ${fonts.heading}; font-size: 1.8em; color: ${color}; margin-bottom: 24px; display: flex; align-items: center; gap: 14px; }
    .chapter .ch-num { display: inline-flex; align-items: center; justify-content: center; background: linear-gradient(135deg, ${color}, ${lighten(color, 0.3)}); color: white; width: 44px; height: 44px; border-radius: 50%; font-size: 0.85em; font-weight: 700; flex-shrink: 0; }
    .chapter .content { font-size: 0.95em; line-height: 1.85; white-space: pre-wrap; }
    .chapter .ch-image { max-width: 100%; margin: 24px 0; border-radius: 16px; box-shadow: 0 8px 30px rgba(0,0,0,0.1); }
    
    .footer { text-align: center; padding: 60px 40px; background: ${color}; color: white; page-break-before: always; }
    .footer img.qr { max-width: 120px; margin-bottom: 16px; border-radius: 12px; background: white; padding: 8px; }
    .footer .brand-name { font-family: ${fonts.heading}; font-size: 1.4em; font-weight: 700; margin-bottom: 8px; }
    .footer p { opacity: 0.7; font-size: 0.85em; }
    
    @media print {
      .cover { page-break-after: always; }
      .cover::before, .cover::after { display: none; }
      .chapter { page-break-before: always; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `;
}

// ─── Theme CSS Selector ────────────────────────────────────────
function getThemeCSS(style: string, color: string, fontScheme: string): string {
  const fonts = FONT_SCHEMES[fontScheme] || FONT_SCHEMES.default;
  switch (style) {
    case "modern": return modernCSS(color, fonts);
    case "minimal": return minimalCSS(color, fonts);
    case "business": return businessCSS(color, fonts);
    case "creative": return creativeCSS(color, fonts);
    default: return classicCSS(color, fonts);
  }
}

// ─── Main HTML Generator ───────────────────────────────────────
export function generateThemedManualHtml(
  data: ManualData,
  lang: string,
  theme: ManualThemeConfig
): string {
  const isEn = lang === "en";
  const { chapters, brandName, logoUrl, coverImageUrl, contentBgUrl, qrCodeUrl } = data;
  const title = isEn ? `${brandName} Product Manual` : `${brandName} Manual del Producto`;
  const css = getThemeCSS(theme.themeStyle, theme.themeColor, theme.fontScheme);

  const chaptersHtml = chapters.map((ch, i) => {
    const chTitle = isEn ? (ch.titleEn || ch.key) : (ch.titleEs || ch.titleEn || ch.key);
    const chContent = isEn ? (ch.contentEn || "") : (ch.contentEs || ch.contentEn || "");
    const imageHtml = ch.imageUrl ? `<img class="ch-image" src="${ch.imageUrl}" alt="Chapter ${i + 1}"/>` : "";
    return `
    <div class="chapter">
      <h2><span class="ch-num">${i + 1}</span> ${chTitle}</h2>
      ${imageHtml}
      <div class="content">${chContent.replace(/\n/g, "<br/>")}</div>
    </div>`;
  }).join("\n");

  const tocItems = chapters.map((ch, i) => {
    const chTitle = isEn ? (ch.titleEn || ch.key) : (ch.titleEs || ch.titleEn || ch.key);
    return `<li><span class="num">${i + 1}</span> ${chTitle}</li>`;
  }).join("\n      ");

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>${css}</style>
</head>
<body>
  <div class="cover">
    ${logoUrl ? `<img class="logo" src="${logoUrl}" alt="${brandName}"/>` : ""}
    <div class="brand-line"></div>
    <h1>${title}</h1>
    <p class="subtitle">${isEn ? "User Manual" : "Manual de Usuario"}</p>
    ${coverImageUrl ? `<img class="cover-bg" src="${coverImageUrl}" alt="Product"/>` : ""}
  </div>

  <div class="toc">
    <h2>${isEn ? "Table of Contents" : "Indice"}</h2>
    <ul>
      ${tocItems}
    </ul>
  </div>

  ${chaptersHtml}

  <div class="footer">
    <p class="brand-name">${brandName}</p>
    ${qrCodeUrl ? `<img class="qr" src="${qrCodeUrl}" alt="QR Code"/>` : ""}
    <p>&copy; ${new Date().getFullYear()} ${brandName}. ${isEn ? "All rights reserved." : "Todos los derechos reservados."}</p>
  </div>
</body>
</html>`;
}

// ─── Theme Presets for Frontend ────────────────────────────────
export const THEME_PRESETS = [
  {
    id: "classic",
    name: "Classic",
    nameZh: "经典",
    desc: "Traditional manual style with gradient cover and clean typography",
    descZh: "传统说明书风格，渐变封面配简洁排版",
    defaultColor: "#1a1a2e",
    preview: "gradient-cover",
  },
  {
    id: "modern",
    name: "Modern",
    nameZh: "现代",
    desc: "Asymmetric layout with card-based navigation and rounded elements",
    descZh: "不对称布局，卡片式导航，圆角元素",
    defaultColor: "#2563eb",
    preview: "asymmetric-layout",
  },
  {
    id: "minimal",
    name: "Minimal",
    nameZh: "极简",
    desc: "Clean whitespace-focused design with light typography",
    descZh: "留白设计，轻量排版，注重内容",
    defaultColor: "#374151",
    preview: "whitespace-focused",
  },
  {
    id: "business",
    name: "Business",
    nameZh: "商务",
    desc: "Professional corporate style with structured headers and borders",
    descZh: "专业商务风格，结构化标题和边框",
    defaultColor: "#0f766e",
    preview: "corporate-structured",
  },
  {
    id: "creative",
    name: "Creative",
    nameZh: "创意",
    desc: "Bold colors with geometric shapes and dynamic layout",
    descZh: "大胆配色，几何图形，动态布局",
    defaultColor: "#7c3aed",
    preview: "bold-geometric",
  },
];

export const FONT_PRESETS = [
  { id: "default", name: "Default", nameZh: "默认", desc: "System fonts" },
  { id: "serif", name: "Serif", nameZh: "衬线体", desc: "Playfair Display + Lora" },
  { id: "sans", name: "Sans", nameZh: "无衬线", desc: "Inter" },
  { id: "elegant", name: "Elegant", nameZh: "优雅", desc: "Cormorant + Nunito Sans" },
  { id: "tech", name: "Tech", nameZh: "科技", desc: "Space Grotesk + IBM Plex" },
];
