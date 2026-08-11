import { eq, and, desc, asc } from "drizzle-orm";
import { getDb } from "./repositories/dbClient";
import {
  videoScripts, InsertVideoScript,
  videoCompetitorScripts, InsertVideoCompetitorScript,
  videoCompetitorSummary, InsertVideoCompetitorSummary,
  videoProductSnapshots, InsertVideoProductSnapshot,
  videoScriptSections, InsertVideoScriptSection,
  videoScriptSubtopics, InsertVideoScriptSubtopic,
  videoScriptShots, InsertVideoScriptShot,
  videoEditScripts, InsertVideoEditScript,
  videoScriptVersions, InsertVideoScriptVersion,
  videoSpvSegments, InsertVideoSpvSegment,
} from "../drizzle/schema";
import {
  listBusinessArtifactVersions,
  registerVideoArtifact,
  resolveCurrentBusinessArtifact,
} from "./domains/ai_os/services/businessArtifactRegistry";

async function selectedVideoArtifact(videoScriptId: number) {
  const versions = await listBusinessArtifactVersions({
    workspaceId: undefined,
    domain: "video",
    artifactKey: "video.script",
    sourceTable: "video_scripts",
    sourceRowId: videoScriptId,
    limit: 1,
  }).catch(() => []);
  // A newer draft means the user is actively editing. Keep showing the working
  // copy until it is explicitly confirmed and promoted to current.
  if (versions[0]?.status === "draft") return null;
  return resolveCurrentBusinessArtifact({
    domain: "video",
    artifactKey: "video.script",
    sourceTable: "video_scripts",
    sourceRowId: videoScriptId,
  }).catch(() => null);
}

async function videoScriptIdForSection(sectionId: number) {
  const db = await getDb();
  if (!db) return null;
  const [section] = await db.select({ videoScriptId: videoScriptSections.videoScriptId })
    .from(videoScriptSections).where(eq(videoScriptSections.id, sectionId)).limit(1);
  return section?.videoScriptId ?? null;
}

async function videoScriptIdForSubtopic(subtopicId: number) {
  const db = await getDb();
  if (!db) return null;
  const [subtopic] = await db.select({ sectionId: videoScriptSubtopics.sectionId })
    .from(videoScriptSubtopics).where(eq(videoScriptSubtopics.id, subtopicId)).limit(1);
  return subtopic ? videoScriptIdForSection(subtopic.sectionId) : null;
}

async function captureVideoChange(videoScriptId: number | null | undefined) {
  if (videoScriptId) await registerVideoArtifact(videoScriptId, "user_edit");
}

// ─── Video Scripts CRUD ─────────────────────────────────────────

export async function createVideoScript(data: InsertVideoScript) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(videoScripts).values(data);
  await registerVideoArtifact(result.insertId, "ai_output");
  return result.insertId;
}

export async function getVideoScriptsByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(videoScripts)
    .where(eq(videoScripts.projectId, projectId))
    .orderBy(desc(videoScripts.updatedAt));
  return Promise.all(rows.map(async (row) => {
    const artifact = await selectedVideoArtifact(row.id);
    const selected = artifact?.content && typeof artifact.content === "object"
      ? (artifact.content as any).script
      : null;
    return selected ? { ...row, ...selected, id: row.id, projectId: row.projectId } : row;
  }));
}

export async function getVideoScriptById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(videoScripts).where(eq(videoScripts.id, id));
  const snapshot = rows[0] ?? null;
  if (!snapshot) return null;
  const artifact = await selectedVideoArtifact(id);
  const selected = artifact?.content && typeof artifact.content === "object"
    ? (artifact.content as any).script
    : null;
  return selected ? { ...snapshot, ...selected, id: snapshot.id, projectId: snapshot.projectId } : snapshot;
}

export async function updateVideoScript(id: number, data: Partial<InsertVideoScript>) {
  const db = await getDb();
  if (!db) return;
  await db.update(videoScripts).set(data).where(eq(videoScripts.id, id));
  await registerVideoArtifact(id, "user_edit");
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
  await captureVideoChange(data.videoScriptId);
  return result.insertId;
}

export async function getCompetitorScriptsByVideoScript(videoScriptId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(videoCompetitorScripts)
    .where(eq(videoCompetitorScripts.videoScriptId, videoScriptId))
    .orderBy(asc(videoCompetitorScripts.id));
}

