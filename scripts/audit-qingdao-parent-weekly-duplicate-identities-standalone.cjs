const mysql = require("/opt/amazon-listing-tool/node_modules/mysql2/promise");

const TARGET_BATCH_ID = 90583;
const text = (value) => value === null || value === undefined ? "" : String(value).trim();
const parseJson = (value) => {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(String(value || "{}")); } catch { return {}; }
};
const field = (object, ...keys) => keys.map((key) => object?.[key]).find((value) => text(value)) ?? "";
const normalizeCountry = (value) => {
  const country = text(value).toUpperCase();
  if (["US", "美国", "美国站", "UNITED STATES", "USA"].includes(country)) return "US";
  return country || "US";
};
const quote = (column) => `\`${column.replace(/`/g, "``")}\``;
const findColumn = (columns, ...choices) => choices.find((choice) => columns.has(choice));

async function columnsFor(connection, table) {
  const [rows] = await connection.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?",
    [table],
  );
  return new Set(rows.map((row) => row.column_name));
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("缺少运行环境数据库连接");
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    const rowColumns = await columnsFor(connection, "ops_external_sync_rows");
    const rowBatch = findColumn(rowColumns, "batchId", "batch_id");
    const rowNormalized = findColumn(rowColumns, "normalizedData", "normalized_data");
    const rowSource = findColumn(rowColumns, "sourceData", "source_data");
    const rowValidation = findColumn(rowColumns, "validationErrors", "validation_errors");
    if (![rowBatch, rowNormalized, rowSource].every(Boolean)) throw new Error("同步行表字段不完整，拒绝推断诊断查询");

    const selectValidation = rowValidation ? `, ${quote(rowValidation)} AS validation_value` : "";
    const [rows] = await connection.query(
      `SELECT ${quote(rowNormalized)} AS normalized_value, ${quote(rowSource)} AS source_value${selectValidation} FROM ${quote("ops_external_sync_rows")} WHERE ${quote(rowBatch)} = ?`,
      [TARGET_BATCH_ID],
    );
    const groups = new Map();
    for (const row of rows) {
      const normalized = parseJson(row.normalized_value);
      const source = parseJson(row.source_value);
      const week = parseJson(normalized.week);
      const parentAsin = text(field(normalized, "parentAsin", "parent_asin")).toUpperCase();
      const storeName = text(field(normalized, "storeName", "store_name"));
      const weekStart = text(field(week, "weekStartDate", "week_start_date") || field(normalized, "weekStartDate", "week_start_date"));
      const rawCountry = text(field(source, "country", "country_name", "site", "marketplace", "marketplace_name") || field(normalized, "country", "site", "marketplace") || "US").toUpperCase();
      const normalizedCountry = normalizeCountry(field(normalized, "country", "site", "marketplace"));
      const identity = ["1", parentAsin, storeName, normalizedCountry, weekStart].join("|");
      const item = { rawCountry, rawDiffers: normalizeCountry(rawCountry) !== rawCountry, hasValidationErrors: Array.isArray(parseJson(row.validation_value)).length > 0 };
      const bucket = groups.get(identity) || [];
      bucket.push(item);
      groups.set(identity, bucket);
    }
    const duplicateGroups = [...groups.values()].filter((group) => group.length > 1);
    const classification = { aliasOnly: 0, sameRawCountry: 0, mixedUnclassified: 0, withValidationErrors: 0 };
    for (const group of duplicateGroups) {
      const rawCountries = new Set(group.map((item) => item.rawCountry));
      if (group.some((item) => item.hasValidationErrors)) classification.withValidationErrors += 1;
      if (rawCountries.size > 1 && [...rawCountries].every((country) => [...rawCountries].filter((candidate) => candidate === country).length === 1)) classification.aliasOnly += 1;
      else if (rawCountries.size === 1) classification.sameRawCountry += 1;
      else classification.mixedUnclassified += 1;
    }
    console.log(JSON.stringify({
      action: "audit_parent_weekly_duplicate_identities",
      batchId: TARGET_BATCH_ID,
      rowCount: rows.length,
      normalizedIdentityCount: groups.size,
      duplicateIdentityGroupCount: duplicateGroups.length,
      duplicateCandidateRowCount: duplicateGroups.reduce((total, group) => total + group.length, 0),
      classification,
      writePerformed: false,
    }));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
