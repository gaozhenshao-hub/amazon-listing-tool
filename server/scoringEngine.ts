/**
 * Amazon Listing Scoring Engine
 * 
 * Evaluates listing quality across 6 dimensions based on A9 algorithm rules:
 * 1. Title Optimization (标题优化度) - 25 points
 * 2. Bullet Points Quality (五点描述质量) - 25 points
 * 3. Description Quality (产品描述质量) - 15 points
 * 4. Search Terms Optimization (搜索词优化度) - 15 points
 * 5. Keyword Coverage (关键词覆盖率) - 10 points
 * 6. Overall SEO Score (整体SEO评分) - 10 points
 * Total: 100 points
 */

/**
 * Data structure from the keyword management module.
 * Replaces the old ABA-based a9Keywords structure.
 */
export interface KeywordModuleData {
  coreKeywords: string[];
  keywordsByPlacement: {
    titleFront: string[];
    titleMid: string[];
    titleEnd: string[];
    bulletFirst: string[];
    bulletBody: string[];
    aplus: string[];
    searchTerm: string[];
  };
  keywordsByStrategy: {
    coreMain: string[];
    subCore: string[];
    preciseLongtail: string[];
    sceneIntent: string[];
    longtailMain: string[];
  };
  totalKeywords: number;
}

export interface ScoreDimension {
  name: string;
  nameCn: string;
  score: number;
  maxScore: number;
  percentage: number; // 0-100
  grade: "A" | "B" | "C" | "D" | "F";
  details: ScoreDetail[];
}

export interface ScoreDetail {
  rule: string;
  ruleCn: string;
  passed: boolean;
  score: number;
  maxScore: number;
  message: string;
  messageCn: string;
  severity: "critical" | "warning" | "info";
  coveredKeywords?: string[];
  missingKeywords?: string[];
}

export interface OptimizationSuggestion {
  dimension: string;
  dimensionCn: string;
  priority: "high" | "medium" | "low";
  suggestion: string;
  suggestionCn: string;
  impact: string;
  impactCn: string;
}

export interface ListingScore {
  totalScore: number;
  maxScore: number;
  percentage: number;
  grade: "A+" | "A" | "B+" | "B" | "C" | "D" | "F";
  dimensions: ScoreDimension[];
  suggestions: OptimizationSuggestion[];
  scoredAt: string;
}

function getGrade(percentage: number): "A" | "B" | "C" | "D" | "F" {
  if (percentage >= 90) return "A";
  if (percentage >= 75) return "B";
  if (percentage >= 60) return "C";
  if (percentage >= 40) return "D";
  return "F";
}

function getOverallGrade(percentage: number): "A+" | "A" | "B+" | "B" | "C" | "D" | "F" {
  if (percentage >= 95) return "A+";
  if (percentage >= 85) return "A";
  if (percentage >= 78) return "B+";
  if (percentage >= 70) return "B";
  if (percentage >= 55) return "C";
  if (percentage >= 40) return "D";
  return "F";
}

// ─── Dimension 1: Title Optimization (25 points) ─────────────────

