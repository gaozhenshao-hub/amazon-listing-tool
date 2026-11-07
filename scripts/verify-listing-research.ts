import "dotenv/config";
import mysql from "mysql2/promise";
import { readFile, writeFile } from "node:fs/promises";
import { acquisitionReviewHash } from "../shared/acquisitionReview";
import { readJson } from "../shared/competitorPresentation";
import { competitorVideoAnalysisSchema } from "../shared/competitorVideoAnalysis";
import { richModuleTargets } from "../shared/richModuleSellingPoints";
import {
  analyzeCompetitorVideo,
  competitorVideoSource,
  unifyVideoModules,
} from "../server/domains/listing/competitorVideos";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { requireDb } from "../server/repositories/dbClient";
import { competitorStudyFields } from "../shared/competitorStudyFields";
import { loadSupplementalReviews } from "../server/domains/listing/supplementalReviews";
import { refineExistingReviewGroups } from "../server/domains/listing/competitorReviewsV2";
import {
  readListingAggregation,
  saveListingAggregation,
} from "../server/domains/listing/aggregationStore";
import { generateListingAggregation } from "../server/domains/listing/generateListingAggregation";
import { collectAggregationSources } from "../server/domains/listing/aggregationSources";
import { aggregationSourceEvidence } from "../server/domains/listing/aggregationEvidence";
import {
  adjustAggregationResult,
  confirmAggregationResult,
} from "../server/domains/listing/aggregationAdjustments";
import { bindResearchSkills } from "./setup-listing-research-skills";
import { researchSkillDefinitions } from "./setup-listing-research-skills";
const numberArg = (name: string) => {
  const at = process.argv.indexOf("--" + name),
    value = at < 0 ? NaN : Number(process.argv[at + 1]);
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error("必须指定" + name);
  return value;
};
const scope = {
  projectId: numberArg("project"),
  workspaceId: numberArg("workspace"),
  userId: numberArg("user"),
};
const baselineFile =
  "/tmp/listing-research-baseline-" +
  scope.workspaceId +
  "-" +
  scope.projectId +
  "-20261101.json";
const db = await mysql.createConnection(process.env.DATABASE_URL!);
const query = async (sql: string, params: unknown[] = []) =>
  (await db.execute(sql, params))[0] as any[];
