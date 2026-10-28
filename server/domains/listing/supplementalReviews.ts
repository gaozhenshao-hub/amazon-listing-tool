import { TRPCError } from '@trpc/server';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { listingSupplementalReviews } from '../../../drizzle/schema/project';
import { requireDb } from '../../repositories/dbClient';
import { readJson } from '../../../shared/competitorPresentation';
import type { ParsedReview } from '../../reviewParser';

export function reviewKey(r: { title?: string; body?: string; content?: string; rating?: number | null; date?: string | null; author?:string|null }) {
  // Calendar dates in CSVs are not timestamps. Keep the supplied day in the
  // local calendar instead of shifting textual dates across midnight in UTC.
  const parsedDate = r.date ? new Date(r.date) : null;
  const date = r.date && /^\d{4}-\d{2}-\d{2}/.test(r.date) ? r.date.slice(0, 10)
    : parsedDate && Number.isFinite(parsedDate.getTime())
      ? `${parsedDate.getFullYear()}-${String(parsedDate.getMonth() + 1).padStart(2, '0')}-${String(parsedDate.getDate()).padStart(2, '0')}` : r.date || '';
  return createHash('sha256').update(JSON.stringify([r.title || '', r.body || r.content || '', r.rating ?? null, date, r.author||''].map(v => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v))).digest('hex');
}
export function matchReviewAsin(asin: string | undefined, filename: string, records: any[]) {
  const fileAsins = [...new Set(filename.toUpperCase().match(/(?<![A-Z0-9])[A-Z0-9]{10}(?![A-Z0-9])/g) || [])];
  const key = asin?.toUpperCase() || (fileAsins.length === 1 ? fileAsins[0] : '');
  if (!key) throw new TRPCError({code: 'BAD_REQUEST', message: '无法识别 ASIN：请在表格增加 ASIN 列，或在文件名中填写唯一 ASIN'});
  const exact = records.find(r => r.asin === key);
  if (exact) return exact;
  const candidates = records.filter(r => (readJson(r.rawData)?.research?.variants || []).some((v: any) => v.asin === key));
  if (candidates.length !== 1) throw new TRPCError({code: 'BAD_REQUEST', message: `${key} ${candidates.length ? '对应多个竞品，请使用目标竞品 ASIN' : '未匹配当前项目的竞品，请先抓取并保存该 ASIN'}`});
  return candidates[0];
}
export function normalizeImportedReview(r: ParsedReview) {
  if (r.content.length > 8000) throw new TRPCError({code: 'BAD_REQUEST', message: '单条评论超过 8000 字符，请检查内容列'});
  const hash = reviewKey(r);
  return { id: `file-${hash}`, title: (r.title || '').slice(0,1000), body: r.content, rating: r.rating ?? null, date: r.date || null, variant: r.model || null, verifiedPurchase: !!r.verifiedPurchase, source: 'file_upload', author: r.author || null };
}
export async function loadSupplementalReviews(projectId: number, asin: string) {
  const db = await requireDb('supplemental reviews');
  const rows = await db.select().from(listingSupplementalReviews).where(and(eq(listingSupplementalReviews.projectId, projectId), eq(listingSupplementalReviews.asin, asin))).orderBy(listingSupplementalReviews.id);
  return rows.map(r => JSON.parse(r.reviewJson));
}
export function mergeImportedReviews(base: any[], extra: any[]) {
  const unique = new Map<string, any>();
  for (const r of [...base, ...extra]) if (!unique.has(reviewKey(r))) unique.set(reviewKey(r), r);
  return [...unique.values()];
}
