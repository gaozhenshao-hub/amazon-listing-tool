/** Source evidence only: no AI analysis, market-wide denominator or authorization. */
import type { AdoptedReviewCorpus, AdoptedReviewItem, AdoptedReviewSource } from "./adoptedCompetitorEvidence";
export const COMPETITOR_REVIEW_PARSER_VERSION = "competitor-review-corpus/1" as const;
export type CompetitorReviewValue = string | number | boolean | null;
export type CompetitorReviewField = "asin" | "sourceReviewId" | "body" | "title" | "rating" | "date" | "author" | "verifiedPurchase" | "variant" | "helpfulVotes";
export type CompetitorReviewLocation = { sheet: string; row: number };
export type CompetitorReviewOccurrence = CompetitorReviewLocation & {
  assignment: "row_asin" | "filename_unique_asin";
  fields: Array<{ column: number; header: string; value: CompetitorReviewValue }>;
  mapping: Partial<Record<CompetitorReviewField, number>>;
  warnings: string[];
};
export type CompetitorReviewItem = {
  reviewId: string;
  asin: string;
  sourceReviewId: string | null;
  title: string | null;
  body: string;
  rating: number | null;
  date: string | null;
  author: string | null;
  verifiedPurchase: boolean | null;
  variant: string | null;
  helpfulVotes: number | null;
  occurrences: CompetitorReviewOccurrence[];
};
export type CompetitorReviewCorpusCoverage = {
  scope: "complete_file_not_market_total";
  format: "csv" | "xlsx";
  sourceFileHash: string;
  sourceBytes: number;
  sourceFileName: string;
  sheets: Array<{ name: string; headerRow: 1; dataRows: number }>;
  /** All physical records after each header, including blank records. */
  totalRows: number;
  blankRows: number;
  emptyBodyRows: number;
  unassignedRows: number;
  otherAsinRows: number;
  /** Accepted source rows, before deterministic duplicate elimination. */
  matchedRows: number;
  duplicateRows: number;
  uniqueReviews: number;
  filenameFallbackRows: number;
  excluded: Array<CompetitorReviewLocation & { reason: "blank_row" | "empty_body" | "unassigned_asin" | "other_asin" }>;
  normalization: "LF_then_trim_no_internal_whitespace_collapse";
};
export type CompetitorReviewCorpus = {
  parserVersion: typeof COMPETITOR_REVIEW_PARSER_VERSION;
  corpusHash: string;
  projectId: number;
  analysisId: number;
  asin: string;
  items: CompetitorReviewItem[];
  coverage: CompetitorReviewCorpusCoverage;
};
/** The authorized service owns page/hash scope binding and access validation. */
export type CompetitorReviewPage = {
  status: "available";
  reason: null;
  parserVersion: typeof COMPETITOR_REVIEW_PARSER_VERSION | "competitor-review-adopted/1";
  corpusHash: string;
  projectId: number;
  analysisId: number;
  asin: string;
  source: { runId: string; fileName: string; fileHash: string } | AdoptedReviewSource;
  items: Array<CompetitorReviewItem | AdoptedReviewItem>;
  total: number;
  page: number;
  pageSize: number;
  coverage: CompetitorReviewCorpusCoverage | AdoptedReviewCorpus["coverage"];
} | {
  status: "unavailable";
  reason: string;
  projectId: number;
  analysisId: number;
  asin: string;
  corpusHash: null;
  source: null;
  coverage: null;
  items: [];
  page: number;
  pageSize: number;
  total: null;
  parserVersion: null;
};
