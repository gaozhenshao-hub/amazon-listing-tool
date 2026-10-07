import { createHash } from "node:crypto";
import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import mysql from "mysql2/promise";
import {
  buildShadowBulletInput, extractShadowFacts, parseOldShadowBullets,
  redactShadowText, selectShadowFacts, shadowSourceHash, SHADOW_SENSITIVE_VALUE, type ShadowFact,
} from "../server/domains/listing/services/listingShadowEvaluation";

type HistoricalRow = {
  projectId: number; workspaceId: number | null; listingId: number; userId: number;
  bulletPoints: string; rawContent: string; fileId: number;
  fileWorkspaceId: number | null; fileUserId: number;
};
type PlannedItem = { row: HistoricalRow; index: number; oldBullet: string; facts: ShadowFact[]; sourceHash: string };
type ResultRecord = {
  batchId: string; projectId: number; workspaceId: number | null; listingId: number;
  index: number; sourceHash: string; status: "passed" | "quality_failed" | "model_failed" | "source_changed";
  oldBullet: string; sourceFacts: ShadowFact[]; candidate: unknown; issues: string[];
  skillRunIds: string[]; skillVersion?: string; modelSlug?: string; costCents: number; elapsedMs: number;
  reviewStatus: "pending_human_review"; comparisonBasis: "original_upload_and_old_bullet_theme_only";
};

const MAX_PROJECTS = 13;
const MAX_BULLETS_PER_PROJECT = 5;
const MAX_QUALITY_RETRIES = 1;
const OUTPUT_DIR = process.env.SHADOW_OUTPUT_DIR || "";
const SKILL_SLUG = "listing.bullet.step.generate";
const REPLAY_SCHEMA = "listing.shadow_v6/1";
const APPROVAL_CONTEXT = "user_approved_shadow_option_a_2026-10-07";

