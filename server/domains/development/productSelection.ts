import { randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  requireDb,
  withDbTransaction,
  type DbExecutor,
} from "../../repositories/dbClient";
import {
  assertPrivateEvidenceStorageAvailable,
  createPrivateEvidencePreviewUrl,
  getActiveStorageProvider,
  parseStorageUri,
  storageDeleteOwnedObject,
  storagePut,
} from "../../storage";
import { verifiedLocalObjectPath } from "../../infrastructure/localObjectStorage";
import { admitOffice } from "../ai_os/services/assistantConversationAttachments";
import {
  runEmperorSkill,
  safeParseSkillJSON,
} from "../ai_os/services/skillRunner";
import { createSkillImprovementDraft } from "../ai_os/services/skillWorkbench";
import {
  PICK_FILE_BYTES,
  createPickSheet,
  pickAsin,
  pickSheetDataSchema,
  pickStatusAfterReview,
  type PickPatent,
  type PickReview,
  type PickSheetData,
  type PickStatus,
} from "../../../shared/productSelection";
import {
  pickAnalysis,
  summarizePickRows,
} from "../../../shared/productSelectionAnalysis";
import { pickFileBytes, type PickFile } from "./productSelectionImport";
import {
  researchAdmin,
  researchRows,
  type ResearchScope,
} from "./researchLibrary";

type Ref = { id: string; revision: number };
const today = () => new Date().toISOString().slice(0, 10);
const fail = (
  code: ConstructorParameters<typeof TRPCError>[0]["code"],
  message: string
) => new TRPCError({ code, message });
const json = (value: unknown) =>
  typeof value === "string" ? JSON.parse(value) : value;
const TAG_SKILL = "dev.selection.competitor-tags";

function scoped(scope: ResearchScope, table: string): SQL {
  const alias = sql.identifier(table);
  return sql`${alias}.workspace_id=${scope.workspaceId} ${researchAdmin(scope) ? sql`` : sql`AND ${alias}.user_id=${scope.userId}`}`;
}

async function loadSheet(
  tx: DbExecutor,
  scope: ResearchScope,
  id: string,
  lock = false
) {
  const [row] = await researchRows(
    tx,
    sql`SELECT s.*, u.name creator FROM product_selection_sheets s LEFT JOIN users u ON s.user_id=u.id WHERE s.id=${id} AND ${scoped(scope, "s")} ${lock ? sql`FOR UPDATE` : sql``}`
  );
  if (!row) throw fail("NOT_FOUND", "找不到选品表，或当前账号无权查看");
  return row;
}

function checkRevision(row: Record<string, unknown>, revision: number) {
  if (Number(row.revision) !== revision)
    throw fail("CONFLICT", "选品表已被更新，请刷新后再提交");
}

function editable(row: Record<string, unknown>, ref: Ref) {
  checkRevision(row, ref.revision);
  if (row.status !== "draft")
    throw fail("PRECONDITION_FAILED", "只有草稿可以修改");
  return pickSheetDataSchema.parse(json(row.data));
}

export async function createSelection(
  scope: ResearchScope,
  bookmarkId: string
) {
  return withDbTransaction(
    "create product selection",
    async tx => {
      const [bookmark] = await researchRows(
        tx,
        sql`SELECT b.* FROM research_bookmarks b WHERE b.id=${bookmarkId} AND b.kind='product' AND b.deleted_at IS NULL AND ${scoped(scope, "b")}`
      );
      if (!bookmark) throw fail("NOT_FOUND", "找不到待调研产品");
      const data = createPickSheet(
        String(bookmark.title || ""),
        String(bookmark.note || "").slice(0, 4000)
      );
      await tx.execute(
        sql`INSERT INTO product_selection_sheets(id,workspace_id,user_id,bookmark_id,identity_hash,source_title,site,data) VALUES(${randomUUID()},${scope.workspaceId},${scope.userId},${bookmarkId},${bookmark.identity_hash},${bookmark.title},${bookmark.site},${JSON.stringify(data)}) ON DUPLICATE KEY UPDATE id=id`
      );
      const [sheet] = await researchRows(
        tx,
        sql`SELECT id,user_id FROM product_selection_sheets WHERE workspace_id=${scope.workspaceId} AND identity_hash=${bookmark.identity_hash}`
      );
      if (Number(sheet.user_id) !== scope.userId && !researchAdmin(scope))
        throw fail("CONFLICT", "该产品已有选品表，请联系创建人或管理员");
      return { id: String(sheet.id) };
    },
    { required: true }
  );
}