function scoreTitleOptimization(title: string | null, keywords: string[]): ScoreDimension {
  const details: ScoreDetail[] = [];
  let totalScore = 0;

  const titleText = title || "";
  const titleLen = titleText.length;

  // Rule 1: Title length 180-200 chars (8 points)
  if (titleLen >= 180 && titleLen <= 200) {
    details.push({
      rule: "Title Length (180-200 chars)",
      ruleCn: "标题长度 (180-200字符)",
      passed: true, score: 8, maxScore: 8,
      message: `Title is ${titleLen} characters - optimal range`,
      messageCn: `标题${titleLen}字符 - 在最佳范围内`,
      severity: "info",
    });
    totalScore += 8;
  } else if (titleLen >= 150 && titleLen < 180) {
    details.push({
      rule: "Title Length (180-200 chars)",
      ruleCn: "标题长度 (180-200字符)",
      passed: false, score: 4, maxScore: 8,
      message: `Title is ${titleLen} characters - slightly short, aim for 180-200`,
      messageCn: `标题${titleLen}字符 - 偏短，建议180-200字符`,
      severity: "warning",
    });
    totalScore += 4;
  } else if (titleLen > 200 && titleLen <= 250) {
    details.push({
      rule: "Title Length (180-200 chars)",
      ruleCn: "标题长度 (180-200字符)",
      passed: false, score: 3, maxScore: 8,
      message: `Title is ${titleLen} characters - too long, may be truncated`,
      messageCn: `标题${titleLen}字符 - 过长，可能被截断`,
      severity: "warning",
    });
    totalScore += 3;
  } else {
    details.push({
      rule: "Title Length (180-200 chars)",
      ruleCn: "标题长度 (180-200字符)",
      passed: false, score: titleLen > 0 ? 1 : 0, maxScore: 8,
      message: titleLen === 0 ? "Title is empty" : `Title is ${titleLen} characters - far from optimal range`,
      messageCn: titleLen === 0 ? "标题为空" : `标题${titleLen}字符 - 远离最佳范围`,
      severity: "critical",
    });
    totalScore += titleLen > 0 ? 1 : 0;
  }

  // Rule 2: Brand name in title (3 points)
  const hasBrand = titleText.length > 0; // We check if title exists; brand detection is done via keyword matching
  details.push({
    rule: "Title Not Empty",
    ruleCn: "标题非空",
    passed: titleLen > 0, score: titleLen > 0 ? 3 : 0, maxScore: 3,
    message: titleLen > 0 ? "Title content exists" : "Title is missing",
    messageCn: titleLen > 0 ? "标题内容存在" : "标题缺失",
    severity: titleLen > 0 ? "info" : "critical",
  });
  totalScore += titleLen > 0 ? 3 : 0;

  // Rule 3: No all-caps abuse (2 points)
  const allCapsWords = titleText.split(/\s+/).filter(w => w.length > 3 && w === w.toUpperCase() && /[A-Z]/.test(w));
  const capsRatio = titleText.split(/\s+/).length > 0 ? allCapsWords.length / titleText.split(/\s+/).length : 0;
  const capsOk = capsRatio < 0.3;
  details.push({
    rule: "No Excessive Capitalization",
    ruleCn: "无过度大写",
    passed: capsOk, score: capsOk ? 2 : 0, maxScore: 2,
    message: capsOk ? "Capitalization is appropriate" : `${allCapsWords.length} words in ALL CAPS - Amazon may suppress listing`,
    messageCn: capsOk ? "大写使用合理" : `${allCapsWords.length}个全大写单词 - 亚马逊可能抑制展示`,
    severity: capsOk ? "info" : "warning",
  });
  totalScore += capsOk ? 2 : 0;

  // Rule 4: No special characters abuse (2 points)
  const specialChars = (titleText.match(/[!@#$%^&*(){}[\]|\\<>~`]/g) || []).length;
  const specialOk = specialChars <= 3;
  details.push({
    rule: "No Special Character Abuse",
    ruleCn: "无特殊字符滥用",
    passed: specialOk, score: specialOk ? 2 : 0, maxScore: 2,
    message: specialOk ? "Special characters within acceptable range" : `${specialChars} special characters found - may trigger Amazon filter`,
    messageCn: specialOk ? "特殊字符在可接受范围内" : `发现${specialChars}个特殊字符 - 可能触发亚马逊过滤`,
    severity: specialOk ? "info" : "warning",
  });
  totalScore += specialOk ? 2 : 0;

  // Rule 5: Keyword density in title (5 points)
  const titleLower = titleText.toLowerCase();
  const matchedKeywords = keywords.filter(kw => titleLower.includes(kw.toLowerCase()));
  const keywordCoverage = keywords.length > 0 ? matchedKeywords.length / Math.min(keywords.length, 10) : 0;
  let kwScore = 0;
  if (keywordCoverage >= 0.6) kwScore = 5;
  else if (keywordCoverage >= 0.4) kwScore = 3;
  else if (keywordCoverage >= 0.2) kwScore = 2;
  else if (keywords.length === 0) kwScore = 3; // No keywords uploaded, give partial credit
  details.push({
    rule: "Core Keyword Coverage in Title",
    ruleCn: "标题核心关键词覆盖",
    passed: kwScore >= 3, score: kwScore, maxScore: 5,
    message: keywords.length > 0
      ? `${matchedKeywords.length}/${Math.min(keywords.length, 10)} core keywords found in title (${Math.round(keywordCoverage * 100)}%)`
      : "No keyword data available - add keywords in the keyword management module for detailed analysis",
    messageCn: keywords.length > 0
      ? `标题中包含${matchedKeywords.length}/${Math.min(keywords.length, 10)}个核心关键词 (${Math.round(keywordCoverage * 100)}%)`
      : "无关键词数据 - 请在关键词管理模块添加关键词以获得详细分析",
    severity: kwScore >= 3 ? "info" : "warning",
  });
  totalScore += kwScore;

  // Rule 6: Title structure (pipe/dash separators) (5 points)
  const hasSeparators = /[|,\-–—]/.test(titleText);
  const wordCount = titleText.split(/\s+/).filter(Boolean).length;
  const structureOk = hasSeparators && wordCount >= 15;
  const structScore = structureOk ? 5 : (hasSeparators || wordCount >= 10) ? 3 : (titleLen > 0 ? 1 : 0);
  details.push({
    rule: "Title Structure & Readability",
    ruleCn: "标题结构与可读性",
    passed: structScore >= 3, score: structScore, maxScore: 5,
    message: structureOk
      ? `Well-structured title with ${wordCount} words and proper separators`
      : `Title structure could be improved (${wordCount} words, ${hasSeparators ? "has" : "no"} separators)`,
    messageCn: structureOk
      ? `标题结构良好，${wordCount}个单词，分隔符使用得当`
      : `标题结构可改进 (${wordCount}个单词，${hasSeparators ? "有" : "无"}分隔符)`,
    severity: structScore >= 3 ? "info" : "warning",
  });
  totalScore += structScore;

  const percentage = Math.round((totalScore / 25) * 100);
  return {
    name: "Title Optimization",
    nameCn: "标题优化度",
    score: totalScore,
    maxScore: 25,
    percentage,
    grade: getGrade(percentage),
    details,
  };
}

// ─── Dimension 2: Bullet Points Quality (25 points) ──────────────

function scoreBulletPoints(bulletPointsJson: string | null, keywords: string[]): ScoreDimension {
  const details: ScoreDetail[] = [];
  let totalScore = 0;

  let bullets: any[] = [];
  try {
    if (bulletPointsJson) {
      const parsed = JSON.parse(bulletPointsJson);
      if (Array.isArray(parsed)) bullets = parsed;
      else if (parsed?.bulletPoints && Array.isArray(parsed.bulletPoints)) bullets = parsed.bulletPoints;
    }
  } catch {}

  // Rule 1: Has exactly 5 bullet points (5 points)
  const bulletCount = bullets.length;
  const has5 = bulletCount === 5;
  details.push({
    rule: "5 Bullet Points Present",
    ruleCn: "包含5条要点",
    passed: has5, score: has5 ? 5 : Math.max(0, bulletCount), maxScore: 5,
    message: has5 ? "All 5 bullet points present" : `Only ${bulletCount} bullet points found (need 5)`,
    messageCn: has5 ? "5条要点齐全" : `仅有${bulletCount}条要点 (需要5条)`,
    severity: has5 ? "info" : "critical",
  });
  totalScore += has5 ? 5 : Math.min(bulletCount, 4);

  // Rule 2: Character count compliance 200-280 per bullet (8 points)
  let compliantCount = 0;
  let totalChars = 0;
  for (const bp of bullets) {
    const text = bp.subtitle && bp.fullText
      ? `${bp.subtitle} ${bp.fullText}`
      : bp.fullText || bp.subtitle || bp.text || (typeof bp === "string" ? bp : "");
    const len = text.length;
    totalChars += len;
    if (len >= 200 && len <= 280) compliantCount++;
  }
  const charCompliance = bulletCount > 0 ? compliantCount / bulletCount : 0;
  const charScore = Math.round(charCompliance * 8);
  details.push({
    rule: "Character Count Compliance (200-280 per bullet)",
    ruleCn: "字符数合规 (每条200-280字符)",
    passed: charCompliance >= 0.8, score: charScore, maxScore: 8,
    message: `${compliantCount}/${bulletCount} bullets within 200-280 char range`,
    messageCn: `${compliantCount}/${bulletCount}条要点在200-280字符范围内`,
    severity: charCompliance >= 0.8 ? "info" : charCompliance >= 0.5 ? "warning" : "critical",
  });
  totalScore += charScore;

  // Rule 3: FABE structure (subtitle + fullText) (4 points)
  let fabeCount = 0;
  for (const bp of bullets) {
    if (bp.subtitle && bp.fullText && bp.subtitle.length > 0 && bp.fullText.length > 0) {
      fabeCount++;
    }
  }
  const fabeCompliance = bulletCount > 0 ? fabeCount / bulletCount : 0;
  const fabeScore = Math.round(fabeCompliance * 4);
  details.push({
    rule: "FABE Structure (Subtitle + Description)",
    ruleCn: "FABE结构 (小标题 + 描述)",
    passed: fabeCompliance >= 0.8, score: fabeScore, maxScore: 4,
    message: `${fabeCount}/${bulletCount} bullets have proper FABE structure`,
    messageCn: `${fabeCount}/${bulletCount}条要点具有FABE结构`,
    severity: fabeCompliance >= 0.8 ? "info" : "warning",
  });
  totalScore += fabeScore;

  // Rule 4: Keyword integration in bullets (5 points)
  const allBulletText = bullets.map(bp => {
    const text = bp.subtitle && bp.fullText
      ? `${bp.subtitle} ${bp.fullText}`
      : bp.fullText || bp.subtitle || bp.text || (typeof bp === "string" ? bp : "");
    return text;
  }).join(" ").toLowerCase();
  
  const bulletKeywordMatches = keywords.filter(kw => allBulletText.includes(kw.toLowerCase()));
  const bulletKwCoverage = keywords.length > 0 ? bulletKeywordMatches.length / Math.min(keywords.length, 15) : 0;
  let bulletKwScore = 0;
  if (bulletKwCoverage >= 0.5) bulletKwScore = 5;
  else if (bulletKwCoverage >= 0.3) bulletKwScore = 3;
  else if (bulletKwCoverage >= 0.15) bulletKwScore = 2;
  else if (keywords.length === 0) bulletKwScore = 3;
  details.push({
    rule: "Keyword Integration in Bullets",
    ruleCn: "要点中关键词整合",
    passed: bulletKwScore >= 3, score: bulletKwScore, maxScore: 5,
    message: keywords.length > 0
      ? `${bulletKeywordMatches.length} keywords found across bullet points`
      : "No keyword data - add keywords in the keyword management module for analysis",
    messageCn: keywords.length > 0
      ? `要点中包含${bulletKeywordMatches.length}个关键词`
      : "无关键词数据 - 请在关键词管理模块添加关键词以获得分析",
    severity: bulletKwScore >= 3 ? "info" : "warning",
  });
  totalScore += bulletKwScore;

  // Rule 5: Unique selling points diversity (3 points)
  const sellingPoints = bullets.map(bp => bp.sellingPoint || bp.subtitle || "").filter(Boolean);
  const uniqueSPs = new Set(sellingPoints.map(sp => sp.toLowerCase()));
  const diversityOk = uniqueSPs.size >= Math.min(bulletCount, 4);
  const diversityScore = diversityOk ? 3 : Math.min(uniqueSPs.size, 2);
  details.push({
    rule: "Selling Point Diversity",
    ruleCn: "卖点多样性",
    passed: diversityOk, score: diversityScore, maxScore: 3,
    message: `${uniqueSPs.size} unique selling points across ${bulletCount} bullets`,
    messageCn: `${bulletCount}条要点中有${uniqueSPs.size}个不同卖点`,
    severity: diversityOk ? "info" : "warning",
  });
  totalScore += diversityScore;

  const percentage = Math.round((totalScore / 25) * 100);
  return {
    name: "Bullet Points Quality",
    nameCn: "五点描述质量",
    score: totalScore,
    maxScore: 25,
    percentage,
    grade: getGrade(percentage),
    details,
  };
}

// ─── Dimension 3: Description Quality (15 points) ────────────────

function scoreDescription(description: string | null, keywords: string[]): ScoreDimension {
  const details: ScoreDetail[] = [];
  let totalScore = 0;

  const descText = description || "";
  const descLen = descText.length;

  // Rule 1: Description length (5 points) - ideal: 1000-2000 chars
  let lenScore = 0;
  if (descLen >= 1000 && descLen <= 2000) lenScore = 5;
  else if (descLen >= 500 && descLen < 1000) lenScore = 3;
  else if (descLen >= 200 && descLen < 500) lenScore = 2;
  else if (descLen > 2000) lenScore = 4;
  else if (descLen > 0) lenScore = 1;
  details.push({
    rule: "Description Length (1000-2000 chars ideal)",
    ruleCn: "描述长度 (理想1000-2000字符)",
    passed: lenScore >= 4, score: lenScore, maxScore: 5,
    message: descLen === 0 ? "Description is empty" : `Description is ${descLen} characters`,
    messageCn: descLen === 0 ? "描述为空" : `描述${descLen}字符`,
    severity: lenScore >= 4 ? "info" : lenScore >= 2 ? "warning" : "critical",
  });
  totalScore += lenScore;

  // Rule 2: Has paragraphs/structure (3 points)
  const paragraphs = descText.split(/\n\n|\n/).filter(p => p.trim().length > 20);
  const hasStructure = paragraphs.length >= 2;
  const structScore = hasStructure ? 3 : (descLen > 100 ? 1 : 0);
  details.push({
    rule: "Content Structure (paragraphs)",
    ruleCn: "内容结构 (段落划分)",
    passed: hasStructure, score: structScore, maxScore: 3,
    message: `${paragraphs.length} content sections found`,
    messageCn: `发现${paragraphs.length}个内容段落`,
    severity: hasStructure ? "info" : "warning",
  });
  totalScore += structScore;

  // Rule 3: Keyword presence in description (4 points)
  const descLower = descText.toLowerCase();
  const descKwMatches = keywords.filter(kw => descLower.includes(kw.toLowerCase()));
  const descKwCoverage = keywords.length > 0 ? descKwMatches.length / Math.min(keywords.length, 15) : 0;
  let descKwScore = 0;
  if (descKwCoverage >= 0.4) descKwScore = 4;
  else if (descKwCoverage >= 0.25) descKwScore = 3;
  else if (descKwCoverage >= 0.1) descKwScore = 2;
  else if (keywords.length === 0) descKwScore = 2;
  details.push({
    rule: "Keyword Integration in Description",
    ruleCn: "描述中关键词整合",
    passed: descKwScore >= 3, score: descKwScore, maxScore: 4,
    message: keywords.length > 0
      ? `${descKwMatches.length} keywords found in description`
      : "No keyword data available",
    messageCn: keywords.length > 0
      ? `描述中包含${descKwMatches.length}个关键词`
      : "无关键词数据",
    severity: descKwScore >= 3 ? "info" : "warning",
  });
  totalScore += descKwScore;

  // Rule 4: No prohibited content (3 points)
  const prohibitedPatterns = [
    /free shipping/i, /best seller/i, /#1/i, /number one/i,
    /guaranteed/i, /warranty/i, /money back/i,
  ];
  const violations = prohibitedPatterns.filter(p => p.test(descText));
  const noViolations = violations.length === 0;
  details.push({
    rule: "No Prohibited Claims",
    ruleCn: "无违规声明",
    passed: noViolations, score: noViolations ? 3 : Math.max(0, 3 - violations.length), maxScore: 3,
    message: noViolations ? "No prohibited claims detected" : `${violations.length} potential policy violations found`,
    messageCn: noViolations ? "未检测到违规声明" : `发现${violations.length}个潜在违规声明`,
    severity: noViolations ? "info" : "warning",
  });
  totalScore += noViolations ? 3 : Math.max(0, 3 - violations.length);

  const percentage = Math.round((totalScore / 15) * 100);
  return {
    name: "Description Quality",
    nameCn: "产品描述质量",
    score: totalScore,
    maxScore: 15,
    percentage,
    grade: getGrade(percentage),
    details,
  };
}

// ─── Dimension 4: Search Terms Optimization (15 points) ──────────

function scoreSearchTerms(searchTerms: string | null, title: string | null, bulletPointsJson: string | null): ScoreDimension {
  const details: ScoreDetail[] = [];
  let totalScore = 0;

  const stText = searchTerms || "";
  const stLen = stText.length;

  // Rule 1: Search terms length (5 points) - max 249 bytes
  const byteLen = new TextEncoder().encode(stText).length;
  let stLenScore = 0;
  if (byteLen > 0 && byteLen <= 249) stLenScore = 5;
  else if (byteLen > 249 && byteLen <= 300) stLenScore = 3;
  else if (byteLen > 300) stLenScore = 1;
  else stLenScore = 0;
  details.push({
    rule: "Search Terms Length (≤249 bytes)",
    ruleCn: "搜索词长度 (≤249字节)",
    passed: stLenScore >= 5, score: stLenScore, maxScore: 5,
    message: stLen === 0 ? "Search terms are empty" : `Search terms: ${byteLen} bytes (limit: 249)`,
    messageCn: stLen === 0 ? "搜索词为空" : `搜索词: ${byteLen}字节 (限制: 249)`,
    severity: stLenScore >= 5 ? "info" : stLenScore >= 3 ? "warning" : "critical",
  });
  totalScore += stLenScore;

  // Rule 2: No duplicate words with title (4 points)
  const titleWords = new Set((title || "").toLowerCase().split(/[\s,\-|]+/).filter(w => w.length > 2));
  const stWords = stText.toLowerCase().split(/[\s,]+/).filter(w => w.length > 2);
  const duplicates = stWords.filter(w => titleWords.has(w));
  const dupRatio = stWords.length > 0 ? duplicates.length / stWords.length : 0;
  let dupScore = 0;
  if (dupRatio <= 0.1) dupScore = 4;
  else if (dupRatio <= 0.25) dupScore = 3;
  else if (dupRatio <= 0.4) dupScore = 2;
  else dupScore = stWords.length > 0 ? 1 : 0;
  details.push({
    rule: "No Redundancy with Title",
    ruleCn: "与标题无冗余重复",
    passed: dupScore >= 3, score: dupScore, maxScore: 4,
    message: stWords.length > 0
      ? `${duplicates.length}/${stWords.length} words overlap with title (${Math.round(dupRatio * 100)}%)`
      : "No search terms to analyze",
    messageCn: stWords.length > 0
      ? `${duplicates.length}/${stWords.length}个词与标题重复 (${Math.round(dupRatio * 100)}%)`
      : "无搜索词可分析",
    severity: dupScore >= 3 ? "info" : "warning",
  });
  totalScore += dupScore;

  // Rule 3: Word count diversity (3 points)
  const uniqueStWords = new Set(stWords);
  const diversityRatio = stWords.length > 0 ? uniqueStWords.size / stWords.length : 0;
  let divScore = 0;
  if (diversityRatio >= 0.85) divScore = 3;
  else if (diversityRatio >= 0.7) divScore = 2;
  else divScore = stWords.length > 0 ? 1 : 0;
  details.push({
    rule: "Word Diversity (no internal duplicates)",
    ruleCn: "词汇多样性 (无内部重复)",
    passed: divScore >= 2, score: divScore, maxScore: 3,
    message: `${uniqueStWords.size} unique words out of ${stWords.length} total`,
    messageCn: `共${stWords.length}个词中有${uniqueStWords.size}个不重复`,
    severity: divScore >= 2 ? "info" : "warning",
  });
  totalScore += divScore;

  // Rule 4: No commas (Amazon ignores them, use spaces) (3 points)
  const hasCommas = stText.includes(",");
  const commaScore = hasCommas ? 1 : (stLen > 0 ? 3 : 0);
  details.push({
    rule: "Space-Separated Format (no commas)",
    ruleCn: "空格分隔格式 (无逗号)",
    passed: !hasCommas && stLen > 0, score: commaScore, maxScore: 3,
    message: hasCommas ? "Commas found - Amazon ignores them, use spaces instead" : (stLen > 0 ? "Correct space-separated format" : "No search terms"),
    messageCn: hasCommas ? "发现逗号 - 亚马逊会忽略逗号，请用空格分隔" : (stLen > 0 ? "正确的空格分隔格式" : "无搜索词"),
    severity: hasCommas ? "warning" : "info",
  });
  totalScore += commaScore;

  const percentage = Math.round((totalScore / 15) * 100);
  return {
    name: "Search Terms Optimization",
    nameCn: "搜索词优化度",
    score: totalScore,
    maxScore: 15,
    percentage,
    grade: getGrade(percentage),
    details,
  };
}

// ─── Dimension 5: Keyword Coverage (10 points) ───────────────────

function scoreKeywordCoverage(
  title: string | null,
  bulletPointsJson: string | null,
  description: string | null,
  searchTerms: string | null,
  kwData: KeywordModuleData | null
): ScoreDimension {
  const details: ScoreDetail[] = [];
  let totalScore = 0;

  // Combine all listing text
  const allText = [title || "", description || "", searchTerms || ""].join(" ");
  let bulletText = "";
  try {
    if (bulletPointsJson) {
      const parsed = JSON.parse(bulletPointsJson);
      const bullets = Array.isArray(parsed) ? parsed : parsed?.bulletPoints || [];
      bulletText = bullets.map((bp: any) => {
        return bp.subtitle && bp.fullText
          ? `${bp.subtitle} ${bp.fullText}`
          : bp.fullText || bp.subtitle || bp.text || (typeof bp === "string" ? bp : "");
      }).join(" ");
    }
  } catch {}
  const fullText = (allText + " " + bulletText).toLowerCase();

  if (!kwData || kwData.totalKeywords === 0) {
    // No keyword data available
    details.push({
      rule: "Keyword Module Data Available",
      ruleCn: "关键词模块数据可用",
      passed: false, score: 5, maxScore: 10,
      message: "No keyword data available - add keywords in the keyword management module for detailed coverage analysis",
      messageCn: "无关键词数据 - 请在关键词管理模块添加关键词以获得详细覆盖分析",
      severity: "info",
    });
    totalScore += 5;
  } else {
    // Check title placement keywords coverage (title_front + title_mid + title_end)
    const titleKws = [
      ...kwData.keywordsByPlacement.titleFront,
      ...kwData.keywordsByPlacement.titleMid,
      ...kwData.keywordsByPlacement.titleEnd,
    ];
    // Also include core_main strategy keywords as title must-haves
    const titleMustHave = Array.from(new Set([
      ...titleKws,
      ...kwData.keywordsByStrategy.coreMain,
    ].map(k => k.toLowerCase())));

    const titleKwMatched = titleMustHave.filter(kw => fullText.includes(kw));
    const titleKwMissing = titleMustHave.filter(kw => !fullText.includes(kw));
    const titleKwCoverage = titleMustHave.length > 0 ? titleKwMatched.length / titleMustHave.length : 1;
    const titleKwScore = Math.round(titleKwCoverage * 4);
    details.push({
      rule: "Title Placement Keywords Coverage",
      ruleCn: "标题布局关键词覆盖率",
      passed: titleKwCoverage >= 0.7, score: titleKwScore, maxScore: 4,
      message: `${titleKwMatched.length}/${titleMustHave.length} title-placement keywords found in listing`,
      messageCn: `Listing中包含${titleKwMatched.length}/${titleMustHave.length}个标题布局关键词`,
      severity: titleKwCoverage >= 0.7 ? "info" : "warning",
      coveredKeywords: titleKwMatched,
      missingKeywords: titleKwMissing,
    });
    totalScore += titleKwScore;

    // Check bullet placement keywords coverage (bullet_first + bullet_body)
    const bulletKws = Array.from(new Set([
      ...kwData.keywordsByPlacement.bulletFirst,
      ...kwData.keywordsByPlacement.bulletBody,
      ...kwData.keywordsByStrategy.subCore,
    ].map(k => k.toLowerCase())));

    const bulletKwMatched = bulletKws.filter(kw => fullText.includes(kw));
    const bulletKwMissing = bulletKws.filter(kw => !fullText.includes(kw));
    const bulletKwCoverage = bulletKws.length > 0 ? bulletKwMatched.length / bulletKws.length : 1;
    const bulletKwScore = Math.round(bulletKwCoverage * 3);
    details.push({
      rule: "Bullet Placement Keywords Coverage",
      ruleCn: "要点布局关键词覆盖率",
      passed: bulletKwCoverage >= 0.6, score: bulletKwScore, maxScore: 3,
      message: `${bulletKwMatched.length}/${bulletKws.length} bullet-placement keywords found in listing`,
      messageCn: `Listing中包含${bulletKwMatched.length}/${bulletKws.length}个要点布局关键词`,
      severity: bulletKwCoverage >= 0.6 ? "info" : "warning",
      coveredKeywords: bulletKwMatched,
      missingKeywords: bulletKwMissing,
    });
    totalScore += bulletKwScore;

    // Check long-tail & scene keywords coverage (precise_longtail + scene_intent + search_term placement)
    const longtailKws = Array.from(new Set([
      ...kwData.keywordsByStrategy.preciseLongtail,
      ...kwData.keywordsByStrategy.sceneIntent,
      ...kwData.keywordsByPlacement.searchTerm,
    ].map(k => k.toLowerCase())));

    const longtailMatched = longtailKws.filter(kw => fullText.includes(kw));
    const longtailMissing = longtailKws.filter(kw => !fullText.includes(kw));
    const longtailCoverage = longtailKws.length > 0 ? longtailMatched.length / longtailKws.length : 1;
    const longtailScore = Math.round(longtailCoverage * 3);
    details.push({
      rule: "Long-tail & Scene Keywords Coverage",
      ruleCn: "长尾词与场景词覆盖率",
      passed: longtailCoverage >= 0.5, score: longtailScore, maxScore: 3,
      message: `${longtailMatched.length}/${longtailKws.length} long-tail/scene keywords found in listing`,
      messageCn: `Listing中包含${longtailMatched.length}/${longtailKws.length}个长尾/场景关键词`,
      severity: longtailCoverage >= 0.5 ? "info" : "warning",
      coveredKeywords: longtailMatched,
      missingKeywords: longtailMissing,
    });
    totalScore += longtailScore;
  }

  const percentage = Math.round((totalScore / 10) * 100);
  return {
    name: "Keyword Coverage",
    nameCn: "关键词覆盖率",
    score: totalScore,
    maxScore: 10,
    percentage,
    grade: getGrade(percentage),
    details,
  };
}

// ─── Dimension 6: Overall SEO Score (10 points) ──────────────────

function scoreOverallSEO(
  title: string | null,
  bulletPointsJson: string | null,
  description: string | null,
  searchTerms: string | null,
  hasChinese: boolean,
  hasImageAdvice: boolean
): ScoreDimension {
  const details: ScoreDetail[] = [];
  let totalScore = 0;

  // Rule 1: All sections complete (3 points)
  const sections = [
    { name: "Title", present: !!title && title.length > 0 },
    { name: "Bullet Points", present: !!bulletPointsJson },
    { name: "Description", present: !!description && description.length > 0 },
    { name: "Search Terms", present: !!searchTerms && searchTerms.length > 0 },
  ];
  const completeSections = sections.filter(s => s.present).length;
  const completionScore = Math.round((completeSections / 4) * 3);
  const missingSections = sections.filter(s => !s.present).map(s => s.name);
  details.push({
    rule: "Listing Completeness",
    ruleCn: "Listing完整性",
    passed: completeSections === 4, score: completionScore, maxScore: 3,
    message: completeSections === 4
      ? "All listing sections are complete"
      : `Missing: ${missingSections.join(", ")}`,
    messageCn: completeSections === 4
      ? "所有Listing部分均已完成"
      : `缺失: ${missingSections.join(", ")}`,
    severity: completeSections === 4 ? "info" : "critical",
  });
  totalScore += completionScore;

  // Rule 2: Bilingual content available (3 points)
  const bilingualScore = hasChinese ? 3 : 0;
  details.push({
    rule: "Bilingual Content (Chinese Translation)",
    ruleCn: "双语内容 (中文翻译)",
    passed: hasChinese, score: bilingualScore, maxScore: 3,
    message: hasChinese ? "Chinese translation available" : "No Chinese translation - generate for cross-border reference",
    messageCn: hasChinese ? "中文翻译已生成" : "无中文翻译 - 建议生成用于跨境参考",
    severity: hasChinese ? "info" : "warning",
  });
  totalScore += bilingualScore;

  // Rule 3: Image advice present (2 points)
  const imgScore = hasImageAdvice ? 2 : 0;
  details.push({
    rule: "Image Strategy Available",
    ruleCn: "图片策略可用",
    passed: hasImageAdvice, score: imgScore, maxScore: 2,
    message: hasImageAdvice ? "Image advice generated" : "No image strategy - generate for complete listing",
    messageCn: hasImageAdvice ? "图片建议已生成" : "无图片策略 - 建议生成完整Listing",
    severity: hasImageAdvice ? "info" : "warning",
  });
  totalScore += imgScore;

  // Rule 4: Content consistency (2 points) - check if title keywords appear in bullets/description
  const titleWords = new Set((title || "").toLowerCase().split(/[\s,\-|]+/).filter(w => w.length > 3));
  let bulletText = "";
  try {
    if (bulletPointsJson) {
      const parsed = JSON.parse(bulletPointsJson);
      const bullets = Array.isArray(parsed) ? parsed : parsed?.bulletPoints || [];
      bulletText = bullets.map((bp: any) => {
        return bp.subtitle && bp.fullText
          ? `${bp.subtitle} ${bp.fullText}`
          : bp.fullText || bp.subtitle || bp.text || (typeof bp === "string" ? bp : "");
      }).join(" ");
    }
  } catch {}
  const otherText = (bulletText + " " + (description || "")).toLowerCase();
  const consistentWords = Array.from(titleWords).filter(w => otherText.includes(w));
  const consistency = titleWords.size > 0 ? consistentWords.length / titleWords.size : 0;
  const consistScore = consistency >= 0.5 ? 2 : (consistency >= 0.3 ? 1 : 0);
  details.push({
    rule: "Content Consistency Across Sections",
    ruleCn: "各部分内容一致性",
    passed: consistScore >= 2, score: consistScore, maxScore: 2,
    message: `${Math.round(consistency * 100)}% of title keywords appear in other sections`,
    messageCn: `${Math.round(consistency * 100)}%的标题关键词出现在其他部分`,
    severity: consistScore >= 2 ? "info" : "warning",
  });
  totalScore += consistScore;

  const percentage = Math.round((totalScore / 10) * 100);
  return {
    name: "Overall SEO",
    nameCn: "整体SEO评分",
    score: totalScore,
    maxScore: 10,
    percentage,
    grade: getGrade(percentage),
    details,
  };
}

// ─── Generate Optimization Suggestions ───────────────────────────

function generateSuggestions(dimensions: ScoreDimension[]): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];

  for (const dim of dimensions) {
    for (const detail of dim.details) {
      if (!detail.passed) {
        let priority: "high" | "medium" | "low" = "medium";
        if (detail.severity === "critical") priority = "high";
        else if (detail.severity === "info") priority = "low";

        let suggestion = "";
        let suggestionCn = "";
        let impact = "";
        let impactCn = "";

        // Generate specific suggestions based on rule
        if (detail.rule.includes("Title Length")) {
          suggestion = "Adjust title to 180-200 characters for optimal A9 indexing. Include core keywords, brand, and key features.";
          suggestionCn = "调整标题至180-200字符以获得最佳A9索引效果。包含核心关键词、品牌和关键特性。";
          impact = "Title is the #1 ranking factor. Proper length ensures full display on search results.";
          impactCn = "标题是排名第一因素。合适的长度确保在搜索结果中完整展示。";
        } else if (detail.rule.includes("5 Bullet Points")) {
          suggestion = "Ensure all 5 bullet points are present. Each should highlight a unique selling point.";
          suggestionCn = "确保5条要点齐全。每条应突出一个独特卖点。";
          impact = "Missing bullets means lost keyword indexing opportunities and reduced conversion.";
          impactCn = "缺少要点意味着失去关键词索引机会和降低转化率。";
        } else if (detail.rule.includes("Character Count Compliance")) {
          suggestion = "Adjust bullet points to 200-280 characters each. Too short loses SEO value, too long gets truncated on mobile.";
          suggestionCn = "调整每条要点至200-280字符。过短损失SEO价值，过长在移动端被截断。";
          impact = "Optimal bullet length maximizes keyword density while maintaining readability.";
          impactCn = "最佳要点长度在保持可读性的同时最大化关键词密度。";
        } else if (detail.rule.includes("FABE Structure")) {
          suggestion = "Use FABE format: [Feature Subtitle] followed by detailed Advantage, Benefit, and Evidence.";
          suggestionCn = "使用FABE格式：[特性小标题] 后跟详细的优势、利益和证据。";
          impact = "Structured bullets improve scannability and conversion rate.";
          impactCn = "结构化要点提高可扫描性和转化率。";
        } else if (detail.rule.includes("Keyword Integration") || detail.rule.includes("Keywords Coverage")) {
          suggestion = "Naturally embed more A9 keywords into your listing content. Avoid keyword stuffing.";
          suggestionCn = "在Listing内容中自然嵌入更多A9关键词。避免关键词堆砌。";
          impact = "Higher keyword coverage directly improves search visibility and organic ranking.";
          impactCn = "更高的关键词覆盖率直接提升搜索可见性和自然排名。";
        } else if (detail.rule.includes("Search Terms Length")) {
          suggestion = "Keep search terms under 249 bytes. Use space-separated words, no commas or duplicates.";
          suggestionCn = "搜索词保持在249字节以内。使用空格分隔，无逗号和重复。";
          impact = "Exceeding the byte limit means Amazon ignores all search terms entirely.";
          impactCn = "超过字节限制意味着亚马逊会完全忽略所有搜索词。";
        } else if (detail.rule.includes("Redundancy")) {
          suggestion = "Remove words from search terms that already appear in your title - they're already indexed.";
          suggestionCn = "从搜索词中移除已在标题中出现的词 - 它们已被索引。";
          impact = "Eliminating redundancy frees up byte space for additional unique keywords.";
          impactCn = "消除冗余可释放字节空间用于更多独特关键词。";
        } else if (detail.rule.includes("Bilingual")) {
          suggestion = "Generate Chinese translation for cross-border team review and localization reference.";
          suggestionCn = "生成中文翻译用于跨境团队审核和本地化参考。";
          impact = "Bilingual content improves team collaboration efficiency.";
          impactCn = "双语内容提高团队协作效率。";
        } else if (detail.rule.includes("Description Length")) {
          suggestion = "Expand description to 1000-2000 characters with product story, use cases, and specifications.";
          suggestionCn = "将描述扩展至1000-2000字符，包含产品故事、使用场景和规格参数。";
          impact = "Longer, well-structured descriptions improve A9 indexing and customer trust.";
          impactCn = "更长、结构良好的描述提升A9索引和客户信任度。";
        } else if (detail.rule.includes("Prohibited")) {
          suggestion = "Remove claims like 'best seller', 'guaranteed', '#1' - these violate Amazon TOS.";
          suggestionCn = "移除'best seller'、'guaranteed'、'#1'等声明 - 这些违反亚马逊服务条款。";
          impact = "Policy violations can lead to listing suppression or account suspension.";
          impactCn = "违规声明可能导致Listing被抑制或账号被暂停。";
        } else {
          suggestion = detail.message;
          suggestionCn = detail.messageCn;
          impact = "Improving this aspect will enhance your listing quality score.";
          impactCn = "改进此方面将提升您的Listing质量评分。";
        }

        suggestions.push({
          dimension: dim.name,
          dimensionCn: dim.nameCn,
          priority,
          suggestion,
          suggestionCn,
          impact,
          impactCn,
        });
      }
    }
  }

  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return suggestions;
}

// ─── Main Scoring Function ───────────────────────────────────────

export function scoreListing(
  listing: {
    title: string | null;
    bulletPoints: string | null;
    description: string | null;
    searchTerms: string | null;
    titleCn: string | null;
    bulletPointsCn: string | null;
    descriptionCn: string | null;
    searchTermsCn: string | null;
    imageAdvice: string | null;
  },
  kwData: KeywordModuleData | null,
  coreKeywords: string[] // extracted from keyword management module
): ListingScore {
  const hasChinese = !!(listing.titleCn || listing.bulletPointsCn || listing.descriptionCn);
  const hasImageAdvice = !!listing.imageAdvice;

  const dimensions: ScoreDimension[] = [
    scoreTitleOptimization(listing.title, coreKeywords),
    scoreBulletPoints(listing.bulletPoints, coreKeywords),
    scoreDescription(listing.description, coreKeywords),
    scoreSearchTerms(listing.searchTerms, listing.title, listing.bulletPoints),
    scoreKeywordCoverage(listing.title, listing.bulletPoints, listing.description, listing.searchTerms, kwData),
    scoreOverallSEO(listing.title, listing.bulletPoints, listing.description, listing.searchTerms, hasChinese, hasImageAdvice),
  ];

  const totalScore = dimensions.reduce((sum, d) => sum + d.score, 0);
  const maxScore = dimensions.reduce((sum, d) => sum + d.maxScore, 0);
  const percentage = Math.round((totalScore / maxScore) * 100);

  const suggestions = generateSuggestions(dimensions);

  return {
    totalScore,
    maxScore,
    percentage,
    grade: getOverallGrade(percentage),
    dimensions,
    suggestions,
    scoredAt: new Date().toISOString(),
  };
}
