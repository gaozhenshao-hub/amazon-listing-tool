import { questionAnswerIssues } from "./questionAnswerGrounding";
import { validateQuestionGroups, consolidateQuestionGroup } from "./questionConsolidation";
import { questionMergeSignature } from "../../../shared/questionMerging";
import { assistantConfigurationService } from "../ai_os/services/assistantConfigurations";
import { RESEARCH_CATEGORIES, researchCategories, researchCategory } from "../../../shared/researchCategories";
import { assertResearchEditable } from "./researchLocks";
import { mergeResearchProposal, preserveManualResearch, sellingExclusions } from "../../../shared/researchEditing";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  FEATURE_GROUPS,
  SELLING_GROUPS,
  aggregationConceptKey,
  listingAggregationSchema,
  type AggregationEvidence,
} from "../../../shared/listingAggregation";
import * as repository from "../../repositories";
import { safeParseSkillJSON } from "../ai_os/services/skillRunner";
import { runCompetitorSkill } from "./runCompetitorSkill";
import {
  readListingAggregation, saveListingAggregation,
} from "./aggregationStore";
import { collectAggregationSources } from "./aggregationSources";

export const AGGREGATION_SKILL = "listing.research.adjust.v2";

const entry = z.object({
  id: z.string().max(80).optional(),
  text:z.string().trim().min(1).max(500),note:z.string().max(3000),sourceIds:z.array(z.string()).min(1).max(300),
  comparisonScope: z.string().max(1000).optional(),
  badges: z.array(z.string().max(40)).max(12).optional(),
  basis: z.enum(["direct", "inferred"]).optional(),
  category:z.enum(RESEARCH_CATEGORIES),
  differentiated:z.boolean().optional(),
  availability:z.enum(["current","planned"]).optional(),
});
const resultSchema = z.object({
  features: z.array(entry.extend({ group: z.enum(FEATURE_GROUPS) })).max(200),
  selling:z.array(entry.extend({group:z.enum(SELLING_GROUPS)})).max(200),
  links: z
    .array(
      z.object({
        featureId: z.string(),
        benefitId: z.string(),
        note: z.string().max(3000),
      })
    )
    .max(1000),
  reviews:z.array(entry.extend({sentiment:z.enum(["positive","negative"])})).max(200),
  questions:z.array(entry.extend({answer:z.string().trim().min(1).max(6000),source:z.enum(["uploaded","review","listing","inferred"]),mergedQuestionIds:z.array(z.string().uuid()).max(500).optional(),
      })).max(200),
});
type Scope={projectId:number;workspaceId:number;userId:number};
const normalized = (value:string) =>
  value.trim().replace(/\s+/g, "").toLowerCase();
const sourceKey = aggregationConceptKey;
const uniqueEvidence = (items: AggregationEvidence[]) => {
  const output = [
    ...new Map(
      items.map(item => [
        JSON.stringify([
          item.analysisId,
          item.kind,
          item.hash || item.blockId || (item.bulletIndex ?? item.sourceKey),
          item.kind === "video" ? item.sourceKey : undefined,
        ]),
        item,
      ])
    ).values(),
  ];if(output.length > 1000)
    throw new Error("当前节点来源过多，请分组整理后重试");
  return output;
};
const reviewSignature = (items: any[] = []) =>
  JSON.stringify(
    items
      .map(r => [r.analysisId, r.groupIndex, r.generatedAt])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));