export async function listSelections(
  scope: ResearchScope,
  status: PickStatus,
  page: number,
  query: string
) {
  const db = await requireDb("list product selections");
  const match = "%" + query + "%";
  const search = query
    ? sql`AND (s.source_title LIKE ${match} OR JSON_UNQUOTE(JSON_EXTRACT(s.data,'$.nameZh')) LIKE ${match} OR JSON_UNQUOTE(JSON_EXTRACT(s.data,'$.nameEn')) LIKE ${match})`
    : sql``;
  const where = sql`${scoped(scope, "s")} AND s.status=${status} ${search}`;
  const [{ total }] = await researchRows(
    db,
    sql`SELECT COUNT(*) total FROM product_selection_sheets s WHERE ${where}`
  );
  const rows = await researchRows(
    db,
    sql`SELECT s.id,s.site,s.source_title,s.market_units,s.market_known,s.market_missing,s.outcome,s.updated_at,u.name creator,
    JSON_UNQUOTE(JSON_EXTRACT(s.data,'$.nameZh')) name_zh, JSON_UNQUOTE(JSON_EXTRACT(s.data,'$.nameEn')) name_en,
    JSON_EXTRACT(s.data,'$.profit') profit FROM product_selection_sheets s LEFT JOIN users u ON u.id=s.user_id
    WHERE ${where} ORDER BY s.updated_at DESC,s.id DESC LIMIT 24 OFFSET ${(page - 1) * 24}`
  );
  return {
    total: Number(total),
    items: rows.map(row => ({
      id: String(row.id),
      site: String(row.site),
      sourceTitle: String(row.source_title),
      creator: String(row.creator || "未命名用户"),
      updatedAt: new Date(row.updated_at).toISOString(),
      nameZh: String(row.name_zh || ""),
      nameEn: String(row.name_en || ""),
      outcome: row.outcome as PickReview | null,
      marketUnits: row.market_units == null ? null : Number(row.market_units),
      marketKnown: Number(row.market_known),
      marketMissing: Number(row.market_missing),
      profit: json(row.profit) as PickSheetData["profit"],
    })),
  };
}

export async function getSelection(scope: ResearchScope, id: string) {
  const db = await requireDb("read product selection");
  const row = await loadSheet(db, scope, id);
  const events = await researchRows(
    db,
    sql`SELECT r.action,r.notes,r.created_at,u.name actor FROM product_selection_reviews r LEFT JOIN users u ON u.id=r.actor_id WHERE r.sheet_id=${id} ORDER BY r.id DESC LIMIT 50`
  );
  const data = pickSheetDataSchema.parse(json(row.data));
  return {
    id,
    revision: Number(row.revision),
    data: {
      ...data,
      patents: data.patents.map(({ storageUri: _storageUri, ...file }) => file),
    },
    sourceTitle: String(row.source_title),
    creator: String(row.creator || "未命名用户"),
    site: String(row.site),
    status: row.status as PickStatus,
    outcome: row.outcome as PickReview | null,
    reviewNotes: String(row.review_notes || ""),
    canReview: researchAdmin(scope),
    events: events.map(event => ({
      action: event.action as PickReview | "submit",
      notes: String(event.notes),
      actor: String(event.actor || "未命名用户"),
      at: new Date(event.created_at).toISOString(),
    })),
  };
}

export async function changeSelection(
  scope: ResearchScope,
  ref: Ref,
  update: (data: PickSheetData, tx: DbExecutor) => void | Promise<void>,
  recalculate = false
) {
  return withDbTransaction(
    "update product selection",
    async tx => {
      const row = await loadSheet(tx, scope, ref.id, true);
      const data = editable(row, ref);
      await update(data, tx);
      const saved = JSON.stringify(pickSheetDataSchema.parse(data));
      const sales = recalculate
        ? summarizePickRows(pickAnalysis(data, today()).rows, "parent").sales
        : null;
      await tx.execute(sql`UPDATE product_selection_sheets SET data=${saved},revision=revision+1
      ${sales ? sql`,market_units=${sales.total},market_known=${sales.known},market_missing=${sales.missing}` : sql``} WHERE id=${ref.id}`);
      return { revision: ref.revision + 1 };
    },
    { required: true }
  );
}

export function transitionSelection(
  scope: ResearchScope,
  ref: Ref,
  action: PickReview | "submit",
  notes: string
) {
  if (action !== "submit" && !researchAdmin(scope))
    throw fail("FORBIDDEN", "只有管理员可以审核选品表");
  return withDbTransaction(
    "review product selection",
    async tx => {
      const row = await loadSheet(tx, scope, ref.id, true);
      checkRevision(row, ref.revision);
      if (action === "submit") {
        const data = editable(row, ref);
        if (!data.imported.rows.length || !data.imported.history)
          throw fail("PRECONDITION_FAILED", "请先导入竞品搜索表和历史月销量表");
      } else if (row.status !== "pending") {
        throw fail("PRECONDITION_FAILED", "当前选品表不在待审核状态");
      }
      const next =
        action === "submit" ? "pending" : pickStatusAfterReview(action);
      await tx.execute(
        sql`UPDATE product_selection_sheets SET status=${next},outcome=${action === "submit" ? null : action},review_notes=${notes},revision=revision+1 WHERE id=${ref.id}`
      );
      await tx.execute(
        sql`INSERT INTO product_selection_reviews(sheet_id,actor_id,action,notes) VALUES(${ref.id},${scope.userId},${action},${notes})`
      );
      return { status: next, revision: ref.revision + 1 };
    },
    { required: true }
  );
}

