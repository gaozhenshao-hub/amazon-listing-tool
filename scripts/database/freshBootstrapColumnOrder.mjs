// Inert public-source column-name replay only. No DB, filesystem, SQL execution,
// type/default/comment rewriting or permissive schema normalization.
import { isDeepStrictEqual } from "node:util";
import { EXPECTED_BOOTSTRAP_PLAN_LENGTH, sha256, fingerprint, insist } from "./freshBootstrapPlan.mjs";

export const COLUMN_ORDER_VERSION = "amazon-fresh-public-column-order/1";
const identifier = "(?:`([A-Za-z_][A-Za-z0-9_]*)`|([A-Za-z_][A-Za-z0-9_]*))";
const type = /^(?:tinyint|smallint|mediumint|int|integer|bigint|varchar|char|text|longtext|mediumtext|tinytext|json|enum|decimal|numeric|float|double|date|datetime|timestamp|time|boolean|bool|blob|longblob|binary|varbinary)\b/i;
const nameOf = match => match[1] ?? match[2];
const safeName = value => typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
const dynamicFile = "0112c_ad_dsp_product_link.sql";
const dynamicHash = "4768df2f3f0c3219ec53494aa1a1ee462baba7891caee7624328424f6284a83c";
const dynamicAdd = "ALTER TABLE `ad_dsp_reports` ADD COLUMN `product_id` int NULL AFTER `upload_id`";
const temporarySources = Object.freeze({
  "0125_dev_stage_consistency.sql": { sha256: "85d56c7d5b957a27e033802349b12a3b00076ef9f1c43fd423cbbdfe85cfdfec", table: "tmp_dev_analysis_stage_ranked" },
  "0128_artifact_source_of_truth.sql": { sha256: "c469ba2c245d052ca5d23e6ce81723d1dd7257fa61ca9b107d5541b5b2d54dd9", table: "tmp_ai_artifact_current_repair" },
});

// The shared splitter deliberately retains Drizzle's non-SQL delimiter for
// statement hashes. Remove only a leading exact delimiter, never quoted text.
function executableStatement(raw) {
  let value = raw.trim();
  while (value.startsWith("--> statement-breakpoint")) {
    insist(/^--> statement-breakpoint(?:\r?\n|$)/.test(value), "COLUMN_ORDER_BREAKPOINT_INVALID");
    value = value.slice("--> statement-breakpoint".length).trim();
  }
  return value;
}

function createBody(sql) {
  const start = sql.indexOf("("); insist(start > 0, "COLUMN_ORDER_CREATE_UNSUPPORTED");
  let quote = null, depth = 1, index = start + 1;
  for (; index < sql.length; index++) {
    const char = sql[index];
    if (quote) {
      if (char === "\\") index++;
      else if (char === quote && sql[index + 1] === quote) index++;
      else if (char === quote) quote = null;
    } else if (["'", '"', "`"].includes(char)) quote = char;
    else if (char === "(") depth++;
    else if (char === ")" && --depth === 0) break;
  }
  insist(depth === 0 && quote === null, "COLUMN_ORDER_CREATE_UNSUPPORTED");
  const suffix = sql.slice(index + 1).trim();
  insist(/^(?:(?:ENGINE\s*=\s*InnoDB|DEFAULT\s+(?:CHARSET|CHARACTER SET)\s*=\s*utf8mb4|(?:DEFAULT\s+)?COLLATE\s*=?\s*utf8mb4_[A-Za-z0-9_]+)\s*)*$/i.test(suffix), "COLUMN_ORDER_CREATE_OPTIONS_UNSUPPORTED");
  return sql.slice(start + 1, index);
}

function columnDefinition(definition) {
  const match = new RegExp(`^${identifier}\\s+([\\s\\S]+)$`).exec(definition);
  insist(match && type.test(match[3]), "COLUMN_ORDER_COLUMN_DEFINITION_UNSUPPORTED");
  // A trailing FIRST/AFTER is the only column-position syntax admitted.
  const after = new RegExp(`\\s+AFTER\\s+${identifier}$`, "i").exec(match[3]);
  const first = /\s+FIRST$/i.test(match[3]);
  // Ignore quoted literals/identifiers when checking position keywords. An
  // unparsed position clause must not silently become an append or no-op.
  const words = match[3].replace(/'(?:\\.|''|[^'\\])*'|"(?:\\.|""|[^"\\])*"|`(?:``|[^`])*`/g, " ");
  const positions = words.match(/\b(?:AFTER|FIRST)\b/gi) ?? [];
  insist(positions.length === Number(Boolean(after) || first) && !/\b(?:BEFORE|RENAME|CHANGE|ADD|DROP|MODIFY|SELECT|AS)\b/i.test(words),
    "COLUMN_ORDER_POSITION_UNSUPPORTED");
  return { name: nameOf(match), after: after ? nameOf(after) : null, first };
}

