import { eq, and, desc, asc } from "drizzle-orm";
import { getDb } from "./db";
import {
  videoScripts, InsertVideoScript,
  videoCompetitorScripts, InsertVideoCompetitorScript,
  videoCompetitorSummary, InsertVideoCompetitorSummary,
  videoProductSnapshots, InsertVideoProductSnapshot,
  videoScriptSections, InsertVideoScriptSection,
  videoScriptSubtopics, InsertVideoScriptSubtopic,
  videoScriptShots, InsertVideoScriptShot,
  videoEditScripts, InsertVideoEditScript,
} from "../drizzle/schema";

// ─── Video Scripts CRUD ─────────────────────────────────────────

export async function createVideoScript(data: InsertVideoScript) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(videoScripts).values(data);
  return result.insertId;
}

export async function getVideoScriptsByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(videoScripts)
    .where(eq(videoScripts.projectId, projectId))
    .orderBy(desc(videoScripts.updatedAt));
}

export async function getVideoScriptById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(videoScripts).where(eq(videoScripts.id, id));
  return rows[0] ?? null;
}

export async function updateVideoScript(id: number, data: Partial<InsertVideoScript>) {
  const db = await getDb();
  if (!db) return;
  await db.update(videoScripts).set(data).where(eq(videoScripts.id, id));
}

export async function deleteVideoScript(id: number) {
  const db = await getDb();
  if (!db) return;
  // Delete all related data in order
  const sections = await db.select().from(videoScriptSections).where(eq(videoScriptSections.videoScriptId, id));
  for (const sec of sections) {
    const subtopics = await db.select().from(videoScriptSubtopics).where(eq(videoScriptSubtopics.sectionId, sec.id));
    for (const sub of subtopics) {
      await db.delete(videoScriptShots).where(eq(videoScriptShots.subtopicId, sub.id));
    }
    await db.delete(videoScriptSubtopics).where(eq(videoScriptSubtopics.sectionId, sec.id));
  }
  await db.delete(videoScriptSections).where(eq(videoScriptSections.videoScriptId, id));
  await db.delete(videoEditScripts).where(eq(videoEditScripts.videoScriptId, id));
  await db.delete(videoCompetitorScripts).where(eq(videoCompetitorScripts.videoScriptId, id));
  await db.delete(videoCompetitorSummary).where(eq(videoCompetitorSummary.videoScriptId, id));
  await db.delete(videoProductSnapshots).where(eq(videoProductSnapshots.videoScriptId, id));
  await db.delete(videoScripts).where(eq(videoScripts.id, id));
}

// ─── Competitor Scripts ─────────────────────────────────────────

export async function addCompetitorScript(data: InsertVideoCompetitorScript) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(videoCompetitorScripts).values(data);
  return result.insertId;
}

export async function getCompetitorScriptsByVideoScript(videoScriptId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(videoCompetitorScripts)
    .where(eq(videoCompetitorScripts.videoScriptId, videoScriptId))
    .orderBy(asc(videoCompetitorScripts.id));
}

export async function updateCompetitorScript(id: number, data: Partial<InsertVideoCompetitorScript>) {
  const db = await getDb();
  if (!db) return;
  await db.update(videoCompetitorScripts).set(data).where(eq(videoCompetitorScripts.id, id));
}

export async function deleteCompetitorScript(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(videoCompetitorScripts).where(eq(videoCompetitorScripts.id, id));
}

// ─── Competitor Summary ─────────────────────────────────────────

export async function upsertCompetitorSummary(data: InsertVideoCompetitorSummary) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select().from(videoCompetitorSummary)
    .where(eq(videoCompetitorSummary.videoScriptId, data.videoScriptId!));
  if (existing.length > 0) {
    await db.update(videoCompetitorSummary).set(data).where(eq(videoCompetitorSummary.id, existing[0].id));
    return existing[0].id;
  }
  const [result] = await db.insert(videoCompetitorSummary).values(data);
  return result.insertId;
}

export async function getCompetitorSummary(videoScriptId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(videoCompetitorSummary)
    .where(eq(videoCompetitorSummary.videoScriptId, videoScriptId));
  return rows[0] ?? null;
}

// ─── Product Snapshots ──────────────────────────────────────────

export async function upsertProductSnapshot(data: InsertVideoProductSnapshot) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select().from(videoProductSnapshots)
    .where(eq(videoProductSnapshots.videoScriptId, data.videoScriptId!));
  if (existing.length > 0) {
    await db.update(videoProductSnapshots).set(data).where(eq(videoProductSnapshots.id, existing[0].id));
    return existing[0].id;
  }
  const [result] = await db.insert(videoProductSnapshots).values(data);
  return result.insertId;
}

export async function getProductSnapshot(videoScriptId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(videoProductSnapshots)
    .where(eq(videoProductSnapshots.videoScriptId, videoScriptId));
  return rows[0] ?? null;
}

// ─── Sections ───────────────────────────────────────────────────