export async function uploadSelectionPatent(
  scope: ResearchScope,
  ref: Ref,
  file: PickFile
) {
  const db = await requireDb("upload selection patent");
  editable(await loadSheet(db, scope, ref.id), ref);
  const bytes = pickFileBytes(file, ["pdf", "docx"]);
  const docx = /\.docx$/i.test(file.name);
  const mime: PickPatent["mime"] = docx
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : "application/pdf";
  let html: string | null = null;
  try {
    if (docx) {
      await admitOffice(bytes, "docx");
      const mammoth = await import("mammoth");
      html = (
        await mammoth.convertToHtml({ buffer: bytes }, {
          externalFileAccess: false,
        } as never)
      ).value;
      if (Buffer.byteLength(html) > 6 * 1024 * 1024)
        throw fail("BAD_REQUEST", "Word 预览内容过大，请转换为 PDF 后上传");
    } else if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw fail("BAD_REQUEST", "这份文件不是有效的 PDF");
    }
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw fail("BAD_REQUEST", "无法读取这份专利报告，请检查文件或转换为 PDF");
  }
  let stored;
  const id = randomUUID();
  try {
    if (getActiveStorageProvider() !== "local")
      assertPrivateEvidenceStorageAvailable();
    stored = await storagePut(
      [
        "product-selection",
        scope.workspaceId,
        ref.id,
        id + (docx ? ".docx" : ".pdf"),
      ].join("/"),
      bytes,
      mime
    );
  } catch {
    throw fail(
      "PRECONDITION_FAILED",
      "专利报告的私有存储尚不可用，请联系管理员"
    );
  }
  try {
    return await changeSelection(scope, ref, async (data, tx) => {
      if (data.patents.length >= 20)
        throw fail("BAD_REQUEST", "每张选品表最多保存 20 份专利报告");
      data.patents.push({
        id,
        name: file.name,
        mime,
        storageUri: stored.storageUri,
        size: bytes.length,
        uploadedAt: new Date().toISOString(),
      });
      if (html !== null)
        await tx.execute(
          sql`INSERT INTO product_selection_patent_previews(id,html) VALUES(${id},${html})`
        );
    });
  } catch (error) {
    await storageDeleteOwnedObject(stored.storageUri).catch(() => undefined);
    throw error;
  }
}

export async function previewSelectionPatent(
  scope: ResearchScope,
  sheetId: string,
  reportId: string
) {
  const db = await requireDb("preview selection patent");
  const row = await loadSheet(db, scope, sheetId);
  const report = pickSheetDataSchema
    .parse(json(row.data))
    .patents.find(item => item.id === reportId);
  if (!report) throw fail("NOT_FOUND", "未找到这份专利报告");
  if (report.mime.endsWith("document")) {
    const [preview] = await researchRows(
      db,
      sql`SELECT html FROM product_selection_patent_previews WHERE id=${reportId}`
    );
    return {
      kind: "word" as const,
      name: report.name,
      html: String(preview?.html ?? ""),
    };
  }
  try {
    const stored = parseStorageUri(report.storageUri);
    if (
      getActiveStorageProvider() === "local" &&
      stored?.provider === "local"
    ) {
      const expectedKey = [
        "product-selection",
        scope.workspaceId,
        sheetId,
        reportId + ".pdf",
      ].join("/");
      if (stored.key !== expectedKey)
        throw new Error("Report object does not match its sheet");
      const file = await open(await verifiedLocalObjectPath(stored.key), "r");
      try {
        const { size } = await file.stat();
        if (size !== report.size || size > PICK_FILE_BYTES)
          throw new Error("Unexpected report size");
        const bytes = await file.readFile();
        if (
          bytes.length !== size ||
          bytes.subarray(0, 5).toString("ascii") !== "%PDF-"
        )
          throw new Error("Invalid report data");
        return {
          kind: "local-pdf" as const,
          name: report.name,
          base64: bytes.toString("base64"),
        };
      } finally {
        await file.close();
      }
    }
    return {
      kind: "pdf" as const,
      name: report.name,
      url: await createPrivateEvidencePreviewUrl(report.storageUri),
    };
  } catch {
    throw fail("PRECONDITION_FAILED", "暂时无法预览专利报告，请稍后重试");
  }
}

