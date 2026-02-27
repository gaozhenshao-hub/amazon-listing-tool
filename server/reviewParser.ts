import * as XLSX from "xlsx";

export interface ParsedReview {
  title?: string;
  content: string;
  rating?: number;
  date?: string;
  author?: string;
  verifiedPurchase?: boolean;
  model?: string;
  helpfulVotes?: number;
}

export interface ParseResult {
  reviews: ParsedReview[];
  totalRows: number;
  parsedRows: number;
  skippedRows: number;
  detectedFormat: string;
  columns: string[];
}

// Column name mappings for different seller sprite versions (CN/EN) and other tools
const COLUMN_MAPPINGS: Record<string, string[]> = {
  // Review content - the most important field
  content: [
    "content", "review", "review content", "body", "text", "comment",
    "评论内容", "内容", "评论", "评价内容", "评价", "review body",
    "review text", "customer review", "评论正文", "Review Content",
    "Content", "Review", "Body", "评论详情",
  ],
  // Review title
  title: [
    "title", "review title", "headline", "subject",
    "标题", "评论标题", "评价标题", "Review Title", "Title", "Headline",
  ],
  // Rating / Stars
  rating: [
    "rating", "star", "stars", "star rating", "score",
    "评分", "星级", "评级", "星数", "Rating", "Star", "Stars", "Star Rating",
  ],
  // Date
  date: [
    "date", "review date", "time", "created", "posted",
    "日期", "评论日期", "评价日期", "时间", "Date", "Review Date", "Time",
  ],
  // Author / Reviewer
  author: [
    "author", "reviewer", "name", "user", "customer", "profile name",
    "评论者", "作者", "用户", "用户名", "Author", "Reviewer", "Name",
    "Profile Name", "Customer",
  ],
  // Verified Purchase
  verifiedPurchase: [
    "verified purchase", "verified", "vp", "is verified",
    "是否验证购买", "验证购买", "VP", "Verified Purchase", "Verified",
  ],
  // Model / Variant
  model: [
    "model", "variant", "variation", "style", "size", "color",
    "型号", "变体", "款式", "颜色", "尺寸", "Model", "Variant", "Variation",
  ],
  // Helpful votes
  helpfulVotes: [
    "helpful", "helpful votes", "helpful count", "votes",
    "有用投票", "有用", "投票数", "Helpful", "Helpful Votes",
  ],
};

/**
 * Find the best matching column name from the header row
 */