export async function getCompetitorScriptById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(videoCompetitorScripts).where(eq(videoCompetitorScripts.id, id)).limit(1);
  return row || null;
}

export async function updateCompetitorScript(id: number, data: Partial<InsertVideoCompetitorScript>) {
  const db = await getDb();
  if (!db) return;
  const [existing] = await db.select({ videoScriptId: videoCompetitorScripts.videoScriptId }).from(videoCompetitorScripts).where(eq(videoCompetitorScripts.id, id));
  await db.update(videoCompetitorScripts).set(data).where(eq(videoCompetitorScripts.id, id));
  await captureVideoChange(existing?.videoScriptId);
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
    await captureVideoChange(data.videoScriptId);
    return existing[0].id;
  }
  const [result] = await db.insert(videoCompetitorSummary).values(data);
  await captureVideoChange(data.videoScriptId);
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
    await captureVideoChange(data.videoScriptId);
    return existing[0].id;
  }
  const [result] = await db.insert(videoProductSnapshots).values(data);
  await captureVideoChange(data.videoScriptId);
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
  if (sections.length === 0) {
    await captureVideoChange(videoScriptId);
    return [];
  }
  const insertData = sections.map((s, i) => ({ ...s, videoScriptId, sortOrder: i }));
  await db.insert(videoScriptSections).values(insertData);
  const saved = await db.select().from(videoScriptSections)
    .where(eq(videoScriptSections.videoScriptId, videoScriptId))
    .orderBy(asc(videoScriptSections.sortOrder));
  await captureVideoChange(videoScriptId);
  return saved;
}

export async function getSections(videoScriptId: number) {
  const db = await getDb();
  if (!db) return [];
  const artifact = await selectedVideoArtifact(videoScriptId);
  const selected = artifact?.content && typeof artifact.content === "object"
    ? (artifact.content as any).sections
    : null;
  if (Array.isArray(selected)) return selected;
  return db.select().from(videoScriptSections)
    .where(eq(videoScriptSections.videoScriptId, videoScriptId))
    .orderBy(asc(videoScriptSections.sortOrder));
}

export async function updateSection(id: number, data: Partial<InsertVideoScriptSection>) {
  const db = await getDb();
  if (!db) return;
  await db.update(videoScriptSections).set(data).where(eq(videoScriptSections.id, id));
  await captureVideoChange(await videoScriptIdForSection(id));
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
  const videoScriptId = await videoScriptIdForSection(sectionId);
  if (subtopics.length === 0) {
    await captureVideoChange(videoScriptId);
    return [];
  }
  const insertData = subtopics.map((s, i) => ({ ...s, sectionId, sortOrder: i }));
  await db.insert(videoScriptSubtopics).values(insertData);
  const saved = await db.select().from(videoScriptSubtopics)
    .where(eq(videoScriptSubtopics.sectionId, sectionId))
    .orderBy(asc(videoScriptSubtopics.sortOrder));
  await captureVideoChange(videoScriptId);
  return saved;
}

