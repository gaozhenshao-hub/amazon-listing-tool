import { getDb } from "./db";
import { eq, desc, and, sql, gte, lte, like } from "drizzle-orm";
import {
  offInfluencers, offInfluencerScores, offCampaigns, offCollaborations,
  offOutreachMessages, offContentSubmissions, offSocialAccounts,
  offContentCalendar, offAttributionLinks, offCampaignAnalytics,
  offMatrixGroups, offAiAnalysisLogs,
} from "../drizzle/schema";

// ============ Influencers ============
export async function searchInfluencers(userId: number, opts: { platform?: string; category?: string; country?: string; keyword?: string; limit?: number; offset?: number }) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  const conditions: any[] = [eq(offInfluencers.userId, userId)];
  if (opts.platform) conditions.push(eq(offInfluencers.platform, opts.platform));
  if (opts.category) conditions.push(eq(offInfluencers.category, opts.category));
  if (opts.country) conditions.push(eq(offInfluencers.country, opts.country));
  if (opts.keyword) conditions.push(like(offInfluencers.displayName, `%${opts.keyword}%`));
  return db.select().from(offInfluencers).where(and(...conditions)).orderBy(desc(offInfluencers.followerCount)).limit(opts.limit || 50).offset(opts.offset || 0);
}

export async function getInfluencer(id: number) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  const rows = await db.select().from(offInfluencers).where(eq(offInfluencers.id, id)).limit(1);
  return rows[0] || null;
}

export async function createInfluencer(data: any) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  const [result] = await db.insert(offInfluencers).values(data);
  return result.insertId;
}

export async function updateInfluencer(id: number, data: any) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  await db.update(offInfluencers).set(data).where(eq(offInfluencers.id, id));
}

export async function saveInfluencerScore(data: any) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  const [result] = await db.insert(offInfluencerScores).values(data);
  return result.insertId;
}

export async function getInfluencerScores(influencerId: number) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  return db.select().from(offInfluencerScores).where(eq(offInfluencerScores.influencerId, influencerId)).orderBy(desc(offInfluencerScores.scoredAt));
}

// ============ Campaigns ============
export async function listCampaigns(userId: number, opts?: { status?: string }) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  const conditions: any[] = [eq(offCampaigns.userId, userId)];
  if (opts?.status) conditions.push(eq(offCampaigns.status, opts.status));
  return db.select().from(offCampaigns).where(and(...conditions)).orderBy(desc(offCampaigns.createdAt));
}

export async function getCampaign(id: number) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  const rows = await db.select().from(offCampaigns).where(eq(offCampaigns.id, id)).limit(1);
  return rows[0] || null;
}

export async function createCampaign(data: any) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  const [result] = await db.insert(offCampaigns).values(data);
  return result.insertId;
}

export async function updateCampaign(id: number, data: any) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  await db.update(offCampaigns).set(data).where(eq(offCampaigns.id, id));
}

// ============ Collaborations ============
export async function listCollaborations(campaignId: number) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  return db.select().from(offCollaborations).where(eq(offCollaborations.campaignId, campaignId)).orderBy(desc(offCollaborations.createdAt));
}

export async function createCollaboration(data: any) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  const [result] = await db.insert(offCollaborations).values(data);
  return result.insertId;
}

export async function updateCollaboration(id: number, data: any) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  await db.update(offCollaborations).set(data).where(eq(offCollaborations.id, id));
}

// ============ Outreach Messages ============
export async function listOutreachMessages(userId: number, opts?: { influencerId?: number; campaignId?: number }) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  const conditions: any[] = [eq(offOutreachMessages.userId, userId)];
  if (opts?.influencerId) conditions.push(eq(offOutreachMessages.influencerId, opts.influencerId));
  if (opts?.campaignId) conditions.push(eq(offOutreachMessages.campaignId, opts.campaignId));
  return db.select().from(offOutreachMessages).where(and(...conditions)).orderBy(desc(offOutreachMessages.createdAt));
}

export async function createOutreachMessage(data: any) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  const [result] = await db.insert(offOutreachMessages).values(data);
  return result.insertId;
}

export async function updateOutreachMessage(id: number, data: any) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  await db.update(offOutreachMessages).set(data).where(eq(offOutreachMessages.id, id));
}

// ============ Content Submissions ============
export async function listContentSubmissions(userId: number, opts?: { collaborationId?: number; humanStatus?: string }) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  const conditions: any[] = [eq(offContentSubmissions.userId, userId)];
  if (opts?.collaborationId) conditions.push(eq(offContentSubmissions.collaborationId, opts.collaborationId));
  if (opts?.humanStatus) conditions.push(eq(offContentSubmissions.status, opts.humanStatus));
  return db.select().from(offContentSubmissions).where(and(...conditions)).orderBy(desc(offContentSubmissions.createdAt));
}

export async function createContentSubmission(data: any) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  const [result] = await db.insert(offContentSubmissions).values(data);
  return result.insertId;
}

export async function updateContentSubmission(id: number, data: any) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  await db.update(offContentSubmissions).set(data).where(eq(offContentSubmissions.id, id));
}

// ============ Social Accounts ============
export async function listSocialAccounts(userId: number) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  return db.select().from(offSocialAccounts).where(eq(offSocialAccounts.userId, userId)).orderBy(desc(offSocialAccounts.createdAt));
}

export async function createSocialAccount(data: any) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  const [result] = await db.insert(offSocialAccounts).values(data);
  return result.insertId;
}