export async function generateListingAggregation(scope:Scope,
  options: { preview?: boolean; section?: "selling"|"reviews"|"questions"; signal?:AbortSignal; feedback?:string; preserveManual?:boolean } = {}
) {
  const section=options.section || "selling";
  const freshSelling = section === "selling" && options.preserveManual !== undefined;
  if (!freshSelling) await assertResearchEditable(scope,section);
  const project=await repository.getProjectById(scope.projectId,scope.userId,scope.workspaceId);
  if(!project||project.workspaceId!==scope.workspaceId)throw new TRPCError({code:"NOT_FOUND",message:"项目不可访问"});
  const current=await readListingAggregation(scope),
    records=await repository.getCompetitorAnalysesByProject(scope.projectId);
  const useManual = options.preserveManual !== false;
  const sellingBase = sellingExclusions(current.data, useManual);
  const modelData = useManual ? sellingBase : {
    ...sellingBase,
    features: sellingBase.features?.filter(item => !item.manual),
    selling: sellingBase.selling.filter(item => !item.manual),
  };
  const sources = collectAggregationSources(project, records, modelData);
  if(!sources.studyCount)throw new TRPCError({code:"PRECONDITION_FAILED",message:"请先完成至少一个竞品的新版分析",
    });
  const compactSources=sources.selling.map((s,index)=>({...s,id:s.id.startsWith("PRODUCT:")?s.id:"S"+index}));
  const sourceMap = new Map(compactSources.map(s => [s.id, s])),
    reviewMap = new Map(sources.reviews.map(r => [r.id, r])),
    questionIds = new Set(sources.questions.map(q => q.id));
  const configured=await assistantConfigurationService.get(scope.workspaceId,"listing");
  const assistant=configured.status==="configured"?configured.record.config:null;
  const compactFact=(n:any)=>({id:n.id,text:n.text,note:n.note,group:n.group,category:n.category,manual:n.manual,manualFields:n.manualFields,manualChangedAt:n.manualChangedAt,differentiated:n.differentiated,availability:n.availability,comparisonScope:n.comparisonScope});
  const ownFacts={features:(modelData.features || []).filter(n=>n.group!=="improve" && n.availability!=="planned").map(compactFact),benefits:modelData.selling.filter(n=>n.group!=="improve" && n.availability!=="planned").map(compactFact),notes:modelData.productNotes || "",planned:[...(modelData.features || []),...modelData.selling].filter(n=>n.group==="improve" || n.availability==="planned").map(compactFact)};
  const modelSelling=section==="questions"?compactSources.filter(s=>s.id.startsWith("PRODUCT:CONFIRMED:") || s.id==="PRODUCT:notes"):section==="reviews"?[]:compactSources;
  const allowedSelling=new Set(modelSelling.map(s=>s.id));
  const confirmedFacts=JSON.stringify({features:ownFacts.features,benefits:ownFacts.benefits,notes:ownFacts.notes,manualAnswers:current.data.questions.filter(q=>q.manual && q.answer?.trim()).map(q=>q.answer)});
  const requestData = {
    mode: "aggregate", section,
    operatorFeedback: options.feedback || "",
    sourceIdRules:{identityOnly:"existing里的UUID用于复用输出id或填写mergedQuestionIds，不是sourceIds。sourceIds必须从以下三个允许列表取值。",selling:modelSelling.map(s=>s.id),reviews:sources.reviews.map(r=>r.id),questions:sources.questions.map(q=>q.id)},
    questionUpdateInstruction:"用户明确要求按购买顾虑合并同类问题，同时综合答案，不是只翻译或保留每种问法。例如尺码偏大偏小、尺码是否合适、按身高体重如何选码合为一条；炎热天气舒适、是否通风透气合为一条；清洗保养与能否机洗合为一条。不要把所有不同顾虑粗暴合成一个大问题。每个输出组返回mergedQuestionIds，包含该组所有existing.questions的id，每个旧id必须且只能出现在一组；输出id复用组内一个旧id即可。mergedQuestionIds是问题成员，sourceIds仍只能引用允许的真实资料来源。已存在的答案也需要参与归并，保留人工已确认的事实；原问法、人工答案和说明由系统完整留档，不要因保留旧问法而重复输出。回答应综合各子问题，积极具体且不重复堆砌。source=inferred可使用本品事实来源；source=listing至少含selling允许列表id；source=uploaded至少含questions允许列表id；source=review至少含reviews允许列表id。",
    categories: researchCategories,
    currentProductFacts:ownFacts,
    assistant:assistant?{instructions:assistant.instructions,rules:assistant.rules,configurationRevision:configured.status==="configured"?configured.record.revision:0}:undefined,
    answerFactRules:"竞品资料只用于发现关注问题；回答本品只依据currentProductFacts中已确认features/benefits/notes和人工答案；人工改过text时，text是该参数最终值，note中的旧竞品或原标签不能覆盖它，不用竞品参数替本品作保证。planned不是现有能力。不要编造预缩工艺、黄铜材质、阻燃、使用年限、售后期限、固定选码余量或低价优势；有明确本品依据才写具体数字。没有明确是否附带收纳袋时不要直接回答未附带，转而列出已确认配件并提供实用收纳建议。缺少洗涤程序时给出建议性的温和护理，不能自行断言支持机洗。不宣称绝对防蜇。无需再要求属性表，也不要写资料待补充。",
    classificationGuide:"按问题或结论的主要目的归类：核心任务/防护效果/动力/流量/耐用结果归core；舒适、操作便利、视野、穿脱、噪音体验归design；拉链、缝线、接口、螺丝、手套等部件细节质量归details；选码测量、尺寸/适配表、包装配件清单、安装使用说明、清洗保养方法归information。不要因为提到面罩/手套就把清洗说明归details。必要说明做得好坏也会影响评论，仍按说明信息归information。",
    differentiationRules:"凡group为differentiated/improve、differentiated=true或availability=planned，每个节点都必须返回comparisonScope字符串，并在sourceIds中包含对应PRODUCT:CONFIRMED:或PRODUCT:PLANNED:或PRODUCT:notes真实来源id。comparisonScope写明相对哪个竞品或什么范围的比较，区分已确认改进与待实现；已有节点原有comparisonScope应原样保留。不满足真实比较依据的普通功能不要标差异化。",
    instruction:"仅整理section对应板块，其他数组返回空数组。分类category只能core/design/details/information，按使用目的判断；差异化differentiated独立于分类；主次group仍是重要性。已保存的卖点梳理就是本品资料，人工修改优先；待改进/待实现不属于已具备。问题必须给出积极、具体、有依据的answer，不虚构认证或绝对保证。评论只归并已有主题，不重分析原文；标题必须表达明确的正负面结论。保留人工名称、答案、状态、分类、标注、连线与顺序，不复活排除项。",
    product: section==="questions"?{productName:sources.product.productName}:sources.product,
    sellingRegeneration: freshSelling
      ? useManual
        ? "输出本轮完整卖点和功能，系统在预览中保留明确标记的人工字段。"
        : "输出本轮完整卖点和功能，按输入依据重新整理，不沿用此前人工编辑的卖点。"
      : undefined,
    excludedConcepts: modelData.excludedConcepts || [],
    reviewUpdateInstruction: "reviews每项返回id；同一评论主题复用existing.reviews中已有id，优先复用已有count的新版主题。合并相近主题只保留一次，旧版重复结果由系统归档。excludedConcepts中的概念已被用户移除，不要换个说法再次生成。",
    existing:{
      features: (modelData.features ||[]).map(({ id, text, group, note })=> ({id, text, group, note })
      ),
      selling: modelData.selling.map(({ id, text, group, note }) => ({
        id,
        text,
        group,
        note,
      })),
      questions:current.data.questions.map(({evidence,originalQuestions,mergedQuestionIds,mergeInputIds,...q})=>q),
      reviews: current.data.reviews.map(({ id, text, sentiment, note, count }) => ({
        id,
        text,
        sentiment,
        count,
        note,
      })),
    },
    legacyInstruction: current.data.features === undefined ? "当前是旧版混合卖点。请重新区分功能与用户获益，迁移每一项到正确的一侧并复用该旧项id；同一概念不可在左右重复保留。把旧长标签缩成简短名称，原说明保留在note。来源仍只引用selling输入中的真实来源id，不能虚构来源。" : undefined,
    updateInstruction:
      freshSelling && !useManual
        ? "按当前证据重新整理，复用existing里同一概念的id。其余概念用新id，不延用历史人工文本和连线。"
        : "更新已有汇总时，同一个概念必须复用existing中该节点的id，包括人工改过名称的节点；不要因措辞变化新增重复概念。已有人工名称、分组、标注及连线由系统保留。只有确实新增的概念使用新id。",
    selling: modelSelling.map(({ id, text, evidence }) => ({
      id,
      text,
      origins: evidence.map(e => ({
        asin: e.asin,
        kind: e.kind,
        basis: e.basis,
      })),
    })),reviews: sources.reviews.map(({reviewIds,evidence,...r})=>({...r,count:reviewIds.length,
    })),questions: sources.questions,
    featureGroups: FEATURE_GROUPS,
    benefitGroups: SELLING_GROUPS,
  };
  let context=JSON.stringify(requestData),validationHint="",previousOutput:unknown=null;
  if(context.length> 800000)throw new TRPCError({code:"PRECONDITION_FAILED",message: "竞品资料较多，请缩小资料范围后重试",
    });
  const validate = (content: string) => { try {
    previousOutput=safeParseSkillJSON(content);
    const raw=previousOutput as Record<string,unknown>;
    const output= resultSchema.parse({...raw,features:section==="selling"?raw.features:[],selling:section==="selling"?raw.selling:[],links:section==="selling"?raw.links:[],reviews:section==="reviews"?raw.reviews:[],questions:section==="questions"?raw.questions:[]});
  for(const item of [...output.features, ...output.selling]){
    const known=[...(modelData.features || []),...modelData.selling].find(n=>n.id===item.id);
    if(known){
      const ownId="PRODUCT:"+(known.availability==="planned" || known.group==="improve"?"PLANNED:":"CONFIRMED:")+known.id;
      if(sourceMap.has(ownId) && !item.sourceIds.includes(ownId))item.sourceIds.push(ownId);
      if(!item.comparisonScope?.trim() && known.comparisonScope?.trim())item.comparisonScope=known.comparisonScope;
    }
    if(item.sourceIds.some(id=>!sourceMap.has(id)))throw new Error("功能或卖点引用了不存在的依据");
    if((["differentiated", "improve"].includes(item.group)||item.differentiated||item.availability==="planned")&&(!item.sourceIds.some(id => id.startsWith("PRODUCT:"))||
          !item.comparisonScope?.trim()))throw new Error("差异化或待改进结论缺少本品依据及比较范围："+item.text+"。请为此节点返回comparisonScope字段（明确比较对象及范围），sourceIds需包含对应PRODUCT:CONFIRMED:/PRODUCT:PLANNED:/PRODUCT:notes真实id；不能只用竞品S编号。缺少真实比较依据则取消差异化标记，并改为普通分组。原节点id仅用于复用节点，不能直接当来源id。");
  }
    const fIds = output.features.map((n, i) => n.id || "F" + i),
      bIds = output.selling.map((n, i) => n.id || "B" + i);
    if (
      fIds.some(id=>bIds.includes(id)) ||
      new Set(fIds).size !== fIds.length ||
      new Set(bIds).size !== bIds.length
    )
      throw new Error("功能或卖点标识重复");
    if (
      output.links.some(
        l => !fIds.includes(l.featureId) || !bIds.includes(l.benefitId)
      )
    )
      throw new Error("功能与卖点的连线引用无效");
    const used = output.reviews.flatMap(r => r.sourceIds);
    if (section==="reviews" && (
      used.length !== sources.reviews.length ||
      new Set(used).size !== sources.reviews.length
    ))
      throw new Error("评论归并必须完整保留每个已有主题");
    for(const item of output.reviews)if(item.sourceIds.some(id=>!reviewMap.has(id)||reviewMap.get(id)!.sentiment!==item.sentiment))throw new Error("评论归并引用与情绪不一致");
  for(const item of output.questions){
    const invalid=item.sourceIds.filter(id=>!questionIds.has(id)&&!allowedSelling.has(id)&&!reviewMap.has(id));if(invalid.length)throw new Error("买家问题引用了不存在的依据："+invalid.slice(0,5).join("、")+"。sourceIds只能使用sourceIdRules允许的来源id，existing旧UUID只能用作输出id。");
    if (
        (item.source=== "uploaded" &&!item.sourceIds.some(id=>questionIds.has(id))) ||
        (item.source=== "review" &&!item.sourceIds.some(id=>reviewMap.has(id))) ||
        (item.source=== "listing" &&!item.sourceIds.some(id=> sourceMap.has(id)))
      )
        throw new Error("买家问题的来源与依据不一致");
  }
    if(section==="questions")validateQuestionGroups(output.questions,current.data.questions);
    if(section==="questions"){
      const issues=output.questions.flatMap(q=>questionAnswerIssues(q.answer,confirmedFacts).map(message=>q.id+"："+message));
      if(issues.length)throw new Error("请修正所有同类问题的无依据回答，保持积极、实用且不要求补资料："+issues.slice(0,15).join("；"));
    }
    validationHint="";return output;
  }catch(error){validationHint=error instanceof z.ZodError?error.issues.slice(0,10).map(i=>i.path.join(".")+": "+i.message).join("; "):error instanceof Error?error.message:"输出格式错误";console.warn("[聚合分析] "+section+" 输出校验未通过："+validationHint);throw error;}
  };
  const output =(
    await runCompetitorSkill({
      skillSlug: ({selling:"listing.research.selling.v2",reviews:"listing.research.reviews.v2",questions:"listing.research.questions.v2"} as const)[section],
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      context,
      signal:options.signal,
      modelOverride:assistant?.modelSlug || undefined,
      variables: { context },
      validate,
    },(_error,_attempt,request)=>{
      context=JSON.stringify({...requestData,previousOutput,correction:"保留已有正确内容，仅修正以下格式或来源问题，并重新返回完整的当前section结果："+validationHint});request.context=context;request.variables={context};
    },{validationFailed:()=>!!validationHint})
  ).parsed;
  const base = structuredClone(freshSelling && !useManual ? modelData : sellingBase);
  if (freshSelling) {
    for (const item of [...(base.features || []), ...base.selling]) {
      delete item.manual;
      delete item.manualFields;
      delete item.manualChangedAt;
    }
  }
  const generated={...base,
    features: [...(base.features || [])],selling:[...base.selling],
    links: freshSelling ? [] as NonNullable<typeof base.links> : [...(base.links || [])],reviews: section==="reviews" ? base.reviews.filter(r=>r.manual || (r.sampleSize===null && !r.sourceKey && !r.evidence?.length)) : [...base.reviews],questions:section==="questions"?[] as typeof base.questions:[...base.questions],
    ...(section==="questions"?{questionMergeBase:questionMergeSignature(base.questions)}:{}),
    reviewSummary: section==="reviews" ? sources.summary : base.reviewSummary,
    organized:{...base.organized,[section]:true},
  };
  const fMap = new Map<string, string>(),
    bMap = new Map<string, string>();
  for(const side of ["features", "selling"] as const)
    for (const [i, item] of output[side].entries()) {
      if(base.excludedConcepts?.some(n=>n.id===item.id || (n.kind===side && normalized(n.text)===normalized(item.text))))continue;
      const legacy = !freshSelling && base.features === undefined ? base.selling.find(n=>n.id===item.id) : undefined;
      if(legacy && side==="features" && !generated.features.some(n=>n.id===legacy.id)) {
        generated.selling=generated.selling.filter(n=>n.id!==legacy.id);
        generated.features.push({...legacy,text:legacy.manual?legacy.text:item.text,group:item.group as (typeof FEATURE_GROUPS)[number],note:[legacy.note,item.note,legacy.text!==item.text?"原标签："+legacy.text:""].filter(Boolean).join("\n").slice(0,3000)});
      }
      const key = sourceKey(side, item.text),
        items = generated[side],
        found = items.find(
          n =>
            n.id === item.id || item.sourceIds.includes("PRODUCT:CONFIRMED:"+n.id) ||
            n.sourceKey === key ||
            normalized(n.text)=== normalized(item.text));
      if (!found && base.excludedSourceKeys?.includes(key)) continue;
      const evidence = uniqueEvidence(
          item.sourceIds.flatMap(id => sourceMap.get(id)!.evidence)
        ).map(e =>
          item.basis === "inferred" && e.basis !== "user"
            ? { ...e, basis: "inferred" as const }: e
        ),
        id = found?.id || randomUUID();
      (side === "features" ? fMap : bMap).set(
        item.id || (side === "features" ? "F" : "B") + i,
        id
      );
      if(found && legacy && side==="selling" && !found.manual){
        found.note=[found.note,item.note,found.text!==item.text?"原标签："+found.text:""].filter(Boolean).join("\n").slice(0,3000);
        found.text=item.text; found.group=item.group;
      }
      if(found && !found.manual){
        Object.assign(found,{category:item.category || researchCategory(item),differentiated:item.differentiated,availability:item.availability,text:item.text,group:item.group,note:legacy?found.note:[item.note,...found.note.split("\n").filter(line=>line.startsWith("原标签："))].filter(Boolean).join("\n").slice(0,3000),badges:item.badges||[],comparisonScope:item.comparisonScope||""});
      }
      if (found)
        Object.assign(found, {
          ...(freshSelling ? { note: item.note } : {}),
          evidence: uniqueEvidence([...(found.evidence || []).filter(old=>!evidence.some(fresh=>old.analysisId===fresh.analysisId && old.kind===fresh.kind && (old.hash || old.blockId || old.sourceKey)===(fresh.hash || fresh.blockId || fresh.sourceKey))), ...evidence]),
          sourceKey: found.sourceKey || key,
        });
      else
        (items as any[]).push({id,text:item.text,note:item.note,group:item.group,category:item.category || researchCategory(item),differentiated:item.differentiated,availability:item.availability,
          sourceKey: key,
          evidence,
          badges: item.badges || [],
          comparisonScope: item.comparisonScope || "",
        });
    }
  if (freshSelling) {
    const featureIds = new Set(fMap.values()), benefitIds = new Set(bMap.values());
    generated.features = generated.features.filter(item => featureIds.has(item.id));
    generated.selling = generated.selling.filter(item => benefitIds.has(item.id));
  }
  for (const link of section==="selling" ? output.links : []) {
    const featureId = fMap.get(link.featureId)!,
      benefitId = bMap.get(link.benefitId)!;
    if (
      !featureId ||
      !benefitId ||
      base.excludedLinks?.includes(featureId + ":" + benefitId)
    )
      continue;
    if (
      !generated.links.some(
        l => l.featureId === featureId && l.benefitId === benefitId
      )
    )
      generated.links.push({
        id: randomUUID(),
        featureId,
        benefitId,
        note: link.note,
      });
  }
  for(const item of section==="reviews" ? output.reviews : []){
    if(base.excludedConcepts?.some(n=>n.id===item.id))continue;
    const key = aggregationConceptKey("reviews", item.text, item.sentiment);
    if (current.data.excludedSourceKeys?.includes(key)) continue;
    const ids=new Set(item.sourceIds.flatMap(id=>reviewMap.get(id)!.reviewIds)),
      evidence=item.sourceIds.map(id=>reviewMap.get(id)!.evidence);
    const percentage = sources.summary.sampleCount
      ? Math.round((ids.size / sources.summary.sampleCount) * 1000) / 10
      : null;
    const existing = base.reviews.find(
      r =>
        r.sentiment === item.sentiment &&
        (r.id === item.id ||
          r.sourceKey === key ||
          normalized(r.text) === normalized(item.text) ||
          reviewSignature(r.evidence) === reviewSignature(evidence))
    );
    if(existing) {
      const updated = {...existing, category:existing.category || item.category || researchCategory(item)};
      Object.assign(updated, {
        sourceKey: existing.sourceKey || key,
        ...(existing.sampleSize !== null
          ? {
              percentage,
              count: ids.size,
              sampleSize: sources.summary.sampleCount,
            }: {}),
        evidence,
      });
      const at=generated.reviews.findIndex(r=>r.id===updated.id);
      if(at<0)generated.reviews.push(updated);else generated.reviews[at]=updated;
    }
    else
      generated.reviews.push({id:randomUUID(),text:item.text,note:item.note,sentiment:item.sentiment,category:item.category || researchCategory(item),
        sourceKey: key,
        percentage,
        count: ids.size,sampleSize: sources.summary.sampleCount,status: item.sentiment==="positive" ? "covered" : "solved",evidence,
      });
  }
  const retired=base.reviews.filter(r=>!generated.reviews.some(n=>n.id===r.id));
  if(retired.length)generated.reviewHistory=[...new Map([...(base.reviewHistory||[]),...retired].map(r=>[r.id,r])).values()];
  for(const item of section==="questions" ? output.questions : []) {
    const key=aggregationConceptKey("questions",item.text);
    if(base.excludedSourceKeys?.includes(key) || base.excludedConcepts?.some(n=>n.id===item.id))continue;
    const evidence=uniqueEvidence(item.sourceIds.flatMap(id=>{
      const selling=sourceMap.get(id);if(selling)return selling.evidence;
      const review=reviewMap.get(id);if(review)return [{kind:"review" as const,analysisId:review.evidence.analysisId,asin:review.asin,sourceKey:id,quote:review.text+"\n"+review.reason,basis:"direct" as const,generatedAt:review.evidence.generatedAt}];
      const q=sources.questions.find(q=>q.id===id);return q?[{kind:"listing" as const,analysisId:Number(id.split(":")[1]),asin:q.asin,sourceKey:id,quote:q.text,basis:"direct" as const}]:[];
    }));
    generated.questions.push(consolidateQuestionGroup(item,base.questions,evidence));
  }
  let data = listingAggregationSchema.parse({...generated,...(section!=="selling"?{features:base.features,links:base.links}:{})});
  if (freshSelling) {
    if (useManual) {
      const manualLinks = (sellingBase.links || []).filter(link => link.manual);
      function keepLinked<T extends { id: string }>(
        items: T[], original: T[], endpoint: "featureId" | "benefitId"
      ) {
        const linked = new Set(manualLinks.map(link => link[endpoint]));
        const ids = new Set(items.map(item => item.id));
        return [...items, ...original.filter(item => linked.has(item.id) && !ids.has(item.id))];
      }
      data.features = keepLinked(data.features || [], sellingBase.features || [], "featureId");
      data.selling = keepLinked(data.selling, sellingBase.selling, "benefitId");
      const manualPairs = new Set(manualLinks.map(link => `${link.featureId}:${link.benefitId}`));
      data.links = data.links?.filter(link => !manualPairs.has(`${link.featureId}:${link.benefitId}`));
      data = preserveManualResearch(current.data, data);
    }
    data = mergeResearchProposal(sellingBase, data, "selling");
  }
  return options.preview
    ? { data, revision: current.revision }
    : saveListingAggregation(scope,current.revision, data,undefined,{generated:true});
}