const normalize = (v: unknown) => JSON.parse(JSON.stringify(v));
const hash = (v: unknown) => acquisitionReviewHash(normalize(v));
async function owned() {
  const [project] = await query(
    "SELECT * FROM projects WHERE id=? AND workspaceId=? AND userId=?",
    [scope.projectId, scope.workspaceId, scope.userId]
  );
  if (!project) throw new Error("项目不可访问");
  return project;
}
async function records() {
  return query(
    "SELECT * FROM competitorAnalyses WHERE projectId=? ORDER BY id",
    [scope.projectId]
  );
}
async function protectedHashes() {
  const result: Record<string, string> = {};
  for (const table of ["kb_images", "kb_image_sets", "kb_videos"])
    result[table] = hash(
      await query(
        "SELECT * FROM " + table + " WHERE workspaceId=? ORDER BY id",
        [scope.workspaceId]
      )
    );
  result.importedReviews = hash(
    await query(
      "SELECT * FROM listing_supplemental_reviews WHERE projectId=? ORDER BY id",
      [scope.projectId]
    )
  );
  return result;
}
async function snapshot() {
  try {
    const prior = JSON.parse(await readFile(baselineFile, "utf8"));
    if (
      prior.scope.projectId !== scope.projectId ||
      prior.scope.workspaceId !== scope.workspaceId
    )
      throw new Error("验收基线范围不一致");
    console.log("RESEARCH_SNAPSHOT_REUSED");
    return;
  } catch (e) {
    if ((e as any).code !== "ENOENT") throw e;
  }
  const data = {
    scope,
    createdAt: new Date().toISOString(),
    records: await records(),
    aggregate: await query(
      "SELECT * FROM listing_aggregations WHERE project_id=? AND workspace_id=?",
      [scope.projectId, scope.workspaceId]
    ),
    protected: await protectedHashes(),
    skills: await query(
      "SELECT slug,name,status,version,manifest FROM emperor_skills ORDER BY id"
    ),
  };
  await writeFile(baselineFile, JSON.stringify(data), { mode: 0o600 });
  console.log(
    "RESEARCH_SNAPSHOT " +
      JSON.stringify({ records: data.records.length, protected: true })
  );
}
async function installSkills() {
  for (const item of researchSkillDefinitions) {
    const [existing] = await query(
      "SELECT name,manifest,version,status FROM emperor_skills WHERE slug=? AND workspaceId IS NULL",
      [item.slug]
    );
    const manifest = {
      implementation: {
        systemPrompt: item.prompt,
        userPromptTemplate: "{{context}}",
        modelPolicy: "gem-3.8-flash",
        supportsJsonMode: true,
        ...(item.maxTokens ? {maxTokens:item.maxTokens}:{}),
      },
    };
    if (existing) {
      if (
        existing.version !== item.version ||
        existing.status !== "Released" ||
        hash(readJson(existing.manifest)) !== hash(manifest)
      )
        throw new Error("技能定义已变化，请检查：" + item.name);
    } else
      await db.execute(
        "INSERT INTO emperor_skills(slug,name,description,category,status,scope,version,isSystem,manifest,when_to_use) VALUES(?,?,?,'运营','Released','global',?,1,?,?)",
        [
          item.slug,
          item.name,
          item.description,
          item.version,
          JSON.stringify(manifest),
          item.description,
        ]
      );
  }
  console.log(
    "RESEARCH_SKILLS " +
      JSON.stringify(
        researchSkillDefinitions.map(s => ({ name: s.name, slug: s.slug }))
      )
  );
}
async function videos() {
  const controller = new AbortController();
  for (const record of await records()) {
    const raw = readJson(record.rawData) || {};
    for (const v of raw.videos || []) {
      try {
        competitorVideoSource(raw, v.hash);
      } catch {
        continue;
      }
      console.log(
        "RESEARCH_VIDEO_START " +
          JSON.stringify({
            asin: record.asin,
            role: v.role,
            hash: v.hash.slice(0, 10),
          })
      );
      const result = await analyzeCompetitorVideo(
        { ...scope, analysisId: record.id },
        v.hash,
        controller.signal
      );
      competitorVideoAnalysisSchema.parse(result);
      const replay = await analyzeCompetitorVideo(
        { ...scope, analysisId: record.id },
        v.hash,
        controller.signal
      );
      if (hash(replay) !== hash(result))
        throw new Error("已准备的视频未正确复用");
      console.log(
        "RESEARCH_VIDEO_READY " +
          JSON.stringify({
            asin: record.asin,
            role: v.role,
            duration: result.duration,
            speechCues: result.cues.filter(c => c.kind === "speech").length,
            screenCues: result.cues.filter(c => c.kind === "screen").length,
            sellingPoints: result.sellingPoints.map(p => p.text),
            samples: result.cues.slice(0, 2).map(c => ({
              source: c.source,
              translation: c.translation,
              start: c.start,
              end: c.end,
            })),
            notes: result.notes,
            reused: true,
          })
      );
    }
    if (raw.videos?.length)
      await unifyVideoModules(
        { ...scope, analysisId: record.id },
        controller.signal
      );
  }
}
async function refineReviews() {
  for (const record of await records()) {
    const raw = readJson(record.rawData) || {},
      study = raw.comparisonAnalysis;
    if (study?.reviewVersion !== 2) throw new Error("已有评论分析尚未就绪");
    if (study.reviewPresentationVersion === 2) {
      console.log("RESEARCH_REVIEW_REUSED " + record.asin);
      continue;
    }
    const groups = await refineExistingReviewGroups({
      ...scope,
      asin: record.asin,
      study,
      reviews: raw.research?.reviews || [],
      imported: await loadSupplementalReviews(scope.projectId, record.asin),
    });
    const next = structuredClone(raw);
    next.comparisonAnalysis.reviews = groups;
    next.comparisonAnalysis.reviewPresentationVersion = 2;
    const oldFields = competitorStudyFields(study, raw.sourceLayout),
      newFields = competitorStudyFields(
        next.comparisonAnalysis,
        raw.sourceLayout
      );
    await db.beginTransaction();
    try {
      await query("SELECT id FROM projects WHERE id=? FOR UPDATE", [
        scope.projectId,
      ]);
      const [locked] = await query(
        "SELECT rawData FROM competitorAnalyses WHERE id=? FOR UPDATE",
        [record.id]
      );
      if (hash(readJson(locked.rawData)) !== hash(raw))
        throw new Error("竞品资料已变化，请重新整理");
      const [aggregate] = await query(
        "SELECT data,revision FROM listing_aggregations WHERE project_id=? AND workspace_id=? FOR UPDATE",
        [scope.projectId, scope.workspaceId]
      );
      if (aggregate) {
        const data = readJson(aggregate.data);
        let changed = false;
        for (const mark of data.marks || [])
          if (mark.analysisId === record.id)
            for (const [key, edit] of Object.entries(mark.edits || {}) as any) {
              if (
                key.startsWith("review:") &&
                oldFields[key] === edit.original &&
                newFields[key] !== undefined &&
                newFields[key] !== edit.original
              ) {
                edit.original = newFields[key];
                changed = true;
              }
            }
        if (changed)
          await db.execute(
            "UPDATE listing_aggregations SET data=?,revision=revision+1 WHERE project_id=? AND workspace_id=?",
            [JSON.stringify(data), scope.projectId, scope.workspaceId]
          );
      }
      await db.execute("UPDATE competitorAnalyses SET rawData=? WHERE id=?", [
        JSON.stringify(next),
        record.id,
      ]);
      await db.commit();
    } catch (e) {
      await db.rollback();
      throw e;
    }
    console.log(
      "RESEARCH_REVIEWS_READY " +
        JSON.stringify({
          asin: record.asin,
          sampleCount: study.reviewSampleCount,
          groups: groups.map((g: any) => ({
            name: g.name,
            sentiment: g.sentiment,
            count: g.count,
            percentage: g.percentage,
          })),
        })
    );
  }
}
const productNotes =
  "【用户补充的本品事实与比较口径】\n本品有六组尺码，并有详细的尺寸及选码说明。尺码选项和尺码说明归入左侧必要性描述；不能仅凭有尺码表就声称实际尺码准确。多尺码选择有助于选码及合身体验，可作为待证实的必要卖点，注明实际准确性需评论或实测支持。\n本品头部采用双层面纱。用户预期：内部空间更大、视野更好、面纱离脸更远。这些体验属于用户说明，未做独立实测。用户说明某个A竞品也有双层面纱，因此相对该竞品没有此项优势；用户认为市场大部分竞品没有双层，但市场覆盖未核实，只能标注比较范围待核实，不能声称人无我有。\n本品袖口采用宽松紧带加魔术贴，替代细松紧绳，用户说明宽带减轻勒手感并提高舒适性。可以相对采用细松紧绳袖口的产品说明差异，但不能假设所有竞品都采用细绳。\n尚未填写本品完整属性表。竞品有而本品资料未列出的功能，不等于本品缺失；没有明确本品缺失依据，不生成待改进功能或待实现卖点。";