function moveColumn(columns, name, { after, first }, defaultIndex = columns.length) {
  insist(!columns.includes(name), "COLUMN_ORDER_DUPLICATE_COLUMN");
  if (after !== null) {
    insist(columns.includes(after), "COLUMN_ORDER_AFTER_ANCHOR_MISSING");
    columns.splice(columns.indexOf(after) + 1, 0, name);
  } else columns.splice(first ? 0 : defaultIndex, 0, name);
}

// Exported separately for small pure grammar tests. Production callers use the
// stricter fixed-bundle entry below, not an arbitrary list of SQL files.
export function replayPublicColumnOrder({ plan, pins, splitPublicStatements, splitDefinitionList }) {
  insist(Array.isArray(plan) && plan.length > 0 && pins instanceof Map
    && typeof splitPublicStatements === "function" && typeof splitDefinitionList === "function", "COLUMN_ORDER_INPUT_INVALID");
  const tables = new Map(), temporary = new Set(), operations = [], ignoredStatements = [];
  const touch = (table, pin) => table.sources.set(pin.path, pin);
  const requireTable = name => { insist(tables.has(name), "COLUMN_ORDER_TABLE_MISSING"); return tables.get(name); };
  const alter = (sql, pin, statementIndex) => {
    const match = new RegExp(`^ALTER TABLE\\s+${identifier}\\s+([\\s\\S]+)$`, "i").exec(sql);
    insist(match, "COLUMN_ORDER_ALTER_TARGET_UNSUPPORTED");
    const tableName = nameOf(match), table = requireTable(tableName); touch(table, pin);
    for (const clause of splitDefinitionList(match[3])) {
      let found;
      if (/^ADD\s+(?:(?:CONSTRAINT|PRIMARY KEY|UNIQUE|KEY|INDEX|FOREIGN KEY|CHECK)\b)/i.test(clause)
        || /^DROP\s+(?:INDEX|KEY|FOREIGN KEY|PRIMARY KEY)\b/i.test(clause)) continue;
      if ((found = /^ADD\s+(?:COLUMN\s+)?([\s\S]+)$/i.exec(clause))) {
        const definition = columnDefinition(found[1]); moveColumn(table.columns, definition.name, definition);
        operations.push({ tableName, operation: "add", column: definition.name, after: definition.after, first: definition.first, path: pin.path, statementIndex });
      } else if ((found = new RegExp(`^DROP(?: COLUMN)?( IF EXISTS)?\\s+${identifier}$`, "i").exec(clause))) {
        const name = found[2] ?? found[3], index = table.columns.indexOf(name);
        // The pinned executor checks existence before normalizing this exact
        // legacy form; symbolically preserve that branch, never execute it.
        insist(index >= 0 || found[1], "COLUMN_ORDER_DROP_COLUMN_MISSING");
        if (index >= 0) table.columns.splice(index, 1);
        operations.push({ tableName, operation: index >= 0 ? "drop" : "conditional-drop-noop", column: name, path: pin.path, statementIndex });
      } else if ((found = /^MODIFY\s+(?:COLUMN\s+)?([\s\S]+)$/i.exec(clause))) {
        const definition = columnDefinition(found[1]), index = table.columns.indexOf(definition.name);
        insist(index >= 0, "COLUMN_ORDER_MODIFY_COLUMN_MISSING");
        table.columns.splice(index, 1); moveColumn(table.columns, definition.name, definition, index);
        operations.push({ tableName, operation: "modify", column: definition.name, after: definition.after, first: definition.first, path: pin.path, statementIndex });
      } else if ((found = new RegExp(`^CHANGE(?: COLUMN)?\\s+${identifier}\\s+([\\s\\S]+)$`, "i").exec(clause))) {
        const name = nameOf(found), definition = columnDefinition(found[3]), index = table.columns.indexOf(name);
        insist(index >= 0, "COLUMN_ORDER_CHANGE_COLUMN_MISSING");
        table.columns.splice(index, 1); moveColumn(table.columns, definition.name, definition, index);
        operations.push({ tableName, operation: "change", oldColumn: name, column: definition.name, after: definition.after, first: definition.first, path: pin.path, statementIndex });
      } else throw Object.assign(new Error("COLUMN_ORDER_ALTER_CLAUSE_UNSUPPORTED"), {
        code: "COLUMN_ORDER_ALTER_CLAUSE_UNSUPPORTED", path: pin.path, tableName, statementIndex,
        operation: clause.match(/^[A-Za-z_ ]+/)?.[0].trim(),
      });
    }
  };

  const seenFiles = new Set();
  for (const entry of plan) {
    insist(typeof entry.fileName === "string" && /^(?:bootstrap\/)?[A-Za-z0-9_]+\.sql$/.test(entry.fileName)
      && !seenFiles.has(entry.fileName), "COLUMN_ORDER_SOURCE_NAME_INVALID"); seenFiles.add(entry.fileName);
    const pin = { path: `drizzle/${entry.fileName}`, sha256: sha256(entry.sql) };
    insist(pin.sha256 === entry.checksum && pins.get(pin.path) === pin.sha256, "COLUMN_ORDER_SOURCE_CHANGED");
    const statements = splitPublicStatements(entry.sql).map(executableStatement);
    if (entry.fileName === dynamicFile) {
      insist(pin.sha256 === dynamicHash && statements.length === 5
        && statements[0].startsWith("SET @dspProductIdExists = (")
        && statements[1].includes(`'${dynamicAdd}'`)
        && statements[2] === "PREPARE dsp_product_id_statement FROM @dspProductIdSql"
        && statements[3] === "EXECUTE dsp_product_id_statement"
        && statements[4] === "DEALLOCATE PREPARE dsp_product_id_statement", "COLUMN_ORDER_DYNAMIC_SOURCE_CHANGED");
      const table = requireTable("ad_dsp_reports");
      insist(!table.columns.includes("product_id"), "COLUMN_ORDER_DYNAMIC_FRESH_STATE_CHANGED");
      alter(dynamicAdd, pin, 1); continue;
    }
    for (const [statementIndex, sql] of statements.entries()) {
      let match;
      if ((match = new RegExp(`^CREATE TABLE( IF NOT EXISTS)?\\s+${identifier}\\s*\\(`, "i").exec(sql))) {
        const name = match[2] ?? match[3], columns = [];
        for (const definition of splitDefinitionList(createBody(sql))) {
          if (/^(?:CONSTRAINT|PRIMARY KEY|UNIQUE|KEY|INDEX|FOREIGN KEY|CHECK)\b/i.test(definition)) continue;
          const column = columnDefinition(definition); insist(!column.after && !column.first, "COLUMN_ORDER_CREATE_POSITION_FORBIDDEN");
          insist(!columns.includes(column.name), "COLUMN_ORDER_DUPLICATE_COLUMN"); columns.push(column.name);
        }
        insist(columns.length > 0, "COLUMN_ORDER_CREATE_EMPTY");
        if (tables.has(name)) {
          insist(match[1] && isDeepStrictEqual(tables.get(name).columns, columns), "COLUMN_ORDER_RECREATE_UNREVIEWED");
          touch(tables.get(name), pin);
        } else tables.set(name, { columns, sources: new Map([[pin.path, pin]]) });
        operations.push({ tableName: name, operation: "create", path: pin.path, statementIndex });
      } else if (/^ALTER TABLE\b/i.test(sql)) alter(sql, pin, statementIndex);
      else if ((match = new RegExp(`^DROP TABLE\\s+${identifier}$`, "i").exec(sql))) {
        const name = nameOf(match); requireTable(name); tables.delete(name);
        operations.push({ tableName: name, operation: "drop-table", path: pin.path, statementIndex });
      } else if (/^(?:CREATE|DROP) TEMPORARY TABLE\b/i.test(sql)) {
        const allowed = temporarySources[entry.fileName];
        insist(allowed && allowed.sha256 === pin.sha256, "COLUMN_ORDER_TEMPORARY_SOURCE_UNREVIEWED");
        if (sql.startsWith(`CREATE TEMPORARY TABLE \`${allowed.table}\` AS\n`)) {
          insist(!temporary.has(allowed.table), "COLUMN_ORDER_TEMPORARY_DUPLICATE"); temporary.add(allowed.table);
        } else {
          insist(sql === `DROP TEMPORARY TABLE \`${allowed.table}\`` && temporary.has(allowed.table), "COLUMN_ORDER_TEMPORARY_UNSUPPORTED");
          temporary.delete(allowed.table);
        }
        ignoredStatements.push({ path: pin.path, statementIndex, kind: "reviewed-temporary-table" });
      } else if (/^DROP INDEX\b/i.test(sql)) {
        // This source-pinned fresh-only repair temporarily removes the old
        // non-unique index before its indexed column is widened. It cannot
        // change column names/order; any different standalone DROP fails.
        insist(entry.fileName === "bootstrap/0004_current_source_alignment.sql"
          && sql === "DROP INDEX `idx_sh_asin_week` ON `saihu_product_weekly`", "COLUMN_ORDER_INDEX_DROP_UNREVIEWED");
        touch(requireTable("saihu_product_weekly"), pin);
        ignoredStatements.push({ path: pin.path, statementIndex, kind: "reviewed-index-drop",
          tableName: "saihu_product_weekly", indexName: "idx_sh_asin_week" });
      } else if (/^(?:INSERT\s+(?:IGNORE\s+)?INTO|UPDATE\s|DELETE\s|SET\s+@[A-Za-z_][A-Za-z0-9_]*\s*=|CREATE\s+(?:UNIQUE\s+)?INDEX\s)/i.test(sql)) {
        ignoredStatements.push({ path: pin.path, statementIndex, kind: "non-column-operation" });
      } else throw Object.assign(new Error("COLUMN_ORDER_STATEMENT_UNSUPPORTED"), {
        code: "COLUMN_ORDER_STATEMENT_UNSUPPORTED", path: pin.path, statementIndex,
        operation: sql.match(/^[A-Za-z_ ]+/)?.[0].trim(),
      });
    }
  }
  insist(temporary.size === 0, "COLUMN_ORDER_TEMPORARY_UNFINISHED");
  return { tables: [...tables].map(([name, table]) => ({ name, columns: table.columns, sources: [...table.sources.values()] }))
    .sort((a, b) => a.name.localeCompare(b.name)), operations, ignoredStatements };
}

