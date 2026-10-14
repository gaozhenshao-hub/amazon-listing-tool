// Pure SHOW CREATE rendering normalization, never schema repair or SQL execution.
import { normalizeCreateTable } from "./mysqlSnapshotRehearsal.mjs";

const requireSafe = (condition, code) => {
  if (!condition) throw Object.assign(new Error(code), { code });
};

// Retain source offsets and quoted/comment tokens. Keywords inside literals,
// identifiers, comments or nested expressions must never become rewrite targets.
function tokenize(sql) {
  const tokens = [];
  for (let cursor = 0; cursor < sql.length;) {
    if (/\s/.test(sql[cursor])) { cursor++; continue; }
    const start = cursor, char = sql[cursor];
    if (sql.startsWith("/*", cursor)) {
      const end = sql.indexOf("*/", cursor + 2);
      requireSafe(end >= 0, "DDL_UNTERMINATED_COMMENT");
      cursor = end + 2;
      tokens.push({ kind: "comment", start, end: cursor, text: sql.slice(start, cursor) });
    } else if (char === "#" || (sql.startsWith("--", cursor) && /\s|^$/.test(sql[cursor + 2] ?? ""))) {
      const end = sql.indexOf("\n", cursor);
      cursor = end < 0 ? sql.length : end + 1;
      tokens.push({ kind: "comment", start, end: cursor, text: sql.slice(start, cursor) });
    } else if (["'", '"', "`"].includes(char)) {
      cursor++;
      let value = "", closed = false;
      while (cursor < sql.length) {
        const next = sql[cursor++];
        if (next === "\\") {
          requireSafe(cursor < sql.length, "DDL_UNTERMINATED_QUOTE");
          value += sql[cursor++];
        } else if (next === char && sql[cursor] === char) { value += char; cursor++; }
        else if (next === char) { closed = true; break; }
        else value += next;
      }
      requireSafe(closed, "DDL_UNTERMINATED_QUOTE");
      tokens.push({ kind: char === "`" ? "identifier" : "literal", start, end: cursor, value, text: sql.slice(start, cursor) });
    } else if (/[A-Za-z_$]/.test(char)) {
      cursor++;
      while (cursor < sql.length && /[A-Za-z0-9_$]/.test(sql[cursor])) cursor++;
      tokens.push({ kind: "word", start, end: cursor, text: sql.slice(start, cursor) });
    } else {
      cursor++;
      tokens.push({ kind: "symbol", start, end: cursor, text: char });
    }
  }
  return tokens;
}

const word = (token, value) => token?.kind === "word" && token.text.toUpperCase() === value;
const identifier = token => token?.kind === "identifier" ? token.value : token?.kind === "word" ? token.text : undefined;
const tableConstraint = token => token?.kind === "word"
  && /^(CONSTRAINT|PRIMARY|UNIQUE|KEY|INDEX|FULLTEXT|SPATIAL|FOREIGN|CHECK)$/i.test(token.text);

function catalogMap(columns) {
  requireSafe(Array.isArray(columns) && columns.length > 0, "DDL_COLUMN_CATALOG_REQUIRED");
  const result = new Map();
  for (const row of columns) {
    requireSafe(row && typeof row.columnName === "string" && row.columnName.length > 0
      && Object.hasOwn(row, "characterSetName") && Object.hasOwn(row, "collationName")
      && (row.characterSetName === null || typeof row.characterSetName === "string")
      && (row.collationName === null || typeof row.collationName === "string")
      && !result.has(row.columnName), "DDL_COLUMN_CATALOG_INVALID");
    result.set(row.columnName, row);
  }
  return result;
}

// The existing whitespace normalizer preserves quotes but not SQL comments.
// Protect comments as opaque quoted tokens and restore their original bytes,
// including a line comment's terminating newline, after formatting.
function normalizePreservingComments(sql) {
  const comments = tokenize(sql).filter(token => token.kind === "comment");
  if (!comments.length) return normalizeCreateTable(sql);
  let prefix = "__snapshot_ddl_comment_";
  while (sql.includes(prefix)) prefix += "_";
  let masked = sql;
  const replacements = comments.map((token, index) => ({ ...token, marker: `'${prefix}${index}__'` }));
  for (const { start, end, marker } of [...replacements].reverse()) masked = masked.slice(0, start) + marker + masked.slice(end);
  let normalized = normalizeCreateTable(masked);
  for (const { marker, text } of replacements) normalized = normalized.replace(marker, text);
  return normalized;
}

export function normalizeSnapshotCreateTable(rawSql, columns) {
  requireSafe(typeof rawSql === "string" && /^\s*CREATE\s+TABLE\b/i.test(rawSql), "CREATE_TABLE_EXPECTED");
  const catalog = catalogMap(columns), tokens = tokenize(rawSql), removals = [], seenColumns = new Set();
  const open = tokens.findIndex(token => token.kind === "symbol" && token.text === "(");
  requireSafe(open >= 3 && word(tokens[0], "CREATE") && word(tokens[1], "TABLE"), "DDL_TABLE_BODY_REQUIRED");
  let depth = 1, start = open + 1, closed = false;

  const inspectDefinition = definition => {
    const first = definition.findIndex(token => token.kind !== "comment");
    requireSafe(first >= 0, "DDL_EMPTY_DEFINITION");
    if (tableConstraint(definition[first])) return;
    const name = identifier(definition[first]), row = catalog.get(name);
    requireSafe(name !== undefined && row && !seenColumns.has(name), "DDL_COLUMN_CATALOG_MISSING_OR_DUPLICATE");
    seenColumns.add(name);
    let nested = 0, candidates = 0;
    for (let index = first + 1; index < definition.length; index++) {
      const token = definition[index];
      if (token.kind === "symbol" && token.text === "(") { nested++; continue; }
      if (token.kind === "symbol" && token.text === ")") { nested--; continue; }
      if (nested !== 0 || !word(token, "CHARACTER") || !word(definition[index + 1], "SET")) continue;
      const charset = definition[index + 2], collate = definition[index + 3], collation = definition[index + 4];
      // A standalone CHARACTER SET clause, or a clause separated by a comment,
      // is not the tightly scoped rendering redundancy admitted here.
      if (charset?.kind !== "word" || !word(collate, "COLLATE") || collation?.kind !== "word") continue;
      requireSafe(++candidates === 1, "DDL_MULTIPLE_CHARACTER_SET_CLAUSES");
      requireSafe(row.characterSetName === charset.text && row.collationName === collation.text,
        "DDL_CHARACTER_SET_CATALOG_MISMATCH");
      removals.push({ start: token.start, end: collate.start });
    }
  };

  for (let index = open + 1; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind !== "symbol") continue;
    if (token.text === "(") depth++;
    else if (token.text === ")") {
      depth--;
      if (depth === 0) { inspectDefinition(tokens.slice(start, index)); closed = true; break; }
    } else if (token.text === "," && depth === 1) { inspectDefinition(tokens.slice(start, index)); start = index + 1; }
  }
  requireSafe(closed, "DDL_UNTERMINATED_TABLE_BODY");
  requireSafe(seenColumns.size === catalog.size, "DDL_COLUMN_CATALOG_EXTRA_COLUMNS");
  let normalized = rawSql;
  for (const removal of removals.sort((a, b) => b.start - a.start)) {
    normalized = normalized.slice(0, removal.start) + normalized.slice(removal.end);
  }
  return normalizePreservingComments(normalized);
}