function parseArgs() {
  const apply = process.argv.includes("--apply");
  const prepare = process.argv.includes("--prepare");
  if (apply && prepare) throw new Error("预备和执行模式不可同时使用");
  if (!isAbsolute(OUTPUT_DIR) || !OUTPUT_DIR.endsWith("/.shadow-evaluations")) {
    throw new Error("缺少受控影子批次目录，拒绝执行");
  }
  const batchId = process.argv.find((arg) => arg.startsWith("--batch-id="))?.slice(11) || "";
  const expectedHash = process.argv.find((arg) => arg.startsWith("--expected-hash="))?.slice(16) || "";
  if (!/^listing_shadow_v6_[0-9]{8}T[0-9]{6}Z$/.test(batchId)) {
    throw new Error("批次标识格式无效，拒绝读取历史内容");
  }
  if (apply && !/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error("缺少已预备清单SHA，拒绝执行");
  return { apply, prepare, batchId, expectedHash };
}

async function loadPlans(connection: mysql.Connection) {
  const [listings] = await connection.execute(
    `SELECT p.id AS projectId,p.workspaceId,p.userId,l.id AS listingId,l.bulletPoints
     FROM projects p JOIN listings l ON l.projectId=p.id AND l.isActive=1
     WHERE l.bulletPoints IS NOT NULL ORDER BY p.id,l.id`,
  );
  const [files] = await connection.execute(
    `SELECT f.id AS fileId,f.projectId,f.workspaceId AS fileWorkspaceId,f.userId AS fileUserId,f.rawContent FROM projectFiles f
     WHERE f.fileType='product_attributes' AND f.status='completed' AND f.rawContent IS NOT NULL
     ORDER BY f.projectId,f.updatedAt DESC,f.id DESC`,
  );
  const latestFiles = new Map<number, { fileId: number; rawContent: string; fileWorkspaceId: number | null; fileUserId: number }>();
  for (const file of files as Array<{ projectId: number; fileId: number; rawContent: string; fileWorkspaceId: number | null; fileUserId: number }>) {
    if (!latestFiles.has(file.projectId)) latestFiles.set(file.projectId, file);
  }
  const projects = new Map<number, HistoricalRow>();
  for (const listing of listings as Array<Omit<HistoricalRow, "rawContent" | "fileId" | "fileWorkspaceId" | "fileUserId">>) {
    const file = latestFiles.get(listing.projectId);
    if (file && parseOldShadowBullets(listing.bulletPoints).length) {
      if (projects.has(listing.projectId)) throw new Error("同一项目存在多个活跃历史Listing，拒绝静默挑选");
      projects.set(listing.projectId, { ...listing, ...file });
    }
  }
  if (projects.size !== MAX_PROJECTS) throw new Error(`候选项目数量${projects.size}不等于预检时的${MAX_PROJECTS}，拒绝启动`);
  const spaces = new Set([...projects.values()].map((row) => String(row.workspaceId ?? "legacy")));
  if (spaces.size !== 1) throw new Error("历史数据跨工作空间，拒绝混合批量运行");
  if ([...projects.values()].some((row) => !row.workspaceId
    || (row.fileWorkspaceId !== null && row.fileWorkspaceId !== row.workspaceId))) {
    throw new Error("项目或上传文件的工作空间未匹配");
  }
  const plans: PlannedItem[] = [];
  let skippedNoFacts = 0;
  for (const row of projects.values()) {
    const facts = extractShadowFacts(row.rawContent);
    const bullets = parseOldShadowBullets(row.bulletPoints);
    for (let index = 0; index < Math.min(MAX_BULLETS_PER_PROJECT, bullets.length); index += 1) {
      const selected = selectShadowFacts(facts, index);
      if (!selected.length) { skippedNoFacts++; continue; }
      plans.push({ row, index, oldBullet: bullets[index], facts: selected,
        sourceHash: shadowSourceHash(row.rawContent, bullets[index]) });
    }
  }
  return { plans, projectCount: projects.size, skippedNoFacts };
}

function safeOldTheme(value: string) {
  return SHADOW_SENSITIVE_VALUE.test(value)
    ? "[旧卖点含受限内容，主题已省略；仅使用原始产品属性行]"
    : redactShadowText(value).slice(0, 440);
}

function promptForItem(item: PlannedItem, previousOutput?: unknown, issues: string[] = []) {
  const point = buildShadowBulletInput(item.index, item.facts);
  const feedback = issues.length ? `\n上次确定性检查未通过：${issues.join("；")}。请完整重写同一条 JSON 候选。` : "";
  return `--- v6 历史 Listing 影子评估（只读、不能同步正式内容） ---
这是一条旧卖点的独立重写候选。旧文案仅作主题参照，可能含未经证实的主张；绝不可把旧文案、竞品信息、分析报告或模型推论当作产品事实。
旧文案主题参考（非证据）：${safeOldTheme(item.oldBullet)}
唯一准许引用的事实来自用户原始上传的本品属性表，原文行号和引文：
${item.facts.map((fact) => `L${fact.line} ${fact.quote}`).join("\n")}
当前选择的卖点核心：${JSON.stringify(point)}
仅针对当前一条生成自然美式英语的 subtitle + fullText；FABE只是内部思考。不可杜撰任何材料、认证、保修、规格、场景、比较或关键词；证据不足宁可不写相关主张。evidenceUsed逐字引用以上短事实，keywordsUsed只能为空数组。
仅返回单个 {subtitle,fullText,evidenceUsed,keywordsUsed,distinctFromPrevious,qualityAudit} JSON对象；不要输出其他条目或说明。${feedback}
${previousOutput ? `上次未通过候选（不构成事实）：${JSON.stringify(previousOutput).slice(0, 1200)}` : ""}`;
}

async function verifySource(connection: mysql.Connection, item: PlannedItem, adminId: number): Promise<boolean> {
  const [rows] = await connection.execute(
    `SELECT l.bulletPoints,f.rawContent,p.workspaceId AS projectWorkspaceId,p.userId AS projectOwnerId,
       f.workspaceId AS fileWorkspaceId,f.userId AS fileUploaderId
     FROM listings l JOIN projects p ON p.id=l.projectId
     JOIN projectFiles f ON f.projectId=p.id
     JOIN workspaces w ON w.id=p.workspaceId AND w.status='active'
     JOIN users admin ON admin.id=? AND admin.role='super_admin' AND admin.status='active'
       AND admin.defaultWorkspaceId=p.workspaceId
     JOIN users owner ON owner.id=p.userId AND owner.status='active'
     JOIN users uploader ON uploader.id=f.userId AND uploader.status='active'
     WHERE l.id=? AND l.isActive=1 AND f.id=? AND f.status='completed'
       AND f.id=(SELECT latest.id FROM projectFiles latest WHERE latest.projectId=f.projectId
         AND latest.fileType='product_attributes' AND latest.status='completed'
         ORDER BY latest.updatedAt DESC,latest.id DESC LIMIT 1)
       AND (f.workspaceId=p.workspaceId OR f.workspaceId IS NULL)
       AND EXISTS (SELECT 1 FROM workspace_memberships m WHERE m.userId=admin.id AND m.workspaceId=p.workspaceId AND m.status='active')
       AND EXISTS (SELECT 1 FROM workspace_memberships m WHERE m.userId=p.userId AND m.workspaceId=p.workspaceId AND m.status='active')
       AND EXISTS (SELECT 1 FROM workspace_memberships m WHERE m.userId=f.userId AND m.workspaceId=p.workspaceId AND m.status='active')
     LIMIT 1`,
    [adminId,item.row.listingId, item.row.fileId],
  );
  const row = (rows as Array<{bulletPoints: string; rawContent: string;projectWorkspaceId:number;
    projectOwnerId:number;fileWorkspaceId:number|null;fileUploaderId:number}>)[0];
  if (!row) return false;
  if (row.projectWorkspaceId!==item.row.workspaceId || row.projectOwnerId!==item.row.userId
    || row.fileWorkspaceId!==item.row.fileWorkspaceId || row.fileUploaderId!==item.row.fileUserId) return false;
  return shadowSourceHash(row.rawContent, parseOldShadowBullets(row.bulletPoints)[item.index] || "") === item.sourceHash;
}

function safeError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  // Do not write provider payloads, credentials, URLs, ASINs or raw user data into the review file.
  return /(?:MODEL|PROVIDER|TIMEOUT|INVALID_OUTPUT|PROMPT|BUDGET|CONNECTION|CANCELED)/i.test(text)
    ? "受治理模型调用失败或返回格式异常"
    : "模型执行失败（错误详情仅在受控Skill Run审计中查看）";
}