async function aggregate() {
  let current = await readListingAggregation(scope);
  if (!current.data.productNotes?.includes("【用户补充的本品事实与比较口径】"))
    current = await saveListingAggregation(scope, current.revision, {
      ...current.data,
      productNotes: [current.data.productNotes || "", productNotes]
        .filter(Boolean)
        .join("\n\n"),
    });
  const generated = await generateListingAggregation(scope, { preview: true });
  const ownedProject = await owned(),
    sources = collectAggregationSources(
      ownedProject,
      await records(),
      generated.data
    );
  if (hash(generated.data.reviewSummary) !== hash(sources.summary))
    throw new Error("评论合并样本总量不一致");
  if (
    scope.projectId === 1 &&
    (sources.summary.sampleCount !== 647 ||
      sources.summary.positive !== 344 ||
      sources.summary.negative !== 303)
  )
    throw new Error("当前两竞品的评论总数异常");
  if (
    !generated.data.features?.length ||
    !generated.data.selling.length ||
    !generated.data.links?.length
  )
    throw new Error("功能卖点图尚未完整构建");
  const saved = await saveListingAggregation(
    scope,
    generated.revision,
    generated.data
  );
  console.log(
    "RESEARCH_AGGREGATION_READY " +
      JSON.stringify({
        revision: saved.revision,
        summary: saved.data.reviewSummary,
        features: saved.data.features?.map(n => ({
          text: n.text,
          group: n.group,
          badges: n.badges,
          comparisonScope: n.comparisonScope,
          note: n.note,
        })),
        selling: saved.data.selling.map(n => ({
          text: n.text,
          group: n.group,
          note: n.note,
        })),
        links: saved.data.links?.length,
        reviews: saved.data.reviews.map(r => ({
          text: r.text,
          count: r.count,
          percentage: r.percentage,
          sentiment: r.sentiment,
        })),
      })
  );
}
async function conversation() {
  const before = await readListingAggregation(scope),
    feature = before.data.features?.find(n => n.evidence?.length);
  if (!feature) throw new Error("缺少带证据的功能节点");
  const message =
    "只修改功能“" +
    feature.text +
    "”的详细标注，在原标注后补充一句：功能归类与用户获益分开核对，原始来源可从证据入口查看。不要改动其他任何字段、分组、证据或连线。";
  const result = await adjustAggregationResult(scope, {
    projectId: scope.projectId,
    data: before.data,
    message,
    history: [],
  });
  if (hash(result.data) === hash(before.data))
    throw new Error("实际AI调整未产生可确认的变化");
  const history = [
    { role: "user" as const, text: message },
    { role: "assistant" as const, text: result.reply },
  ];
  const orm = await requireDb("verify research conversation"),
    marker = new Error("EXPECTED_RESEARCH_ROLLBACK");
  for (const improve of [false, true]) {
    let validated = false;
    try {
      await orm.transaction(async (tx: any) => {
        const input = {
          projectId: scope.projectId,
          data: result.data,
          baseline: result.baseline,
          history,
          operationId: randomUUID(),
          improve,
        };
        const saved = await confirmAggregationResult(
          { ...scope, role: "admin" },
          input,
          tx
        );
        const replay = await confirmAggregationResult(
          { ...scope, role: "admin" },
          input,
          tx
        );
        if (
          hash(saved) !== hash(replay) ||
          saved.revision !== before.revision + 1
        )
          throw new Error("重复确认未保持幂等");
        if (improve) {
          const [rows]: any = await tx.execute(
            sql`SELECT payload FROM emperor_skill_workbench_drafts WHERE id=${input.operationId}`
          );
          const payload = readJson(rows[0]?.payload),
            context = readJson(payload?.input?.context);
          if (
            !context?.input?.sourceEvidence?.length ||
            !context.feedback ||
            !Object.keys(context.originalResult || {}).length ||
            !Object.keys(context.editedResult || {}).length
          )
            throw new Error("真实改进草稿缺少原始/修改/反馈/来源");
        }
        validated = true;
        throw marker;
      });
    } catch (e) {
      if (e !== marker) throw e;
    }
    if (!validated) throw new Error("对话确认路径未验证");
    if (hash(await readListingAggregation(scope)) !== hash(before))
      throw new Error("验收调整未完整回滚");
    console.log(
      "RESEARCH_CONFIRM_VERIFIED " +
        JSON.stringify({ improve, idempotent: true, rolledBack: true })
    );
  }
}
async function evidence() {
  const current = await readListingAggregation(scope),
    refs = [...(current.data.features || []), ...current.data.selling].flatMap(
      n => n.evidence || []
    );
  const examples = [];
  for (const kind of ["image", "module", "video", "user"]) {
    const ref = refs.find(r => r.kind === kind);
    if (!ref) continue;
    const output = await aggregationSourceEvidence(scope, [ref]);
    const item = output.items[0];
    if (
      !item ||
      item.stale ||
      !item.quote ||
      (kind === "image" && !item.imageUrl) ||
      (kind === "video" && !item.video?.videoUrl)
    )
      throw new Error("来源证据未正确解析：" + kind);
    examples.push({
      kind,
      asin: item.asin,
      hasImage: !!item.imageUrl,
      hasVideo: !!item.video,
      start: item.start,
      quote: item.quote.slice(0, 100),
    });
  }
  console.log("RESEARCH_EVIDENCE_VERIFIED " + JSON.stringify(examples));
}
async function finalStatus() {
  const baseline = JSON.parse(await readFile(baselineFile, "utf8"));
  if (hash(await protectedHashes()) !== hash(baseline.protected))
    throw new Error("知识库或补充评论发生变化");
  for (const record of await records()) {
    const before = baseline.records.find((r: any) => r.id === record.id);
    const cleanTop = (r: any) => {
      const { rawData, updatedAt, ...rest } = r;
      return rest;
    };
    if (!before || hash(cleanTop(record)) !== hash(cleanTop(before)))
      throw new Error("竞品基本信息或人工数据发生变化");
    const clean = (r: any) => {
      const v = structuredClone(readJson(r.rawData) || {});
      delete v.videoProcessing;
      delete v.videoAnalysisJobRunId;
      delete v.videoAnalysisError;
      delete v.comparisonAnalysis?.videoAnalyses;
      delete v.comparisonAnalysis?.reviewPresentationVersion;
      delete v.comparisonAnalysis?.reviews;
      const ids = new Set(
        richModuleTargets(
          v.sourceLayout,
          v.comparisonAnalysis?.richContent?.images
        )
          .filter(t => t.videoHashes?.length)
          .map(t => t.id)
      );
      if (v.comparisonAnalysis?.richContent?.modulePoints)
        v.comparisonAnalysis.richContent.modulePoints =
          v.comparisonAnalysis.richContent.modulePoints.filter(
            (m: any) => !ids.has(m.id)
          );
      return v;
    };
    if (hash(clean(record)) !== hash(clean(before)))
      throw new Error("本次范围外的分析资料发生变化");
    const raw = readJson(record.rawData),
      old = readJson(before.rawData);
    const oldIds = new Set(
      old.comparisonAnalysis.reviews.flatMap((g: any) => g.reviewIds || [])
    );
    const newIds = new Set(
      raw.comparisonAnalysis.reviews.flatMap((g: any) => g.reviewIds || [])
    );
    if (hash([...oldIds].sort()) !== hash([...newIds].sort()))
      throw new Error("评论原始证据集合发生变化");
  }
  const current = await readListingAggregation(scope),
    oldAggregate = readJson(baseline.aggregate[0]?.data) || { marks: [] };
  const cleanMarks = (marks: any[]) =>
    marks.map(m => ({
      ...m,
      edits: Object.fromEntries(
        Object.entries(m.edits || {}).map(([k, v]: any) => [
          k,
          {
            ...(k.startsWith("review:") ? {} : { original: v.original }),
            value: v.value,
          },
        ])
      ),
    }));
  if (
    hash(cleanMarks(current.data.marks)) !==
    hash(cleanMarks(oldAggregate.marks || []))
  )
    throw new Error("人工收藏、标注或调整值发生变化");
  const oldSkills = await query(
    "SELECT slug,name,status,version,manifest FROM emperor_skills ORDER BY id"
  );
  for (const skill of baseline.skills)
    if (hash(oldSkills.find((s: any) => s.slug === skill.slug)) !== hash(skill))
      throw new Error("原有正式技能发生变化");
  console.log(
    "RESEARCH_FINAL_VERIFIED " +
      JSON.stringify({
        knowledgeUnchanged: true,
        importedReviewsUnchanged: true,
        manualValuesUnchanged: true,
        priorSkillsUnchanged: true,
        summary: current.data.reviewSummary,
      })
  );
}
async function status() {
  const baseline = JSON.parse(await readFile(baselineFile, "utf8"));
  if (hash(await protectedHashes()) !== hash(baseline.protected))
    throw new Error("知识库或补充评论发生变化");
  const current = await records();
  for (const record of current) {
    const before = baseline.records.find((r: any) => r.id === record.id);
    if (!before) throw new Error("竞品列表发生变化");
    const cleanTop = (r: any) => {
      const { rawData, updatedAt, ...rest } = r;
      return rest;
    };
    if (hash(cleanTop(record)) !== hash(cleanTop(before)))
      throw new Error("竞品基本信息或人工字段发生变化");
    const raw = readJson(record.rawData) || {},
      old = readJson(before.rawData) || {};
    const cleanRaw = (r: any) => {
      const value = structuredClone(r);
      delete value.videoProcessing;
      delete value.videoAnalysisJobRunId;
      delete value.videoAnalysisError;
      delete value.comparisonAnalysis?.videoAnalyses;
      const videoIds = new Set(
        richModuleTargets(
          value.sourceLayout,
          value.comparisonAnalysis?.richContent?.images
        )
          .filter(t => t.videoHashes?.length)
          .map(t => t.id)
      );
      if (value.comparisonAnalysis?.richContent?.modulePoints)
        value.comparisonAnalysis.richContent.modulePoints =
          value.comparisonAnalysis.richContent.modulePoints.filter(
            (m: any) => !videoIds.has(m.id)
          );
      return value;
    };
    if (hash(cleanRaw(raw)) !== hash(cleanRaw(old)))
      throw new Error("视频之外的分析资料发生变化");
  }
  console.log(
    "RESEARCH_VIDEO_VERIFIED " +
      JSON.stringify({
        records: current.length,
        knowledgeUnchanged: true,
        importedReviewsUnchanged: true,
        manualDataUnchanged: true,
      })
  );
}
try {
  await owned();
  if (process.argv.includes("--snapshot")) await snapshot();
  if (process.argv.includes("--skills")) await installSkills();
  if (process.argv.includes("--videos")) await videos();
  if (process.argv.includes("--status")) await status();
  if (process.argv.includes("--bind"))
    console.log(
      "RESEARCH_BINDING " +
        JSON.stringify(
          await bindResearchSkills(scope.workspaceId, scope.userId)
        )
    );
  if (process.argv.includes("--reviews")) await refineReviews();
  if (process.argv.includes("--aggregate")) await aggregate();
  if (process.argv.includes("--conversation")) await conversation();
  if (process.argv.includes("--evidence")) await evidence();
  if (process.argv.includes("--final-status")) await finalStatus();
} catch (error) {
  console.error(
    "RESEARCH_ERROR " +
      (error instanceof Error ? error.message : String(error)).slice(0, 1000)
  );
  let cause=(error as any)?.cause;
  for(let depth=0;cause && depth<3;depth++,cause=cause.cause)console.error("RESEARCH_CAUSE "+String(cause.message||cause).replace(/https?:\/\/[^\s]+/g,"[url]").slice(0,3000));
  process.exitCode = 1;
} finally {
  await db.end();
  process.exit(process.exitCode || 0);
}