export function deriveHistoricalColumnOrder({ bundle, expectedColumns, splitPublicStatements, splitDefinitionList }) {
  insist(bundle?.version === "amazon-fresh-bootstrap/1" && bundle.plan?.length === EXPECTED_BOOTSTRAP_PLAN_LENGTH
    && bundle.manifest?.requiredBusinessTables?.length === 302, "COLUMN_ORDER_BUNDLE_INVALID");
  const names = bundle.manifest.requiredBusinessTables;
  insist(new Set(names).size === 302 && names.every(safeName)
    && expectedColumns && isDeepStrictEqual(Object.keys(expectedColumns).sort(), [...names].sort()), "COLUMN_ORDER_EXPECTED_TABLES_INVALID");
  insist(fingerprint(bundle.plan.map(item => [item.fileName, item.checksum])) === bundle.planSha256
    && bundle.planSha256 === bundle.manifest.planSha256
    && fingerprint(bundle.manifest.sources) === bundle.sourcesSha256, "COLUMN_ORDER_PLAN_CHANGED");
  const pins = new Map(bundle.manifest.sources.map(item => [item.path, item.sha256]));
  insist(pins.size === bundle.manifest.sources.length, "COLUMN_ORDER_SOURCE_PINS_DUPLICATE");
  const replay = replayPublicColumnOrder({ plan: bundle.plan, pins, splitPublicStatements, splitDefinitionList });
  insist(isDeepStrictEqual(replay.tables.map(item => item.name).sort(), [...names].sort()), "COLUMN_ORDER_REPLAY_TABLE_SET_MISMATCH");
  for (const item of replay.tables) {
    const expected = expectedColumns[item.name];
    insist(Array.isArray(expected) && expected.length && expected.every(safeName) && new Set(expected).size === expected.length,
      "COLUMN_ORDER_EXPECTED_COLUMNS_INVALID");
    if (!isDeepStrictEqual([...item.columns].sort(), [...expected].sort())) {
      throw Object.assign(new Error("COLUMN_ORDER_SOURCE_COLUMN_SET_MISMATCH"), { code: "COLUMN_ORDER_SOURCE_COLUMN_SET_MISMATCH", tableName: item.name,
        missingFromHistorical: expected.filter(name => !item.columns.includes(name)), missingFromCurrentSource: item.columns.filter(name => !expected.includes(name)) });
    }
  }
  return { version: COLUMN_ORDER_VERSION, bootstrapPlanSha256: bundle.planSha256, bootstrapSourcesSha256: bundle.sourcesSha256,
    databaseConnected: false, sqlExecuted: false, productionDdlUsed: false, candidateDatabaseUsed: false,
    changedOrderTableNames: replay.tables.filter(item => !isDeepStrictEqual(item.columns, expectedColumns[item.name])).map(item => item.name),
    ...replay };
}