function planManifest(plans: PlannedItem[], adminId: number) {
  const projects = [...new Map(plans.map(({ row }) => [row.projectId, row])).values()]
    .map((row) => ({ projectId:row.projectId,listingId:row.listingId,fileId:row.fileId,
      workspaceId:row.workspaceId,ownerUserId:row.userId,uploaderUserId:row.fileUserId,
      rawContentHash:createHash("sha256").update(row.rawContent).digest("hex"),
      oldBulletsHash:createHash("sha256").update(row.bulletPoints).digest("hex") }))
    .sort((a,b)=>a.projectId-b.projectId);
  const items = plans.map((item)=>({projectId:item.row.projectId,listingId:item.row.listingId,
    index:item.index,sourceHash:item.sourceHash}));
  const manifest = {schema:REPLAY_SCHEMA,approvalContext:APPROVAL_CONTEXT,adminId,
    skillSlug:SKILL_SLUG,expectedSkillVersion:6,projects,items};
  const hash=createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
  return {manifest,hash};
}

function writeDurableLine(path: string, value: unknown) {
  const fd=openSync(path,"a",0o600);
  try{appendFileSync(fd,`${JSON.stringify(value)}\n`);fsyncSync(fd)}finally{closeSync(fd)}
}

async function runOne(item: PlannedItem, batchId: string, userId: number, connection: mysql.Connection): Promise<ResultRecord> {
  const start = Date.now();
  const output: ResultRecord = { batchId,projectId:item.row.projectId,workspaceId:item.row.workspaceId,
    listingId:item.row.listingId,index:item.index,sourceHash:item.sourceHash,status:"model_failed",
    oldBullet:"[原文仅在既有Listing中查看，影子结果不复制原文]",sourceFacts:item.facts,candidate:null,issues:[],skillRunIds:[],costCents:0,
    elapsedMs:0,reviewStatus:"pending_human_review",comparisonBasis:"original_upload_and_old_bullet_theme_only" };
  if (!await verifySource(connection, item, userId)) {
    output.status = "source_changed"; output.issues = ["原始上传或旧版Listing在排队期间已变化，拒绝调用模型"];
    output.elapsedMs = Date.now() - start; return output;
  }
  const { runEmperorSkill } = await import("../server/domains/ai_os/services/skillRunner");
  const { validateSingleBulletQuality } = await import("../server/domains/listing/services/generationJob");
  const point = buildShadowBulletInput(item.index, item.facts);
  let previousOutput: unknown;
  let lastIssues: string[] = [];
  for (let attempt = 0; attempt <= MAX_QUALITY_RETRIES; attempt++) {
    if (attempt && !await verifySource(connection, item, userId)) {
      output.status="source_changed"; output.issues=["复验前数据已变化，停止后续模型调用"];break;
    }
    const context = promptForItem(item, previousOutput, lastIssues);
    try {
      const result = await runEmperorSkill<unknown>({
        skillSlug:SKILL_SLUG,userId,workspaceId:item.row.workspaceId,
        context,variables:{context,mode:"single_bullet_shadow",sellingPoint:point,previousBullets:[],
          __shadowEvaluationBatchId:batchId,__sourceHash:item.sourceHash,
        __approvalContext:APPROVAL_CONTEXT,__requiresHumanReview:true},
        executionPreset:"quality_first",expectedSkillVersion:6,skillVersionPolicy:"pinned",
        maxModelAttempts:2,validate:(content) => {
          const cleaned=content.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"");
          if(SHADOW_SENSITIVE_VALUE.test(cleaned))throw Error("敏感或禁止内容，输出不持久化");
          return JSON.parse(cleaned) as unknown;
        },
      });
      output.skillRunIds.push(result.runId);output.costCents+=result.costCents;
      output.skillVersion=result.skillVersion;output.modelSlug=result.modelSlug;previousOutput=result.parsed;
      const checked=validateSingleBulletQuality(result.parsed,
        {projectId:item.row.projectId,operation:"singleBullet",nodeId:"G1",scopeKey:"shadow",sellingPoint:point,previousBullets:[]});
      // Deterministic validator is a necessary but not sufficient style/factuality check.
      const citations=Array.isArray((result.parsed as {evidenceUsed?: unknown})?.evidenceUsed)
        ? (result.parsed as {evidenceUsed: unknown[]}).evidenceUsed : [];
      const quoteSource=new Set(item.facts.map((fact)=>fact.quote.trim().toLowerCase()));
      const provenanceOk=citations.length>0 && citations.every((quote)=>typeof quote==="string"
        && quote.trim().length>0 && quoteSource.has(quote.trim().toLowerCase()));
      const written=`${(result.parsed as {subtitle?:unknown})?.subtitle||""} ${(result.parsed as {fullText?:unknown})?.fullText||""}`;
      if (SHADOW_SENSITIVE_VALUE.test(JSON.stringify(result.parsed))) {
        output.candidate=null;output.status="quality_failed";
        output.issues=["候选包含不允许的商品标识、链接、价格或敏感字段；内容已丢弃"];
        break;
      }
      if (!await verifySource(connection,item,userId)) {
        output.candidate=null;output.status="source_changed";
        output.issues=["模型返回时原始数据已变化，候选已丢弃"];
        break;
      }
      output.candidate=result.parsed;
      lastIssues=[...checked.issues,...(!provenanceOk?["证据没有逐字对应用户原始属性表选中行"]:[]),
        ...(/\bB0[A-Z0-9]{8}\b|https?:\/\//iu.test(written)?["候选包含产品标识或外部链接"]:[])];
      output.status=lastIssues.length?"quality_failed":"passed";
      output.issues=lastIssues;
      if(!lastIssues.length)break;
    }catch(error){output.status="model_failed";output.issues=[safeError(error)];break;}
  }
  output.elapsedMs=Date.now()-start;return output;
}

async function main(){
  const {apply,prepare,batchId,expectedHash}=parseArgs();
  if(!process.env.DATABASE_URL)throw Error("数据库配置缺失");
  const db=await mysql.createConnection({uri:process.env.DATABASE_URL,multipleStatements:false});
  let lockPath="";
  let lockAcquired=false;
  let dbLockAcquired=false;
  try{
    if(apply){
      const [[lease]]=await db.execute("SELECT GET_LOCK(?,0) AS acquired",[`listing_shadow_v6:${batchId}`]) as [{acquired:number}[],unknown];
      if(Number(lease?.acquired)!==1)throw Error("此批次已在另一进程执行，拒绝重复调用模型");
      dbLockAcquired=true;
      mkdirSync(OUTPUT_DIR,{recursive:true,mode:0o700});
      const access=statSync(OUTPUT_DIR);
      if(realpathSync(OUTPUT_DIR)!==OUTPUT_DIR||access.uid!==process.getuid()||(access.mode&0o077)!==0){
        throw Error("批次私有目录所有者或权限不安全");
      }
      lockPath=join(OUTPUT_DIR,`${batchId}.lock`);
      const fd=openSync(lockPath,"wx",0o600);closeSync(fd);
      lockAcquired=true;
    }
    const {plans,projectCount,skippedNoFacts}=await loadPlans(db);
    const [admins]=await db.execute("SELECT id,role,status,defaultWorkspaceId FROM users WHERE name=? AND role='super_admin' AND status='active'",["gaozhen shao"]);
    const admin=(admins as Array<{id:number;defaultWorkspaceId:number|null}>)[0];
    if((admins as unknown[]).length!==1)throw Error("管理员身份未能唯一匹配，停止批次");
    const space=plans[0]?.row.workspaceId??null;
    if(!space||admin.defaultWorkspaceId!==space)throw Error("管理员默认工作空间与评估范围不一致");
    const [members]=await db.execute("SELECT userId FROM workspace_memberships WHERE workspaceId=? AND status='active'",[space]);
    const memberIds=new Set((members as Array<{userId:number}>).map((member)=>member.userId));
    if(!memberIds.has(admin.id)||plans.some(({row})=>row.workspaceId!==space
      ||(row.fileWorkspaceId!==null&&row.fileWorkspaceId!==space)
      ||!memberIds.has(row.userId)||!memberIds.has(row.fileUserId))){
      throw Error("评估项目所有者、属性上传者或管理员不是同一工作空间活跃成员");
    }
    const {manifest,hash}=planManifest(plans,admin.id);
    const manifestPath=join(OUTPUT_DIR,`${batchId}.manifest.json`);
    const preview={schema:REPLAY_SCHEMA,mode:apply?"apply":prepare?"prepare":"preview",batchId,manifestHash:hash,projects:projectCount,
      plannedItems:plans.length,skippedNoFacts,maxBulletsPerProject:MAX_BULLETS_PER_PROJECT,
      maxQualityRetries:MAX_QUALITY_RETRIES,skillSlug:SKILL_SLUG,oldListingsWillBeWritten:false};
    console.log(JSON.stringify(preview));
    if(prepare){
      mkdirSync(OUTPUT_DIR,{recursive:true,mode:0o700});
      const access=statSync(OUTPUT_DIR);
      if(realpathSync(OUTPUT_DIR)!==OUTPUT_DIR||access.uid!==process.getuid()||(access.mode&0o077)!==0){
        throw Error("批次私有目录所有者或权限不安全");
      }
      writeFileSync(manifestPath,JSON.stringify(manifest),{flag:"wx",mode:0o600});
      return;
    }
    if(!apply)return;
    const approved=JSON.parse(readFileSync(manifestPath,"utf8"));
    if(hash!==expectedHash||JSON.stringify(approved)!==JSON.stringify(manifest)){
      throw Error("实际项目、上传事实或旧版内容与预备审批清单不一致，拒绝模型调用");
    }
    const resultPath=join(OUTPUT_DIR,`${batchId}.jsonl`);
    const completed=new Set<string>();const started=new Set<string>();
    try{for(const line of readFileSync(resultPath,"utf8").split("\n").filter(Boolean)){
      const row=JSON.parse(line) as ResultRecord & {event?:"started"|"finished"};
      if(row.batchId!==batchId)throw Error("已有结果所属批次不匹配");
      const key=`${row.projectId}:${row.index}:${row.sourceHash}`;
      if(row.event==="started")started.add(key);
      else if(row.event==="finished")completed.add(key);
      else throw Error("存在未知的持久化影子任务状态");
    }}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
    if([...started].some((key)=>!completed.has(key)))throw Error("发现未结算的模型任务，禁止自动重试以避免重复计费");
    let done=0,passed=0,failed=0,charged=0;
    for(const item of plans){
      const key=`${item.row.projectId}:${item.index}:${item.sourceHash}`;
      if(completed.has(key))continue;
      if(!await verifySource(db,item,admin.id))throw Error("调用前项目授权或原始文件已变化，整批停止");
      writeDurableLine(resultPath,{event:"started",batchId,projectId:item.row.projectId,index:item.index,
        sourceHash:item.sourceHash,approvalContext:APPROVAL_CONTEXT});
      const output=await runOne(item,batchId,admin.id,db);
      if(!await verifySource(db,item,admin.id)){
        output.status="source_changed";output.candidate=null;
        output.issues=["结果写入前原始数据发生变化，已丢弃候选"];
      }
      writeDurableLine(resultPath,{...output,event:"finished"});
      done++;charged+=output.costCents;if(output.status==="passed")passed++;else failed++;
      console.log(JSON.stringify({schema:REPLAY_SCHEMA,event:"item",completed:done,planned:plans.length,
        passed,failed,lastStatus:output.status,reportedCostCents:charged,elapsedSeconds:Math.round(output.elapsedMs/1000)}));
    }
    console.log(JSON.stringify({schema:REPLAY_SCHEMA,event:"completed",batchId,planned:plans.length,
      processedThisInvocation:done,passedThisInvocation:passed,failedThisInvocation:failed,
      reportedCostCentsThisInvocation:charged}));
  }finally{
    if(lockAcquired)rmSync(lockPath,{force:true});
    if(dbLockAcquired)await db.execute("SELECT RELEASE_LOCK(?)",[`listing_shadow_v6:${batchId}`]).catch(()=>null);
    await db.end();
  }
}
void main().catch(error=>{console.error(JSON.stringify({schema:REPLAY_SCHEMA,event:"failed",reason:safeError(error)}));process.exitCode=1;});
