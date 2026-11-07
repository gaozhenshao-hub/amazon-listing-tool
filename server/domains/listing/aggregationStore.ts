import { recordManualResearch, researchPageChanged,preserveManualResearch } from "../../../shared/researchEditing";
import { assertResearchEditable } from "./researchLocks";
import { questionMergeSignature } from "../../../shared/questionMerging";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { emptyListingAggregation, listingAggregationSchema, type ListingAggregation,
} from "../../../shared/listingAggregation";
import { requireDb } from "../../repositories/dbClient";
import { competitorStudyFields } from "../../../shared/competitorStudyFields";
import type { DbExecutor } from "../../repositories/dbClient";

type Scope = { projectId: number; workspaceId: number; userId: number };
function readData(value: unknown): ListingAggregation {
  return listingAggregationSchema.parse(typeof value === "string" ? JSON.parse(value) : value);
}
function readRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("聚合分析数据读取失败");
  return value as Record<string, unknown>[];
}

export async function readListingAggregation(scope: Scope) {
  const db = await requireDb("read listing aggregation");
  const [rows] = await db.execute(sql`SELECT data, revision FROM listing_aggregations WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId}`);
  const row = readRows(rows)[0];
  return row ? { data: readData(row.data), revision: Number(row.revision) } : { data: emptyListingAggregation(), revision: 0 };
}

export async function saveListingAggregation(scope: Scope, expectedRevision: number, value: ListingAggregation,
  executor?: DbExecutor, options: { generated?: boolean; section?:"selling"|"reviews"|"questions"; exactSelling?: boolean } = {}
) {
  let data = listingAggregationSchema.parse(value);
  const db = await requireDb("save listing aggregation");
  const write = async (tx: DbExecutor) => {
    // Lock the project first, including on first save; two editors cannot create
    // parallel versions or overwrite another person's changes silently.
    const [parents] = await tx.execute(sql`SELECT id FROM projects WHERE id=${scope.projectId} AND workspaceId=${scope.workspaceId} AND userId=${scope.userId} FOR UPDATE`);
    if (!readRows(parents).length) throw new TRPCError({ code: "NOT_FOUND", message: "项目不可访问" });
    const [results] = await tx.execute(sql`SELECT data,revision FROM listing_aggregations WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId} FOR UPDATE`);
    const row = readRows(results)[0];
    const current = row ? Number(row.revision) : 0;
    if (current !== expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "聚合分析已被其他操作更新，请刷新后再保存",
      });
    const previous = row ? readData(row.data) : emptyListingAggregation();
    if(options.generated && data.questionMergeBase && data.questionMergeBase!==questionMergeSignature(previous.questions))throw new TRPCError({code:"CONFLICT",message:"买家问题已被编辑，请重新整理后再确认，人工修改已保留"});
    for (const page of ["selling", "reviews", "questions"] as const) {
      if (page === "selling" && options.exactSelling) continue;
      if (researchPageChanged(previous, data, page)) await assertResearchEditable(scope, page, tx);
    }
    data.pageLocks = previous.pageLocks;
    data.researchJobs=previous.researchJobs;
    data.productPhotos = previous.productPhotos;
    data.planningConversation = previous.planningConversation;
    if (!options.generated) data = recordManualResearch(previous, data);
    else if (!options.exactSelling) data=preserveManualResearch(previous,data);
    delete data.questionMergeBase;
    data.questions=data.questions.map(({mergeInputIds:_inputs,...question})=>question);
    if(options.generated && options.section && data.researchJobs){data.researchJobs={...data.researchJobs};delete data.researchJobs[options.section];}
    data=listingAggregationSchema.parse(data);
    const encoded = JSON.stringify(data);
    if (current === 0) await tx.execute(sql`INSERT INTO listing_aggregations(project_id,workspace_id,data,revision) VALUES(${scope.projectId},${scope.workspaceId},${encoded},1)`);
    else await tx.execute(sql`UPDATE listing_aggregations SET data=${encoded}, revision=revision+1 WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId}`);
    return { data, revision: current + 1 };
  };
  return executor ? write(executor) : db.transaction(write);
}

type Edit = {type:"edit";key:string;original:string;value:string};
export type MarkChange =
  | { type: "image"; hash: string } | { type: "highlight"; bulletIndex: number; start: number; end: number; text: string;
    } | Edit | {type:"edits";items:Edit[]};