function findColumn(headers: string[], targetAliases: string[]): number {
  // Exact match (case-insensitive)
  for (const alias of targetAliases) {
    const idx = headers.findIndex(h => h.toLowerCase().trim() === alias.toLowerCase().trim());
    if (idx !== -1) return idx;
  }
  // Partial match (contains)
  for (const alias of targetAliases) {
    const idx = headers.findIndex(h => h.toLowerCase().trim().includes(alias.toLowerCase().trim()));
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Parse a boolean-like value for verified purchase
 */
function parseBoolean(val: any): boolean | undefined {
  if (val === undefined || val === null || val === "") return undefined;
  const s = String(val).toLowerCase().trim();
  if (["yes", "true", "1", "是", "y", "✓", "✔"].includes(s)) return true;
  if (["no", "false", "0", "否", "n", "✗", "✘"].includes(s)) return false;
  return undefined;
}

/**
 * Parse rating value (could be "5 stars", "4.5", "⭐⭐⭐⭐", etc.)
 */
function parseRating(val: any): number | undefined {
  if (val === undefined || val === null || val === "") return undefined;
  const s = String(val).trim();
  // Count star emojis
  const starCount = (s.match(/⭐|★|☆/g) || []).length;
  if (starCount > 0) return starCount;
  // Extract number
  const num = parseFloat(s.replace(/[^0-9.]/g, ""));
  if (!isNaN(num) && num >= 1 && num <= 5) return num;
  return undefined;
}

/**
 * Parse an Excel/CSV buffer into structured review data
 */
export function parseReviewFile(buffer: Buffer, filename: string): ParseResult {
  const workbook = XLSX.read(buffer, { type: "buffer" });

  // Use the first sheet
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("文件中没有找到工作表");
  }

  const sheet = workbook.Sheets[sheetName];
  const rawData: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (rawData.length < 2) {
    throw new Error("文件数据不足，至少需要表头行和一行数据");
  }

  // First row is headers
  const headers: string[] = rawData[0].map((h: any) => String(h).trim());

  // Map columns
  const contentIdx = findColumn(headers, COLUMN_MAPPINGS.content);
  const titleIdx = findColumn(headers, COLUMN_MAPPINGS.title);
  const ratingIdx = findColumn(headers, COLUMN_MAPPINGS.rating);
  const dateIdx = findColumn(headers, COLUMN_MAPPINGS.date);
  const authorIdx = findColumn(headers, COLUMN_MAPPINGS.author);
  const vpIdx = findColumn(headers, COLUMN_MAPPINGS.verifiedPurchase);
  const modelIdx = findColumn(headers, COLUMN_MAPPINGS.model);
  const helpfulIdx = findColumn(headers, COLUMN_MAPPINGS.helpfulVotes);

  // If no content column found, try to use the longest text column
  let effectiveContentIdx = contentIdx;
  if (effectiveContentIdx === -1) {
    // Find the column with the longest average text as content
    const avgLengths = headers.map((_, colIdx) => {
      let totalLen = 0;
      let count = 0;
      for (let r = 1; r < Math.min(rawData.length, 20); r++) {
        const val = rawData[r]?.[colIdx];
        if (val) {
          totalLen += String(val).length;
          count++;
        }
      }
      return count > 0 ? totalLen / count : 0;
    });
    const maxLen = Math.max(...avgLengths);
    if (maxLen > 20) {
      effectiveContentIdx = avgLengths.indexOf(maxLen);
    }
  }

  if (effectiveContentIdx === -1) {
    throw new Error("无法识别评论内容列。请确保文件包含评论内容（Content/Review/评论内容）列。");
  }

  // Detect format
  let detectedFormat = "未知格式";
  if (filename.toLowerCase().includes("sellersprite") || filename.toLowerCase().includes("卖家精灵")) {
    detectedFormat = "卖家精灵";
  } else if (contentIdx !== -1 && ratingIdx !== -1) {
    detectedFormat = "标准评论导出";
  } else {
    detectedFormat = "自动检测";
  }

  // Parse data rows
  const reviews: ParsedReview[] = [];
  let skippedRows = 0;

  for (let r = 1; r < rawData.length; r++) {
    const row = rawData[r];
    if (!row || row.length === 0) {
      skippedRows++;
      continue;
    }

    const content = String(row[effectiveContentIdx] || "").trim();
    if (!content || content.length < 3) {
      skippedRows++;
      continue;
    }

    const review: ParsedReview = {
      content,
    };

    if (titleIdx !== -1 && row[titleIdx]) {
      review.title = String(row[titleIdx]).trim();
    }
    if (ratingIdx !== -1 && row[ratingIdx] !== undefined) {
      review.rating = parseRating(row[ratingIdx]);
    }
    if (dateIdx !== -1 && row[dateIdx]) {
      review.date = String(row[dateIdx]).trim();
    }
    if (authorIdx !== -1 && row[authorIdx]) {
      review.author = String(row[authorIdx]).trim();
    }
    if (vpIdx !== -1 && row[vpIdx] !== undefined) {
      review.verifiedPurchase = parseBoolean(row[vpIdx]);
    }
    if (modelIdx !== -1 && row[modelIdx]) {
      review.model = String(row[modelIdx]).trim();
    }
    if (helpfulIdx !== -1 && row[helpfulIdx] !== undefined) {
      const hv = parseInt(String(row[helpfulIdx]).replace(/[^0-9]/g, ""), 10);
      if (!isNaN(hv)) review.helpfulVotes = hv;
    }

    reviews.push(review);
  }

  return {
    reviews,
    totalRows: rawData.length - 1,
    parsedRows: reviews.length,
    skippedRows,
    detectedFormat,
    columns: headers,
  };
}

/**
 * Convert parsed reviews to a text format suitable for LLM analysis
 */
export function reviewsToText(reviews: ParsedReview[]): string {
  return reviews.map((r, i) => {
    const parts: string[] = [];
    parts.push(`--- Review ${i + 1} ---`);
    if (r.rating) parts.push(`Rating: ${r.rating}/5`);
    if (r.title) parts.push(`Title: ${r.title}`);
    parts.push(`Content: ${r.content}`);
    if (r.verifiedPurchase !== undefined) parts.push(`Verified Purchase: ${r.verifiedPurchase ? "Yes" : "No"}`);
    if (r.date) parts.push(`Date: ${r.date}`);
    if (r.model) parts.push(`Model/Variant: ${r.model}`);
    if (r.helpfulVotes) parts.push(`Helpful Votes: ${r.helpfulVotes}`);
    return parts.join("\n");
  }).join("\n\n");
}