export async function getSubtopicsBySection(sectionId: number) {
  const db = await getDb();
  if (!db) return [];
  const videoScriptId = await videoScriptIdForSection(sectionId);
  const artifact = videoScriptId ? await selectedVideoArtifact(videoScriptId) : null;
  const selected = artifact?.content && typeof artifact.content === "object"
    ? (artifact.content as any).subtopics
    : null;
  if (Array.isArray(selected)) {
    return selected.filter((subtopic: any) => Number(subtopic.sectionId) === sectionId)
      .sort((left: any, right: any) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
  }
  return db.select().from(videoScriptSubtopics)
    .where(eq(videoScriptSubtopics.sectionId, sectionId))
    .orderBy(asc(videoScriptSubtopics.sortOrder));
}

export async function getSubtopicsByVideoScript(videoScriptId: number) {
  const db = await getDb();
  if (!db) return [];
  const artifact = await selectedVideoArtifact(videoScriptId);
  const selected = artifact?.content && typeof artifact.content === "object"
    ? (artifact.content as any).subtopics
    : null;
  if (Array.isArray(selected)) return selected;
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
  const videoScriptId = await videoScriptIdForSection(sectionId);
  if (shots.length === 0) {
    await captureVideoChange(videoScriptId);
    return [];
  }
  const insertData = shots.map((s, i) => ({ ...s, subtopicId, sectionId, sortOrder: i }));
  await db.insert(videoScriptShots).values(insertData);
  const saved = await db.select().from(videoScriptShots)
    .where(eq(videoScriptShots.subtopicId, subtopicId))
    .orderBy(asc(videoScriptShots.sortOrder));
  await captureVideoChange(videoScriptId);
  return saved;
}

export async function getShotsBySubtopic(subtopicId: number) {
  const db = await getDb();
  if (!db) return [];
  const videoScriptId = await videoScriptIdForSubtopic(subtopicId);
  const artifact = videoScriptId ? await selectedVideoArtifact(videoScriptId) : null;
  const selected = artifact?.content && typeof artifact.content === "object"
    ? (artifact.content as any).shots
    : null;
  if (Array.isArray(selected)) {
    return selected.filter((shot: any) => Number(shot.subtopicId) === subtopicId)
      .sort((left: any, right: any) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
  }
  return db.select().from(videoScriptShots)
    .where(eq(videoScriptShots.subtopicId, subtopicId))
    .orderBy(asc(videoScriptShots.sortOrder));
}

export async function getShotsByVideoScript(videoScriptId: number) {
  const db = await getDb();
  if (!db) return [];
  const artifact = await selectedVideoArtifact(videoScriptId);
  const selected = artifact?.content && typeof artifact.content === "object"
    ? (artifact.content as any).shots
    : null;
  if (Array.isArray(selected)) return selected;
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
  const [existing] = await db.select({ subtopicId: videoScriptShots.subtopicId }).from(videoScriptShots).where(eq(videoScriptShots.id, id));
  await db.update(videoScriptShots).set(data).where(eq(videoScriptShots.id, id));
  await captureVideoChange(existing ? await videoScriptIdForSubtopic(existing.subtopicId) : null);
}

export async function deleteShot(id: number) {
  const db = await getDb();
  if (!db) return;
  const [existing] = await db.select({ subtopicId: videoScriptShots.subtopicId }).from(videoScriptShots).where(eq(videoScriptShots.id, id));
  await db.delete(videoScriptShots).where(eq(videoScriptShots.id, id));
  await captureVideoChange(existing ? await videoScriptIdForSubtopic(existing.subtopicId) : null);
}

// ─── Edit Scripts ───────────────────────────────────────────────

export async function saveEditScripts(videoScriptId: number, editScripts: InsertVideoEditScript[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(videoEditScripts).where(eq(videoEditScripts.videoScriptId, videoScriptId));
  if (editScripts.length === 0) {
    await captureVideoChange(videoScriptId);
    return [];
  }
  const insertData = editScripts.map((s, i) => ({ ...s, videoScriptId, sortOrder: i }));
  await db.insert(videoEditScripts).values(insertData);
  const saved = await db.select().from(videoEditScripts)
    .where(eq(videoEditScripts.videoScriptId, videoScriptId))
    .orderBy(asc(videoEditScripts.sortOrder));
  await captureVideoChange(videoScriptId);
  return saved;
}

export async function getEditScripts(videoScriptId: number) {
  const db = await getDb();
  if (!db) return [];
  const artifact = await selectedVideoArtifact(videoScriptId);
  const selected = artifact?.content && typeof artifact.content === "object"
    ? (artifact.content as any).editScripts
    : null;
  if (Array.isArray(selected)) return selected;
  return db.select().from(videoEditScripts)
    .where(eq(videoEditScripts.videoScriptId, videoScriptId))
    .orderBy(asc(videoEditScripts.sortOrder));
}

export async function updateEditScript(id: number, data: Partial<InsertVideoEditScript>) {
  const db = await getDb();
  if (!db) return;
  const [existing] = await db.select({ videoScriptId: videoEditScripts.videoScriptId }).from(videoEditScripts).where(eq(videoEditScripts.id, id));
  await db.update(videoEditScripts).set(data).where(eq(videoEditScripts.id, id));
  await captureVideoChange(existing?.videoScriptId);
}

// ─── Version Management ────────────────────────────────────────

export async function createVersion(data: InsertVideoScriptVersion) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(videoScriptVersions).values(data);
  await captureVideoChange(data.videoScriptId);
  return result.insertId;
}

export async function getVersionsByVideoScript(videoScriptId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(videoScriptVersions)
    .where(eq(videoScriptVersions.videoScriptId, videoScriptId))
    .orderBy(desc(videoScriptVersions.version));
}

export async function getVersionById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(videoScriptVersions).where(eq(videoScriptVersions.id, id));
  return rows[0] ?? null;
}

// ─── SPV Segments ──────────────────────────────────────────────

export async function saveSpvSegments(videoScriptId: number, segments: InsertVideoSpvSegment[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(videoSpvSegments).where(eq(videoSpvSegments.videoScriptId, videoScriptId));
  if (segments.length === 0) {
    await captureVideoChange(videoScriptId);
    return [];
  }
  const insertData = segments.map((s, i) => ({ ...s, videoScriptId, sortOrder: i }));
  await db.insert(videoSpvSegments).values(insertData);
  const saved = await db.select().from(videoSpvSegments)
    .where(eq(videoSpvSegments.videoScriptId, videoScriptId))
    .orderBy(asc(videoSpvSegments.sortOrder));
  await captureVideoChange(videoScriptId);
  return saved;
}

export async function getSpvSegments(videoScriptId: number) {
  const db = await getDb();
  if (!db) return [];
  const artifact = await selectedVideoArtifact(videoScriptId);
  const selected = artifact?.content && typeof artifact.content === "object"
    ? (artifact.content as any).spvSegments
    : null;
  if (Array.isArray(selected)) return selected;
  return db.select().from(videoSpvSegments)
    .where(eq(videoSpvSegments.videoScriptId, videoScriptId))
    .orderBy(asc(videoSpvSegments.sortOrder));
}

export async function updateSpvSegment(id: number, data: Partial<InsertVideoSpvSegment>) {
  const db = await getDb();
  if (!db) return;
  const [existing] = await db.select({ videoScriptId: videoSpvSegments.videoScriptId }).from(videoSpvSegments).where(eq(videoSpvSegments.id, id));
  await db.update(videoSpvSegments).set(data).where(eq(videoSpvSegments.id, id));
  await captureVideoChange(existing?.videoScriptId);
}

export async function deleteSpvSegment(id: number) {
  const db = await getDb();
  if (!db) return;
  const [existing] = await db.select({ videoScriptId: videoSpvSegments.videoScriptId }).from(videoSpvSegments).where(eq(videoSpvSegments.id, id));
  await db.delete(videoSpvSegments).where(eq(videoSpvSegments.id, id));
  await captureVideoChange(existing?.videoScriptId);
}

// ─── Reorder Helpers ───────────────────────────────────────────

export async function reorderSections(videoScriptId: number, sectionIds: number[]) {
  const db = await getDb();
  if (!db) return;
  for (let i = 0; i < sectionIds.length; i++) {
    await db.update(videoScriptSections)
      .set({ sortOrder: i })
      .where(and(eq(videoScriptSections.id, sectionIds[i]), eq(videoScriptSections.videoScriptId, videoScriptId)));
  }
  await captureVideoChange(videoScriptId);
}

export async function reorderShots(subtopicId: number, shotIds: number[]) {
  const db = await getDb();
  if (!db) return;
  for (let i = 0; i < shotIds.length; i++) {
    await db.update(videoScriptShots)
      .set({ sortOrder: i })
      .where(and(eq(videoScriptShots.id, shotIds[i]), eq(videoScriptShots.subtopicId, subtopicId)));
  }
  await captureVideoChange(await videoScriptIdForSubtopic(subtopicId));
}

export async function addShotToSubtopic(subtopicId: number, sectionId: number, data: Partial<InsertVideoScriptShot>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getShotsBySubtopic(subtopicId);
  const maxOrder = existing.length > 0 ? Math.max(...existing.map(s => s.sortOrder ?? 0)) + 1 : 0;
  const [result] = await db.insert(videoScriptShots).values({
    ...data,
    subtopicId,
    sectionId,
    sortOrder: maxOrder,
  } as InsertVideoScriptShot);
  await captureVideoChange(await videoScriptIdForSection(sectionId));
  return result.insertId;
}