export async function updateCompetitorMark(scope: Scope, analysisId: number, change: MarkChange, executor?: DbExecutor) {
  const write = async (tx: DbExecutor) => {
    const [parent] = await tx.execute(sql`SELECT id FROM projects WHERE id=${scope.projectId} AND workspaceId=${scope.workspaceId} AND userId=${scope.userId} FOR UPDATE`);
    if (!readRows(parent).length) throw new TRPCError({code:"NOT_FOUND",message:"项目不可访问"});
    const [records] = await tx.execute(sql`SELECT rawData,bulletPoints FROM competitorAnalyses WHERE id=${analysisId} AND projectId=${scope.projectId} FOR SHARE`);
    const record = readRows(records)[0];
    if (!record) throw new TRPCError({code:"NOT_FOUND",message:"竞品不存在"});
    const parse = (value: unknown) => typeof value === "string" ? JSON.parse(value) : value;
    const raw = parse(record.rawData) as { confirmedSnapshotId?: number; imageAssets?: Array<{sourceUrlHash?:string}>;comparisonAnalysis?:unknown;sourceLayout?:unknown;
    } | null;
    const bullets = parse(record.bulletPoints) as unknown;
    if (change.type === "image" && !raw?.imageAssets?.some(item => item.sourceUrlHash === change.hash)) {
      if (!raw?.confirmedSnapshotId) throw new TRPCError({code:"PRECONDITION_FAILED",message:"图片资料已变化，请刷新后重试",
        });
      const [asset] = await tx.execute(sql`SELECT a.id FROM acquisition_asset_candidates a JOIN acquisition_confirmed_snapshots s ON s.snapshot_id=a.snapshot_id AND s.workspace_id=a.workspace_id
        WHERE s.id=${raw.confirmedSnapshotId} AND s.workspace_id=${scope.workspaceId} AND a.source_url_hash=${change.hash} AND a.storage_key IS NOT NULL
        AND JSON_CONTAINS(s.confirmed_asset_ids, CAST(a.id AS JSON), '$') LIMIT 1`);
      if (!readRows(asset).length) throw new TRPCError({code:"PRECONDITION_FAILED",message:"图片资料已变化，请刷新后重试",
        });
    }
    if (change.type === "highlight") {
      const original = Array.isArray(bullets) ? bullets[change.bulletIndex] : null;
      if (typeof original !== "string" || change.end <= change.start || original.slice(change.start,change.end) !== change.text) throw new TRPCError({code:"PRECONDITION_FAILED",message:"五点描述已变化，请重新选择文字",
        });
    }
    const edits:Edit[]=change.type=== "edits"
        ?change.items:change.type=== "edit"
          ?[change]:[];
    if(edits.length) {
      const fields=competitorStudyFields(raw?.comparisonAnalysis,raw?.sourceLayout);
      for(const edit of edits){
        if(edit.key.startsWith("region:")&&edit.value.length>12000)throw new TRPCError({code: "BAD_REQUEST",message: "图片文字译文过长，请分段核对",
          });
        if(
          /^(text:|region:|subtitle:)/.test(edit.key)&&edit.key.endsWith(":translation")&&!edit.value.trim())throw new TRPCError({code: "BAD_REQUEST",message: "中文翻译不能为空",
          });
        if(/^(module:|video:)/.test(edit.key)){const values=edit.value.split(/[、，,\n]+/).map(v=>v.trim()).filter(Boolean);if(values.length>12||values.some(v=>v.length>200))throw new TRPCError({code: "BAD_REQUEST",message: "每个模块最多12个简短卖点",
            });}
        if(fields[edit.key]!==edit.original)throw new TRPCError({code:"CONFLICT",message:"分析结果已更新，请刷新后重试",
          });
        if(edit.key.endsWith(":percentage") && (edit.value.trim()=== "" ||!Number.isFinite(Number(edit.value))||Number(edit.value)<0||Number(edit.value)>100))throw new TRPCError({code:"BAD_REQUEST",message:"比例必须在 0 到 100 之间",
          });
      }
    }
    const [results] = await tx.execute(sql`SELECT data,revision FROM listing_aggregations WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId} FOR UPDATE`);
    const row = readRows(results)[0]; const data = row ? readData(row.data) : emptyListingAggregation();
    const marks = data.marks.find(item => item.analysisId === analysisId) ?? { analysisId, likedAssets: [], highlights: [], edits:{},
    };
    if (!data.marks.includes(marks)) data.marks.push(marks);
    if (change.type === "image") marks.likedAssets = marks.likedAssets.includes(change.hash) ? marks.likedAssets.filter(hash => hash !== change.hash) : [...marks.likedAssets, change.hash];
    else if (change.type === "highlight") {
      const index = marks.highlights.findIndex(item => item.bulletIndex === change.bulletIndex && item.start === change.start && item.end === change.end);
      if (index >= 0) marks.highlights.splice(index,1); else marks.highlights.push({bulletIndex:change.bulletIndex,start:change.start,end:change.end,text:change.text,
        });
    }
    else for(const edit of edits)marks.edits[edit.key] = { original:edit.original, value:edit.value };
    const encoded = JSON.stringify(listingAggregationSchema.parse(data)); const current = row ? Number(row.revision) : 0;
    if (!current) await tx.execute(sql`INSERT INTO listing_aggregations(project_id,workspace_id,data,revision) VALUES(${scope.projectId},${scope.workspaceId},${encoded},1)`);
    else await tx.execute(sql`UPDATE listing_aggregations SET data=${encoded},revision=revision+1 WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId}`);
    return { data, revision: current + 1 };
  };
  return executor ? write(executor) : (await requireDb("save competitor mark")).transaction(write);
}
