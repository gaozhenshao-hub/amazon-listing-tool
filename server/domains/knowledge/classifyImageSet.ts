import sharp from "sharp";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { requireDb } from "../../repositories/dbClient";
import { hasCompleteSetTags, type SetTags } from "../../../shared/imageSetTags";
import { IMAGE_TAGGING_OPTIONS } from "../../../shared/imageTagging";
import { IMAGE_TAGGING_GUIDANCE } from "../../../shared/imageTaggingGuidance";
import { taggingImprovements } from "./tagImprovements";
import { taggingUnitPreview } from "./taggingUnitPreview";

type Image = SetTags & {id:number;imageUrl:string;imagePosition:string;asin:string;productTitle:string|null;sourceLayout:unknown};
type Attachment = {type:"text";text:string}|{type:"image_url";image_url:{url:string}};
const choice = (values:readonly string[]) => z.string().refine(value=>values.includes(value));
export const ImageSetTagsCandidateSchema = z.object({setStyle:choice(IMAGE_TAGGING_OPTIONS.styles),setCategory:choice(IMAGE_TAGGING_OPTIONS.categories),
  setPrimaryColor:choice(IMAGE_TAGGING_OPTIONS.colors),setAccentColor:z.string().refine(value=>value===""||(IMAGE_TAGGING_OPTIONS.colors as readonly string[]).includes(value)),evidence:z.string().min(1).max(1500)}).strict();
const keys = ["setStyle","setCategory","setPrimaryColor","setAccentColor"] as const;
const identity = (images:Image[]) => JSON.stringify(images.map(image=>[image.id,image.imageUrl,image.sourceLayout]));

/** Look at the complete set, not a vote over independently classified images. */
export async function classifyImageSet(scope:{workspaceId:number;userId:number;imageSetId:number}, images:Image[], options:{
  signal:AbortSignal;force?:boolean;readImages:()=>Promise<Image[]>;run:(context:string,attachments:Attachment[])=>Promise<{content:string}>;
}) {
  if (!images.length || (!options.force && hasCompleteSetTags(images[0]))) return;
  if (images.length > 300) throw new Error("这套图片超过自动分析范围，请分批整理后重试");
  const attachments = await imageSetEvidence(images, options.signal);
  options.signal.throwIfAborted();
  if (identity(await options.readImages()) !== identity(images)) throw new Error("图片集已变化，请重新打标签");
  const context=`任务模式：ASIN整套标签。ASIN=${images[0].asin}，标题=${JSON.stringify(images[0].productTitle)}。综合全部${images.length}张原图，判断统一的风格、类目、主色、提亮色。不是逐图标签，不是统计旧标签，也不按联系表判断构图。主图常为白底，不要仅凭白底主图忽略其余副图和A+整体视觉；主色是整套设计的主导背景/基调，提亮色是反复用于强调的点缀色。所有图片将继承这四项。只返回{setStyle,setCategory,setPrimaryColor,setAccentColor,evidence}，无明显提亮色用空字符串。选项：${JSON.stringify(IMAGE_TAGGING_OPTIONS)}\n${IMAGE_TAGGING_GUIDANCE}` + await taggingImprovements(scope, "set");
  let candidate:z.infer<typeof ImageSetTagsCandidateSchema>|undefined;
  for(let attempt=0;attempt<2;attempt++) {
    options.signal.throwIfAborted();
    if (identity(await options.readImages()) !== identity(images)) throw new Error("图片集已变化，请重新打标签");
    // Retry a received but malformed answer once, never a network/unknown outcome.
    const response=await options.run(context+(attempt ? "\n上一次没有返回有效标签JSON。直接给出最终JSON对象，不要分析过程，不要解释提示词。必须恰好包含setStyle、setCategory、setPrimaryColor、setAccentColor、evidence五个字段。" : ""),attachments);
    options.signal.throwIfAborted();
    try {candidate=ImageSetTagsCandidateSchema.parse(JSON.parse(response.content.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"")));break;}
    catch {if(attempt===1) throw new Error("模型两次未返回有效整套标签，已保留图片，可稍后重试打标签");}
  }
  if (!candidate) throw new Error("整套标签未完成");
  const fresh=await options.readImages();
  if (identity(fresh)!==identity(images)) throw new Error("图片集已变化，本次标签未覆盖新内容");
  if (options.force && keys.some(key=>fresh[0]?.[key]!==images[0]?.[key])) throw new Error("整套标签已被修改，本次未覆盖人工编辑");
  if (!options.force && hasCompleteSetTags(fresh[0])) return; // Human completed it while the model was working.
  const patch=keys.filter(key=>options.force || fresh[0]?.[key]==null || (key!=="setAccentColor" && fresh[0]?.[key]===""));
  const db=await requireDb("save ASIN set tags");
  const [receipt]=await db.execute(sql`UPDATE kb_image_sets SET ${sql.join(patch.map(key=>sql`${sql.raw(key)}=${candidate[key]}`),sql`, `)}
    WHERE id=${scope.imageSetId} AND workspaceId=${scope.workspaceId} AND userId=${scope.userId} AND status='confirmed' AND recycleId IS NULL
    AND (SELECT COUNT(*) FROM kb_images currentImages WHERE currentImages.recycleId IS NULL AND currentImages.imageSetId=kb_image_sets.id)=${images.length}
    AND NOT EXISTS (SELECT 1 FROM kb_images currentImages WHERE currentImages.recycleId IS NULL AND currentImages.imageSetId=kb_image_sets.id AND NOT (${sql.join(images.map(image=>sql`(currentImages.id=${image.id} AND BINARY currentImages.imageUrl=BINARY ${image.imageUrl})`),sql` OR `)}))
    AND sourceLayout <=> CAST(${images[0].sourceLayout ? JSON.stringify(images[0].sourceLayout):null} AS JSON)
    AND ${sql.join(keys.map(key=>sql`${sql.raw(key)} <=> ${fresh[0]?.[key]??null}`),sql` AND `)}`);
  if ((receipt as unknown as {affectedRows:number}).affectedRows!==1) throw new Error("整套标签已被修改，请刷新后查看");
}

export async function imageSetEvidence(images: {id:number;imageUrl:string;imagePosition:string}[], signal:AbortSignal) {
  if (!images.length || images.length>300) throw new Error("请先采集完整套图后再调整标签");
  const attachments: Attachment[] = [];
  // Every source image is included, in bounded contact sheets; no persistent duplicate objects.
  for (let offset=0;offset<images.length;offset+=20) {
    signal.throwIfAborted();
    const batch=images.slice(offset,offset+20), tiles:Buffer[]=[];
    for (const image of batch) {
      const preview=await taggingUnitPreview({primary:image,images:[image],complete:true});
      tiles.push(await sharp(preview).resize({width:480,height:480,fit:"contain",background:"white"}).jpeg({quality:82}).toBuffer());
    }
    const contact=await sharp({create:{width:1920,height:Math.ceil(batch.length/4)*480,channels:3,background:"white"}})
      .composite(tiles.map((input,index)=>({input,left:(index%4)*480,top:Math.floor(index/4)*480}))).jpeg({quality:84}).toBuffer();
    attachments.push({type:"text",text:`整套图第${offset+1}至${offset+batch.length}张（左到右、上到下）：${batch.map(i=>`${i.imagePosition}`).join("、")}。白色格边只是预览底板，不属于原图。`},
      {type:"image_url",image_url:{url:`data:image/jpeg;base64,${contact.toString("base64")}`}});
  }
  return attachments;
}