export async function updateSocialAccount(id: number, data: any) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  await db.update(offSocialAccounts).set(data).where(eq(offSocialAccounts.id, id));
}

// ============ Content Calendar ============
export async function listCalendarItems(userId: number, opts?: { startDate?: string; endDate?: string; platform?: string }) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  const conditions: any[] = [eq(offContentCalendar.userId, userId)];
  if (opts?.startDate) conditions.push(gte(offContentCalendar.scheduledDate, opts.startDate));
  if (opts?.endDate) conditions.push(lte(offContentCalendar.scheduledDate, opts.endDate));
  if (opts?.platform) conditions.push(eq(offContentCalendar.platform, opts.platform));
  return db.select().from(offContentCalendar).where(and(...conditions)).orderBy(offContentCalendar.scheduledDate);
}

export async function createCalendarItem(data: any) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  const [result] = await db.insert(offContentCalendar).values(data);
  return result.insertId;
}

export async function updateCalendarItem(id: number, data: any) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  await db.update(offContentCalendar).set(data).where(eq(offContentCalendar.id, id));
}

// ============ Attribution Links ============
export async function listAttributionLinks(userId: number, opts?: { campaignId?: number }) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  const conditions: any[] = [eq(offAttributionLinks.userId, userId)];
  if (opts?.campaignId) conditions.push(eq(offAttributionLinks.campaignId, opts.campaignId));
  return db.select().from(offAttributionLinks).where(and(...conditions)).orderBy(desc(offAttributionLinks.createdAt));
}

export async function createAttributionLink(data: any) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  const [result] = await db.insert(offAttributionLinks).values(data);
  return result.insertId;
}

export async function updateAttributionLink(id: number, data: any) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  await db.update(offAttributionLinks).set(data).where(eq(offAttributionLinks.id, id));
}

// ============ Campaign Analytics ============
export async function getCampaignAnalytics(campaignId: number) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  return db.select().from(offCampaignAnalytics).where(eq(offCampaignAnalytics.campaignId, campaignId)).orderBy(offCampaignAnalytics.date);
}

export async function upsertCampaignAnalytics(data: any) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  const [result] = await db.insert(offCampaignAnalytics).values(data);
  return result.insertId;
}

// ============ Matrix Groups ============
export async function listMatrixGroups(userId: number) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  return db.select().from(offMatrixGroups).where(eq(offMatrixGroups.userId, userId)).orderBy(desc(offMatrixGroups.createdAt));
}

export async function createMatrixGroup(data: any) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  const [result] = await db.insert(offMatrixGroups).values(data);
  return result.insertId;
}

export async function updateMatrixGroup(id: number, data: any) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  await db.update(offMatrixGroups).set(data).where(eq(offMatrixGroups.id, id));
}

// ============ AI Analysis Logs ============
export async function logAiAnalysis(data: { userId: number; analysisType: string; inputData?: string; outputData?: string; modelUsed?: string; tokensUsed?: number; durationMs?: number }) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  const [result] = await db.insert(offAiAnalysisLogs).values(data);
  return result.insertId;
}

// ============ Dashboard Stats ============
export async function getOffsiteDashboardStats(userId: number) {
  const db = await getDb(); if (!db) throw new Error("DB not ready");
  const [influencerCount] = await db.select({ count: sql<number>`count(*)` }).from(offInfluencers).where(eq(offInfluencers.userId, userId));
  const [campaignCount] = await db.select({ count: sql<number>`count(*)` }).from(offCampaigns).where(eq(offCampaigns.userId, userId));
  const [activeCampaignCount] = await db.select({ count: sql<number>`count(*)` }).from(offCampaigns).where(and(eq(offCampaigns.userId, userId), eq(offCampaigns.status, "active")));
  const [collabCount] = await db.select({ count: sql<number>`count(*)` }).from(offCollaborations).where(eq(offCollaborations.userId, userId));
  const [messageCount] = await db.select({ count: sql<number>`count(*)` }).from(offOutreachMessages).where(eq(offOutreachMessages.userId, userId));
  const [pendingReviewCount] = await db.select({ count: sql<number>`count(*)` }).from(offContentSubmissions).where(and(eq(offContentSubmissions.userId, userId), eq(offContentSubmissions.status, "pending")));
  const [socialAccountCount] = await db.select({ count: sql<number>`count(*)` }).from(offSocialAccounts).where(eq(offSocialAccounts.userId, userId));
  const [calendarItemCount] = await db.select({ count: sql<number>`count(*)` }).from(offContentCalendar).where(eq(offContentCalendar.userId, userId));
  const [linkCount] = await db.select({ count: sql<number>`count(*)` }).from(offAttributionLinks).where(eq(offAttributionLinks.userId, userId));
  const [matrixGroupCount] = await db.select({ count: sql<number>`count(*)` }).from(offMatrixGroups).where(eq(offMatrixGroups.userId, userId));
  
  return {
    influencers: { total: influencerCount.count },
    campaigns: { total: campaignCount.count, active: activeCampaignCount.count },
    collaborations: { total: collabCount.count },
    outreach: { total: messageCount.count },
    contentReview: { pending: pendingReviewCount.count },
    social: { accounts: socialAccountCount.count },
    calendar: { total: calendarItemCount.count },
    attribution: { links: linkCount.count },
    matrix: { groups: matrixGroupCount.count },
  };
}