export const pickTagChanges = z
  .array(z.object({ asin: pickAsin, ids: z.array(z.string().uuid()).max(60) }))
  .max(5000);
const pickName = z.object({
  nameZh: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().min(1).max(300),
});

async function runPickSkill<T>(
  scope: ResearchScope,
  input: unknown,
  result: z.ZodType<T>
): Promise<T> {
  const context = JSON.stringify(input);
  try {
    const output = await runEmperorSkill({
      skillSlug: TAG_SKILL,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      context,
      variables: { context },
      expectedSkillStatus: "Released",
      validate: raw => result.parse(safeParseSkillJSON(raw)),
    });
    return output.parsed;
  } catch {
    throw fail("BAD_GATEWAY", "选品助手暂未返回有效结果，请稍后重试");
  }
}

export async function generateSelectionNames(
  scope: ResearchScope,
  ref: Ref,
  guidance: string
) {
  const db = await requireDb("name product selection");
  const row = await loadSheet(db, scope, ref.id);
  const data = editable(row, ref);
  return runPickSkill(
    scope,
    {
      task: "命名",
      title: row.source_title,
      current: { nameZh: data.nameZh, nameEn: data.nameEn },
      guidance,
    },
    pickName
  );
}

export async function generateSelectionTags(
  scope: ResearchScope,
  ref: Ref,
  asins: string[],
  guidance: string,
  previous: z.infer<typeof pickTagChanges>
) {
  const db = await requireDb("tag product selection");
  const data = editable(await loadSheet(db, scope, ref.id), ref);
  if (!data.tags.length)
    throw fail("PRECONDITION_FAILED", "请先在设置标签中保存可用标签");
  const requested = new Set(asins);
  const manual = new Set(data.manualTagAsins);
  const before = new Map(previous.map(change => [change.asin, change.ids]));
  const tags = new Set(data.tags.map(tag => tag.id));
  const rows = data.imported.rows
    .filter(
      row => requested.has(row.asin) && !manual.has(row.asin) && row.title
    )
    .map(row => ({
      asin: row.asin,
      title: row.title,
      previous: (before.get(row.asin) ?? data.rowTags[row.asin] ?? []).filter(
        id => tags.has(id)
      ),
    }));
  if (!rows.length) return [];
  const answer = await runPickSkill(
    scope,
    { task: "打标", tags: data.tags, products: rows, guidance },
    z.object({ tags: pickTagChanges })
  );
  const allowed = new Set(rows.map(row => row.asin));
  const suggestions = new Map(
    answer.tags
      .filter(row => allowed.has(row.asin))
      .map(row => [row.asin, [...new Set(row.ids)].filter(id => tags.has(id))])
  );
  return rows.map(row => ({
    asin: row.asin,
    ids: suggestions.get(row.asin) ?? row.previous,
  }));
}

export async function acceptSelectionTags(
  scope: ResearchScope,
  ref: Ref,
  changes: z.infer<typeof pickTagChanges>,
  improve?: { guidance: string; before: z.infer<typeof pickTagChanges> }
) {
  return changeSelection(scope, ref, async (data, tx) => {
    const rows = new Map(data.imported.rows.map(row => [row.asin, row]));
    const allowedTags = new Map(data.tags.map(tag => [tag.id, tag.name]));
    const manual = new Set(data.manualTagAsins);
    const accepted = changes
      .filter(change => rows.has(change.asin) && !manual.has(change.asin))
      .map(change => ({
        asin: change.asin,
        ids: [...new Set(change.ids)].filter(id => allowedTags.has(id)),
      }));
    if (improve && accepted.length) {
      const before = new Map(
        improve.before.map(change => [change.asin, change.ids])
      );
      const examples = accepted
        .filter(
          change =>
            JSON.stringify(change.ids) !==
            JSON.stringify(before.get(change.asin))
        )
        .slice(0, 45)
        .map(change => ({
          title: rows.get(change.asin)?.title,
          original: (before.get(change.asin) ?? []).flatMap(
            id => allowedTags.get(id) ?? []
          ),
          revised: change.ids.flatMap(id => allowedTags.get(id) ?? []),
        }));
      if (!examples.length)
        throw fail("BAD_REQUEST", "请先完成至少一项标签调整");
      await createSkillImprovementDraft(
        {
          ...scope,
          admin: researchAdmin(scope),
          superAdmin: scope.role === "super_admin",
        },
        TAG_SKILL,
        randomUUID(),
        {
          productId: null,
          context: JSON.stringify({ guidance: improve.guidance, examples }),
        },
        tx
      );
    }
    for (const change of accepted) data.rowTags[change.asin] = change.ids;
  });
}
