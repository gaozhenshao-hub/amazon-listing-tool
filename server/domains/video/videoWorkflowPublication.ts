import { getTableColumns } from "drizzle-orm";
import { getTableConfig, type AnyMySqlTable } from "drizzle-orm/mysql-core";
import * as video from "../../../drizzle/schema/video";
import { VIDEO_WORKFLOW_DEFINITIONS, parseVideoWorkflowCandidate, videoWorkflowHash, videoWorkflowCanonical, type VideoWorkflowSource } from "../../../shared/videoWorkflow";
import { captureVideoWorkflowTables, videoWorkflowStatement, videoWorkflowFail as fail, videoWorkflowJson, VIDEO_TABLES, type VideoWorkflowExecutor } from "./videoWorkflowSource";

type Row = Record<string, unknown>;
async function execute(tx: VideoWorkflowExecutor, query: string, params: unknown[], count: number) {
  const result = await tx.execute(videoWorkflowStatement(query, params));
  if (!Array.isArray(result) || !result[0] || result[0].affectedRows !== count || result[0].warningStatus !== 0) fail("PUBLICATION_UNCONFIRMED");
  return result[0] as { insertId: number };
}
async function insert(tx: VideoWorkflowExecutor, table: AnyMySqlTable, value: Row) {
  const columns = getTableColumns(table), names = Object.keys(value);
  if (!names.length || names.some(name => !columns[name] || ["id", "createdAt", "updatedAt"].includes(name))) fail("PUBLICATION_FIELD_INVALID");
  const params = names.map(name => columns[name].getSQLType() === "json" && value[name] !== null ? videoWorkflowCanonical(value[name]) : value[name]);
  for (let index = 0; index < names.length; index++) {
    const type = columns[names[index]].getSQLType(), v = params[index];
    if (typeof v === "string" && (/^text$/u.test(type) && Buffer.byteLength(v) > 65535 || /^varchar\(/u.test(type) && [...v].length > Number(type.match(/\d+/u)?.[0]))) fail("PUBLICATION_FIELD_LIMIT");
  }
  const result = await execute(tx, `INSERT INTO \`${getTableConfig(table).name}\` (${names.map(name => `\`${columns[name].name}\``).join(",")}) VALUES (${names.map(() => "?").join(",")})`, params, 1);
  if (!Number.isSafeInteger(result.insertId) || result.insertId < 1) fail("PUBLICATION_ID_UNCONFIRMED");
  return result.insertId;
}
async function update(tx: VideoWorkflowExecutor, table: AnyMySqlTable, id: unknown, value: Row) {
  const columns = getTableColumns(table), names = Object.keys(value);
  if (!Number.isSafeInteger(id) || names.some(name => !columns[name] || ["id", "createdAt", "updatedAt"].includes(name))) fail("PUBLICATION_FIELD_INVALID");
  for (const name of names) {
    const type = columns[name].getSQLType(), v = value[name];
    if (typeof v === "string" && (type === "text" && Buffer.byteLength(v) > 65535 || /^varchar\(/u.test(type) && [...v].length > Number(type.match(/\d+/u)?.[0]))) fail("PUBLICATION_FIELD_LIMIT");
  }
  await execute(tx, `UPDATE \`${getTableConfig(table).name}\` SET ${names.map(name => `\`${columns[name].name}\`=?`).join(",")},updatedAt=NOW() WHERE id=?`,
    [...names.map(name => columns[name].getSQLType() === "json" && value[name] !== null ? videoWorkflowCanonical(value[name]) : value[name]), id], 1);
}
export async function saveVideoWorkflowVersion(tx: VideoWorkflowExecutor, tables: Record<string, Row[]>, actorId: number, note: string) {
  const script = tables.video_scripts?.[0];
  if (!script || !Number.isSafeInteger(script.id) || !Number.isSafeInteger(script.version)) fail("VERSION_INVALID");
  const snapshotData = { schema: "video-workflow-full-version/v1", tables };
  if (Buffer.byteLength(videoWorkflowCanonical(snapshotData)) > 8 * 1024 * 1024) fail("VERSION_LIMIT");
  return insert(tx, video.videoScriptVersions, { videoScriptId: script.id, version: script.version, versionNote: note, snapshotData, createdBy: actorId });
}

/** Restores all persisted business fields. Old five-part versions never
 * contained 0A/0B/SPV; retain those current groups instead of inventing history. */
export async function restoreVideoWorkflowVersion(tx: VideoWorkflowExecutor, scope: VideoWorkflowSource["scope"], value: unknown) {
  const snapshot = videoWorkflowJson(value) as Row, current = await captureVideoWorkflowTables(tx, scope);
  const full = snapshot.schema === "video-workflow-full-version/v1";
  const raw = full ? snapshot.tables : { ...current, video_scripts: [snapshot.script], video_script_sections: snapshot.sections,
    video_script_subtopics: snapshot.subtopics, video_script_shots: snapshot.shots, video_edit_scripts: snapshot.editScripts };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("VERSION_INVALID");
  const restored = raw as Record<string, Row[]>;
  const tables = VIDEO_TABLES.filter(table => getTableConfig(table).name !== "video_script_versions");
  if (Object.keys(restored).length !== tables.length || tables.some(table => !Array.isArray(restored[getTableConfig(table).name]))) fail("VERSION_INCOMPLETE");
  if (restored.video_scripts.length !== 1 || restored.video_scripts[0]?.id !== scope.videoScriptId || restored.video_scripts[0]?.projectId !== scope.projectId) fail("VERSION_SCOPE_INVALID");
  for (const table of tables) {
    const name = getTableConfig(table).name, entries = restored[name];
    if (entries.length > 10000 || new Set(entries.map(row => row.id)).size !== entries.length || entries.some(row => !Number.isSafeInteger(row.id) || Number(row.id) < 1)) fail("VERSION_INVALID");
    if (!["video_scripts", "video_script_subtopics", "video_script_shots"].includes(name) && entries.some(row => row.videoScriptId !== scope.videoScriptId)) fail("VERSION_SCOPE_INVALID");
  }
  const sections = new Set(restored.video_script_sections.map(row => row.id)), subs = new Map(restored.video_script_subtopics.map(row => [row.id, row.sectionId]));
  if (restored.video_script_subtopics.some(row => !sections.has(row.sectionId)) || restored.video_script_shots.some(row => subs.get(row.subtopicId) !== row.sectionId)) fail("VERSION_HIERARCHY_INVALID");
  const ordered: AnyMySqlTable[] = [video.videoScriptShots, video.videoScriptSubtopics, video.videoScriptSections, video.videoEditScripts, video.videoCompetitorSummary, video.videoCompetitorScripts, video.videoProductSnapshots, video.videoSpvSegments];
  for (const table of ordered) {
    const name = getTableConfig(table).name, where = ["video_script_shots", "video_script_subtopics"].includes(name) ? "sectionId IN (SELECT id FROM video_script_sections WHERE videoScriptId=?)" : "videoScriptId=?";
    await execute(tx, `DELETE FROM \`${name}\` WHERE ${where}`, [scope.videoScriptId], current[name].length);
  }
  const expected: Record<string, Row[]> = {};
  for (const table of [...ordered].reverse()) {
    const name = getTableConfig(table).name, columns = getTableColumns(table); expected[name] = [];
    for (const row of restored[name]) {
      const values = Object.fromEntries(Object.entries(row).filter(([key]) => columns[key] && !["createdAt", "updatedAt"].includes(key)));
      const names = Object.keys(values);
      for (const key of names) { const value = values[key], type = columns[key].getSQLType();
        if (typeof value === "string" && (type === "text" && Buffer.byteLength(value) > 65535 || /^varchar\(/u.test(type) && [...value].length > Number(type.match(/\d+/u)?.[0]))) fail("VERSION_FIELD_LIMIT"); }
      await execute(tx, `INSERT INTO \`${name}\` (${names.map(key => `\`${columns[key].name}\``).join(",")}) VALUES (${names.map(() => "?").join(",")})`, names.map(key => columns[key].getSQLType() === "json" && values[key] !== null ? videoWorkflowCanonical(values[key]) : values[key]), 1);
      expected[name].push(values);
    }
  }
  const columns = getTableColumns(video.videoScripts as AnyMySqlTable), script = Object.fromEntries(Object.entries(restored.video_scripts[0]).filter(([key]) => columns[key] && !["id", "projectId", "userId", "version", "createdAt", "updatedAt"].includes(key)));
  await update(tx, video.videoScripts, scope.videoScriptId, script);
  const after = await captureVideoWorkflowTables(tx, scope);
  for (const [name, entries] of Object.entries(expected)) {
    if (after[name].length !== entries.length) fail("PUBLICATION_READBACK_INVALID");
    for (const expectedRow of entries) {
      const row = after[name].find(row => row.id === expectedRow.id); if (!row) fail("PUBLICATION_READBACK_INVALID");
      for (const [key, value] of Object.entries(expectedRow)) if (videoWorkflowCanonical(row[key]) !== videoWorkflowCanonical(value)) fail("PUBLICATION_READBACK_INVALID");
    }
  }
  for (const [key, value] of Object.entries(script)) if (videoWorkflowCanonical(after.video_scripts[0][key]) !== videoWorkflowCanonical(value)) fail("PUBLICATION_READBACK_INVALID");
  return { restoration: full ? "full" as const : "legacy_partial_preserving_uncaptured" as const };
}
/** Caller owns project→script lock and current source CAS. Every replaced row
 * remains in an immutable full before-version; failed writes roll back together. */
export async function applyVideoWorkflowCandidate(tx: VideoWorkflowExecutor, source: VideoWorkflowSource, raw: unknown, replaceConfirmed: boolean, actorId: number) {
  const candidate = parseVideoWorkflowCandidate(source.operation, raw), before = source.tables, scope = source.scope, script = before.video_scripts[0];
  const node = VIDEO_WORKFLOW_DEFINITIONS[source.operation].node, statuses = { ...(script.stageStatus as Row) };
  if (statuses[node] === "confirmed" && !replaceConfirmed) fail("REPLACE_CONFIRMATION_REQUIRED");
  if (videoWorkflowHash(await captureVideoWorkflowTables(tx, scope)) !== videoWorkflowHash(Object.fromEntries(Object.entries(before).filter(([name]) => name.startsWith("video_"))))) fail("SOURCE_CHANGED");
  const version = Number(script.version); if (!Number.isSafeInteger(version) || version < 1 || version >= 2147483647) fail("VERSION_INVALID");
  await insert(tx, video.videoScriptVersions, { videoScriptId: scope.videoScriptId, version, versionNote: `Before human application: ${source.operation}`,
    snapshotData: { schema: "video-workflow-full-version/v1", sourceHash: source.sourceHash, tables: Object.fromEntries(Object.entries(before).filter(([name]) => name.startsWith("video_"))) }, createdBy: actorId });
  const expected: Array<{ table: string; id: number; value: Row }> = [];
  const put = async (table: AnyMySqlTable, value: Row, id?: number) => {
    const actualId = id ?? await insert(tx, table, value); if (id) await update(tx, table, id, value);
    expected.push({ table: getTableConfig(table).name, id: actualId, value }); return actualId;
  };
  const remove = async (name: string, where: string) => execute(tx, `DELETE FROM \`${name}\` WHERE ${where}`, [scope.videoScriptId], before[name].length);
  const removeShots = () => remove("video_script_shots", "sectionId IN (SELECT id FROM video_script_sections WHERE videoScriptId=?)");
  const removeSubs = () => remove("video_script_subtopics", "sectionId IN (SELECT id FROM video_script_sections WHERE videoScriptId=?)");
  if (source.operation === "competitor_analysis") {
    const row = before.video_competitor_scripts.find(value => value.id === source.competitorScriptId); if (!row) fail("SOURCE_CHANGED");
    await put(video.videoCompetitorScripts, { structureAnalysis: candidate.structure_analysis, visualLanguage: candidate.visual_language, copywritingAnalysis: candidate.copywriting_analysis,
      strengths: candidate.strengths, weaknesses: candidate.weaknesses, reusablePatterns: candidate.reusable_patterns, userConfirmed: 1 }, Number(row.id));
  } else if (source.operation === "competitor_summary") {
    if (before.video_competitor_summary.length > 1) fail("SOURCE_DUPLICATE");
    await put(video.videoCompetitorSummary, { videoScriptId: scope.videoScriptId, competitorScriptIds: before.video_competitor_scripts.map(row => row.id), commonStructure: candidate.common_structure,
      optimalDurationAllocation: candidate.optimal_duration_allocation, differentiableOpportunities: candidate.differentiable_opportunities, recommendedStructure: candidate.recommended_structure,
      userConfirmed: 1, userEdits: candidate }, before.video_competitor_summary[0]?.id as number | undefined);
  } else if (source.operation === "product_info") {
    if (before.video_product_snapshots.length > 1) fail("SOURCE_DUPLICATE");
    await put(video.videoProductSnapshots, { videoScriptId: scope.videoScriptId, basicInfo: candidate.basic_info, sellingPointsHierarchy: candidate.selling_points_hierarchy,
      painPoints: candidate.pain_points_from_reviews, keywords: candidate.keywords_for_overlay, productSpecs: candidate.key_specs, dataSources: { sourceHash: source.sourceHash, operation: source.operation }, userConfirmed: 1, userEdits: candidate }, before.video_product_snapshots[0]?.id as number | undefined);
  } else if (source.operation === "sections") {
    await removeShots(); await removeSubs(); await remove("video_script_sections", "videoScriptId=?");
    const sections = candidate.sections as Row[]; if (new Set(sections.map(row => row.section_code)).size !== sections.length) fail("DUPLICATE_SECTION");
    for (const [sortOrder, row] of sections.entries()) await put(video.videoScriptSections, { videoScriptId: scope.videoScriptId, sectionCode: row.section_code, sectionName: row.section_name, sectionNameEn: row.section_name_en,
      shootingMethod: row.shooting_method, durationBudget: String(row.duration_budget), sellingPointRefs: row.selling_point_refs, painPointRefs: row.pain_point_refs, description: row.description,
      shotTypeSuggestion: row.shot_type_suggestion, propsSuggestion: row.props_suggestion, sortOrder, userConfirmed: 1 });
  } else if (source.operation === "subtopics") {
    await removeShots(); await removeSubs();
    const sections = candidate.sections as Array<Row & { subtopics: Row[] }>;
    if (sections.length !== before.video_script_sections.length || new Set(sections.map(row => row.section_code)).size !== sections.length) fail("SECTION_COVERAGE_INVALID");
    for (const section of sections) {
      const matches = before.video_script_sections.filter(row => row.sectionCode === section.section_code); if (matches.length !== 1) fail("SECTION_COVERAGE_INVALID");
      if (new Set(section.subtopics.map(row => row.subtopic_name)).size !== section.subtopics.length) fail("SUBTOPIC_DUPLICATE");
      for (const [sortOrder, row] of section.subtopics.entries()) await put(video.videoScriptSubtopics, { sectionId: matches[0].id, subtopicName: row.subtopic_name, subtopicNameEn: row.subtopic_name_en,
        durationBudget: String(row.duration_budget), shotCount: row.shot_count, sellingPointRef: row.selling_point_ref, sortOrder });
    }
  } else if (source.operation === "shots") {
    await removeShots(); const shots = candidate.shots as Row[], covered = new Set<unknown>();
    if (new Set(shots.map(row => row.shot_code)).size !== shots.length) fail("SHOT_DUPLICATE");
    for (const [sortOrder, row] of shots.entries()) {
      const sections = before.video_script_sections.filter(value => value.sectionCode === row.section_code);
      const subs = before.video_script_subtopics.filter(value => value.sectionId === sections[0]?.id && value.subtopicName === row.subtopic_name);
      if (sections.length !== 1 || subs.length !== 1) fail("SHOT_COVERAGE_INVALID"); covered.add(subs[0].id);
      await put(video.videoScriptShots, { subtopicId: subs[0].id, sectionId: sections[0].id, shotCode: row.shot_code, duration: String(row.duration), shotDescription: row.shot_description,
        sceneLocation: row.scene_location, cameraAngle: row.camera_angle, cameraMovement: row.camera_movement, overlayTextEn: row.overlay_text_en, overlayTextCn: row.overlay_text_cn,
        narrationEn: row.narration_en, narrationCn: row.narration_cn, subtitleEn: row.subtitle_en, subtitleCn: row.subtitle_cn, narratorType: row.narrator_type,
        generationStrategy: row.generation_strategy, reuseFromShotCode: row.reuse_from_shot_code, designatedAssets: row.designated_assets ?? null,
        colorScheme: row.color_scheme, props: row.props, notes: row.notes, referenceImageUrl: row.reference_image_url ?? null, sortOrder });
    }
    if (covered.size !== before.video_script_subtopics.length) fail("SHOT_COVERAGE_INVALID");
  } else {
    await remove("video_edit_scripts", "videoScriptId=?");
    for (const [sortOrder, row] of (candidate.edit_scripts as Row[]).entries()) await put(video.videoEditScripts, { videoScriptId: scope.videoScriptId, editName: row.edit_name, videoPurpose: row.video_purpose,
      maxDuration: String(row.max_duration), editStyle: row.edit_style, sectionMapping: row.section_mapping, description: row.description, sortOrder, userConfirmed: 1 });
  }
  const order = ["stage_0b", "stage_1", "stage_2", "stage_3", "stage_4"], index = order.indexOf(node);
  for (const next of node === "stage_0a" ? order.slice(1) : order.slice(index + 1)) statuses[next] = "stale";
  statuses[node] = "confirmed";
  await execute(tx, "UPDATE video_scripts SET version=version+1,stageStatus=?,updatedAt=NOW() WHERE id=? AND projectId=? AND version=?", [videoWorkflowCanonical(statuses), scope.videoScriptId, scope.projectId, version], 1);
  const tables = await captureVideoWorkflowTables(tx, scope);
  if (tables.video_scripts[0].version !== version + 1 || videoWorkflowHash(tables.video_scripts[0].stageStatus) !== videoWorkflowHash(statuses)) fail("PUBLICATION_READBACK_INVALID");
  for (const item of expected) {
    const actual = tables[item.table].filter(row => row.id === item.id); if (actual.length !== 1) fail("PUBLICATION_READBACK_INVALID");
    for (const [key, value] of Object.entries(item.value)) {
      const actualValue = actual[0][key];
      if (["duration", "durationBudget", "maxDuration"].includes(key) ? Number(actualValue) !== Number(value) : videoWorkflowCanonical(actualValue) !== videoWorkflowCanonical(value)) fail("PUBLICATION_READBACK_INVALID");
    }
  }
  return { tables, version: version + 1, afterHash: videoWorkflowHash(tables) };
}
