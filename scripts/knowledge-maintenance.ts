/** Explicit administrator maintenance for the shared image library. No public RPC. */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { sql } from "drizzle-orm";
import { requireDb, closeDbConnection } from "../server/repositories/dbClient";
import { parseStorageUri, storagePut } from "../server/storage";
import { verifiedLocalObjectPath } from "../server/infrastructure/localObjectStorage";
import { assistantConfigurationService, skillManifestHash } from "../server/domains/ai_os/services/assistantConfigurations";
import { captureSkillVersionSnapshot } from "../server/domains/ai_os/services/skillQualityGates";
import { getEmperorSkillRuntimeSnapshot, runEmperorSkill } from "../server/services/emperorSkillRunner";
import { IMAGE_TAGGING_OPTIONS, IMAGE_TAGGING_TAG_FIELDS, ImageTaggingCandidateSchema } from "../shared/imageTagging";
import { IMAGE_TAGGING_GUIDANCE } from "../shared/imageTaggingGuidance";
import { parseTaggingBatch } from "../server/domains/knowledge/taggingBatch";
import { backfillKnowledgeLayouts } from "../server/domains/knowledge/layoutBackfill";
import type { KbImage } from "../drizzle/schema/image";

const actor = Number(process.env.KNOWLEDGE_MAINTENANCE_ACTOR), workspace = Number(process.env.KNOWLEDGE_MAINTENANCE_WORKSPACE);
if (!Number.isSafeInteger(actor) || actor < 1 || !Number.isSafeInteger(workspace) || workspace < 1) throw new Error("Explicit administrator scope required");
const mode = process.argv[2], limit = Number(process.argv[3] || 4);
if (!["configure", "tag", "thumbnails", "layouts"].includes(mode) || !Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw new Error("Invalid maintenance request");
const db = await requireDb("Knowledge maintenance");
async function rows(query: ReturnType<typeof sql>) { const result = await db.execute(query); return result[0] as unknown as Array<Record<string, any>>; }
const [user] = await rows(sql`SELECT id,role FROM users WHERE id=${actor}`);
if (!user || !["admin", "super_admin"].includes(user.role)) throw new Error("Administrator required");
const root = path.join(process.env.LOCAL_STORAGE_DIR || "data/objects", "maintenance", `knowledge-${workspace}`);
await mkdir(root, {recursive:true, mode:0o700});
async function save(name: string, value: unknown) {
  const destination = path.join(root, name);
  const temporary = destination + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(value), {mode:0o600});
  await rename(temporary, destination);
}
const slug = "knowledge.images.tag", modelSlug = "design-gem-3-8-flash";
const scope = sql`s.workspaceId=${workspace} AND s.status='confirmed' AND s.visibility<>'private' AND (s.origin_instance_id IS NULL OR s.origin_instance_id='unified_amazon_acquisition')`;
async function readImage(reference: string) {
  const stored = parseStorageUri(reference);
  if (!stored || stored.provider !== "local") throw new Error("Only verified local library objects are supported");
  const bytes = await readFile(await verifiedLocalObjectPath(stored.key));
  if (bytes.length > 20 * 1024 * 1024) throw new Error("Image too large");
  return bytes;
}
try {
  if (mode === "configure") {
    await import("./configure-knowledge-labels");
  } else if (mode === "thumbnails") {
    const images = await rows(sql`SELECT i.id,i.imageUrl FROM kb_images i JOIN kb_image_sets s ON s.id=i.imageSetId WHERE ${scope} AND i.thumbnailUrl IS NULL ORDER BY i.id LIMIT ${limit}`);
    let completed=0,failed=0;
    for (const image of images) try {
      const bytes=await readImage(image.imageUrl), hash=createHash("sha256").update(bytes).digest("hex");
      const thumb=await sharp(bytes,{limitInputPixels:40_000_000}).rotate().resize({width:480,height:480,fit:"inside",withoutEnlargement:true}).webp({quality:72}).toBuffer();
      const stored=await storagePut(`knowledge-previews/${workspace}/${hash}.webp`,thumb,"image/webp");
      await db.execute(sql`UPDATE kb_images i JOIN kb_image_sets s ON s.id=i.imageSetId SET i.thumbnailUrl=${stored.storageUri} WHERE ${scope} AND i.id=${image.id} AND i.imageUrl=${image.imageUrl} AND i.thumbnailUrl IS NULL`);
      completed++;
    } catch { failed++; }
    console.log(JSON.stringify({status:"thumbnails-complete",completed,failed}));
  } else if (mode === "layouts") {
    const setId = process.env.KNOWLEDGE_LAYOUT_SET_ID === undefined ? undefined : Number(process.env.KNOWLEDGE_LAYOUT_SET_ID);
    await backfillKnowledgeLayouts({db,workspace,limit,setId,readImage,save,readSaved:async name=>JSON.parse(await readFile(path.join(root,name),'utf8'))});
  } else {
    const configuration=await assistantConfigurationService.get(workspace,"tagger");
    if(configuration.status!=="configured" || !configuration.record.config.enabled) throw new Error("Tagger is not configured");
    const config=configuration.record.config, snapshot=await getEmperorSkillRuntimeSnapshot(slug,workspace);
    if(config.modelSlug!==modelSlug || !config.skills.some(binding=>binding.slug===slug && binding.enabled && String(binding.version)===String(snapshot.version))) throw new Error("Tagger binding changed");
    const images=await rows(sql`SELECT i.*,s.asin,s.productTitle FROM kb_images i JOIN kb_image_sets s ON s.id=i.imageSetId WHERE ${scope} AND i.imagePosition<>'brand_story' AND i.tagsConfirmed=0 AND i.analysisConfirmed=0 ORDER BY i.id LIMIT ${limit}`);
    let completed=0,failed=0,skipped=0,recovered=0;
    const covered=new Set<number>();
    async function apply(image: typeof images[number], candidate: ReturnType<typeof parseTaggingBatch> extends Map<number,infer T> ? T : never, runId: string) {
      const values: Record<string,string> = {...candidate, tagImageBelong: image.imagePosition==='main'?'主图':image.imagePosition==='aplus'?'A+':'套图'};
      const storedFields = [...IMAGE_TAGGING_TAG_FIELDS,'tagImageBelong'] as const satisfies readonly (keyof KbImage)[];
      const fields=storedFields.filter(key=>!image[key]&&values[key]);
      const guard=sql.join(storedFields.map(key=>sql`${sql.raw(`i.${key}`)} <=> ${image[key]??null}`),sql` AND `);
      await save(`tag-v2-${image.id}.json`,{state:"candidate",before:image,candidate,runId,actor,workspace});
      if(fields.length){
        const assignments=fields.map(key=>sql`${sql.raw(`i.${key}`)}=${values[key]}`);
        const receipt=await db.execute(sql`UPDATE kb_images i JOIN kb_image_sets s ON s.id=i.imageSetId SET ${sql.join(assignments,sql`, `)} WHERE ${scope} AND i.id=${image.id} AND i.imageUrl=${image.imageUrl} AND i.imagePosition<>'brand_story' AND i.tagsConfirmed=0 AND i.analysisConfirmed=0 AND ${guard}`);
        if((receipt[0] as unknown as {affectedRows:number}).affectedRows!==1){skipped++;return;}
        for(const key of fields)image[key]=values[key];
      }
      await save(`tag-v2-${image.id}.json`,{state:"completed",candidate,runId,actor,workspace});covered.add(image.id);completed++;
    }
    // Recover valid saved answers before issuing another paid model request.
    const runs=await rows(sql`SELECT runId,input,output FROM emperor_skill_runs WHERE workspaceId=${workspace} AND userId=${actor} AND skillSlug=${slug} AND status='succeeded' AND migrationSource IN ('knowledge.authorized_missing_tags','knowledge.authorized_missing_tags_v2') ORDER BY id DESC`);
    for(const run of runs)try{
      const input=typeof run.input==='string'?JSON.parse(run.input):run.input;
      const expected=String(input.context||'').match(/编号必须为：([0-9,]+)/)?.[1].split(',').map(Number)||[];
      const output=typeof run.output==='string'?JSON.parse(run.output):run.output;
      for(const [id,candidate] of parseTaggingBatch(output.content,expected)){
        const image=images.find(i=>i.id===id);if(!image||covered.has(id))continue;
        // An old run is reusable only for the same stored original recorded at dispatch.
        let marker;
        try{marker=JSON.parse(await readFile(path.join(root,`tag-${id}.json`),'utf8'));}catch{continue;}
        if(marker.before?.imageUrl!==image.imageUrl)continue;
        await apply(image,candidate,run.runId);recovered++;
      }
    }catch{/* Invalid historical output remains available for audit. */}
    console.log(JSON.stringify({status:'recovered',completed,recovered,total:images.length}));
    async function dispatch(batch:typeof images){
      const attachments:Array<{type:'text';text:string}|{type:'image_url';image_url:{url:string}}>=[],eligible:typeof images=[];
      for(const image of batch)try{
        const bytes=await readImage(image.imageUrl);
        const prepared=await sharp(bytes,{limitInputPixels:40_000_000}).rotate().resize({width:1400,height:1400,fit:'inside',withoutEnlargement:true}).jpeg({quality:88}).toBuffer();
        attachments.push({type:'text',text:`图片编号 imageId=${image.id}；ASIN=${image.asin}；位置=${image.imagePosition}；产品名：${image.productTitle||''}`},{type:'image_url',image_url:{url:`data:image/jpeg;base64,${prepared.toString('base64')}`}});eligible.push(image);
        await save(`tag-${image.id}.json`,{state:'dispatched',before:image,actor,workspace});
      }catch{failed++;}
      if(!eligible.length)return;
      try{
        const result=await runEmperorSkill({skillSlug:slug,userId:actor,workspaceId:workspace,modelOverride:config.modelSlug,maxModelAttempts:1,fallbackModels:[],expectedSkillVersion:snapshot.version,expectedSkillManifestHash:snapshot.manifestHash,expectedSkillStatus:'Released',skillVersionPolicy:'snapshot',variables:{taggingRules:config.rules.join('\n')},context:`请逐张标注图片，返回 items 数组。编号必须为：${eligible.map(i=>i.id).join(',')}。每个字段只填写一个已有选项，不能把多个颜色或多个卖点塞进同一字段；主色只选最主要的一种。没有可见卖点可留空。${config.instructions}`,attachments,migrationSource:'knowledge.authorized_missing_tags_v2'});
        await save(`tag-batch-${result.runId}.json`,{images:eligible.map(i=>i.id),content:result.content});
        const candidates=parseTaggingBatch(result.content,eligible.map(i=>i.id));
        for(const image of eligible){const candidate=candidates.get(image.id);if(candidate)await apply(image,candidate,result.runId);}
      }catch(error){console.log(JSON.stringify({state:'batch-unresolved',images:eligible.map(i=>i.id),error:error instanceof Error?error.name:'error'}));}
    }
    for (const image of images) {
      if (!covered.has(image.id) && ["tagCategory", "tagImageTypeMain", "tagComposition", "tagDesignStyleV2", "tagColorSchemeV2"].every(key => Boolean(image[key]))) { covered.add(image.id); skipped++; }
    }
    const pending=images.filter(image=>!covered.has(image.id));
    for(let offset=0;offset<pending.length;offset+=4){
      const batch=pending.slice(offset,offset+4);await dispatch(batch);
      console.log(JSON.stringify({progress:Math.min(offset+4,pending.length),total:pending.length,completed,recovered,skipped}));
    }
    // Explicitly requested completion pass: retry unresolved items singly, never overwrite confirmed work.
    for(const image of pending.filter(image=>!covered.has(image.id))){await dispatch([image]);}
    const unresolved=images.filter(image=>!covered.has(image.id)).map(image=>({id:image.id,asin:image.asin}));
    await save('tag-v2-report.json',{completed,recovered,skipped,unresolved});
    console.log(JSON.stringify({status:'tagging-complete',completed,recovered,skipped,unresolved}));
  }
} finally {await closeDbConnection();}