export async function saveSections(videoScriptId: number, sections: InsertVideoScriptSection[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Delete existing sections and their children
  const existingSections = await db.select().from(videoScriptSections)
    .where(eq(videoScriptSections.videoScriptId, videoScriptId));
  for (const sec of existingSections) {
    const subtopics = await db.select().from(videoScriptSubtopics).where(eq(videoScriptSubtopics.sectionId, sec.id));
    for (const sub of subtopics) {
      await db.delete(videoScriptShots).where(eq(videoScriptShots.subtopicId, sub.id));
    }
    await db.delete(videoScriptSubtopics).where(eq(videoScriptSubtopics.sectionId, sec.id));
  }
  await db.delete(videoScriptSections).where(eq(videoScriptSections.videoScriptId, videoScriptId));
  // Insert new sections
  if (sections.length === 0) return [];
  const insertData = sections.map((s, i) => ({ ...s, videoScriptId, sortOrder: i }));
  await db.insert(videoScriptSections).values(insertData);
  return db.select().from(videoScriptSections)
    .where(eq(videoScriptSections.videoScriptId, videoScriptId))
    .orderBy(asc(videoScriptSections.sortOrder));
}

export async function getSections(videoScriptId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(videoScriptSections)
    .where(eq(videoScriptSections.videoScriptId, videoScriptId))
    .orderBy(asc(videoScriptSections.sortOrder));
}

export async function updateSection(id: number, data: Partial<InsertVideoScriptSection>) {
  const db = await getDb();
  if (!db) return;
  await db.update(videoScriptSections).set(data).where(eq(videoScriptSections.id, id));
}

// ─── Subtopics ──────────────────────────────────────────────────

export async function saveSubtopics(sectionId: number, subtopics: InsertVideoScriptSubtopic[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Delete existing subtopics and their shots
  const existing = await db.select().from(videoScriptSubtopics).where(eq(videoScriptSubtopics.sectionId, sectionId));
  for (const sub of existing) {
    await db.delete(videoScriptShots).where(eq(videoScriptShots.subtopicId, sub.id));
  }
  await db.delete(videoScriptSubtopics).where(eq(videoScriptSubtopics.sectionId, sectionId));
  if (subtopics.length === 0) return [];
  const insertData = subtopics.map((s, i) => ({ ...s, sectionId, sortOrder: i }));
  await db.insert(videoScriptSubtopics).values(insertData);
  return db.select().from(videoScriptSubtopics)
    .where(eq(videoScriptSubtopics.sectionId, sectionId))
    .orderBy(asc(videoScriptSubtopics.sortOrder));
}

export async function getSubtopicsBySection(sectionId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(videoScriptSubtopics)
    .where(eq(videoScriptSubtopics.sectionId, sectionId))
    .orderBy(asc(videoScriptSubtopics.sortOrder));
}

export async function getSubtopicsByVideoScript(videoScriptId: number) {
  const db = await getDb();
  if (!db) return [];
  const sections = await getSections(videoScriptId);
  const allSubtopics = [];
  for (const sec of sections) {
    const subs = await getSubtopicsBySection(sec.id);
    allSubtopics.push(...subs.map(s => ({ ...s, sectionId: sec.id, sectionCode: sec.sectionCode })));
  }
  return allSubtopics;
}

// ─── Shots ──────────────────────────────────────────────────────

export async function saveShots(subtopicId: number, sectionId: number, shots: InsertVideoScriptShot[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(videoScriptShots).where(eq(videoScriptShots.subtopicId, subtopicId));
  if (shots.length === 0) return [];
  const insertData = shots.map((s, i) => ({ ...s, subtopicId, sectionId, sortOrder: i }));
  await db.insert(videoScriptShots).values(insertData);
  return db.select().from(videoScriptShots)
    .where(eq(videoScriptShots.subtopicId, subtopicId))
    .orderBy(asc(videoScriptShots.sortOrder));
}

export async function getShotsBySubtopic(subtopicId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(videoScriptShots)
    .where(eq(videoScriptShots.subtopicId, subtopicId))
    .orderBy(asc(videoScriptShots.sortOrder));
}

export async function getShotsByVideoScript(videoScriptId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(videoScriptShots)
    .where(eq(videoScriptShots.sectionId, videoScriptId))
    .orderBy(asc(videoScriptShots.sortOrder));
}

export async function getAllShotsByVideoScript(videoScriptId: number) {
  const db = await getDb();
  if (!db) return [];
  const sections = await getSections(videoScriptId);
  const allShots = [];
  for (const sec of sections) {
    const subtopics = await getSubtopicsBySection(sec.id);
    for (const sub of subtopics) {
      const shots = await getShotsBySubtopic(sub.id);
      allShots.push(...shots.map(s => ({
        ...s,
        sectionCode: sec.sectionCode,
        sectionName: sec.sectionName,
        subtopicName: sub.subtopicName,
      })));
    }
  }
  return allShots;
}

export async function updateShot(id: number, data: Partial<InsertVideoScriptShot>) {
  const db = await getDb();
  if (!db) return;
  await db.update(videoScriptShots).set(data).where(eq(videoScriptShots.id, id));
}

export async function deleteShot(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(videoScriptShots).where(eq(videoScriptShots.id, id));
}

// ─── Edit Scripts ───────────────────────────────────────────────

export async function saveEditScripts(videoScriptId: number, editScripts: InsertVideoEditScript[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(videoEditScripts).where(eq(videoEditScripts.videoScriptId, videoScriptId));
  if (editScripts.length === 0) return [];
  const insertData = editScripts.map((s, i) => ({ ...s, videoScriptId, sortOrder: i }));
  await db.insert(videoEditScripts).values(insertData);
  return db.select().from(videoEditScripts)
    .where(eq(videoEditScripts.videoScriptId, videoScriptId))
    .orderBy(asc(videoEditScripts.sortOrder));
}

export async function getEditScripts(videoScriptId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(videoEditScripts)
    .where(eq(videoEditScripts.videoScriptId, videoScriptId))
    .orderBy(asc(videoEditScripts.sortOrder));
}

export async function updateEditScript(id: number, data: Partial<InsertVideoEditScript>) {
  const db = await getDb();
  if (!db) return;
  await db.update(videoEditScripts).set(data).where(eq(videoEditScripts.id, id));
}
