import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSnapshotCreateTable } from "./snapshotDdlNormalization.mjs";
import { normalizeCreateTable } from "./mysqlSnapshotRehearsal.mjs";

const character = (columnName = "label", characterSetName = "utf8mb4", collationName = "utf8mb4_bin") => ({ columnName, characterSetName, collationName });
const binary = columnName => ({ columnName, characterSetName: null, collationName: null });
const table = definition => `CREATE TABLE \`example\` (${definition}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`;
const clause = "CHARACTER SET utf8mb4 COLLATE utf8mb4_bin";

test("normalizes only catalog-proven redundant column charset", () => {
  const before = table("`id` int NOT NULL, `label` varchar(30) COLLATE utf8mb4_bin NOT NULL, PRIMARY KEY (`id`)");
  const restored = table(`\`id\` int NOT NULL, \`label\` varchar(30) ${clause} NOT NULL, PRIMARY KEY (\`id\`)`);
  const catalog = [binary("id"), character()];
  assert.equal(normalizeSnapshotCreateTable(restored, catalog), normalizeSnapshotCreateTable(before, catalog));
  assert.equal(normalizeSnapshotCreateTable(restored, catalog), normalizeCreateTable(before));
});

test("preserves ENUM members, commas, parentheses, doubled quotes and escaped quotes", () => {
  const literal = "enum('a,b','(x)','CHARACTER SET utf8mb4 COLLATE utf8mb4_bin','O''Brien','it\\'s','back\\\\slash')";
  const input = table(`\`label\` ${literal} ${clause} DEFAULT 'CHARACTER SET utf8mb4 COLLATE utf8mb4_bin' COMMENT 'keep  two spaces'`);
  const expected = table(`\`label\` ${literal} COLLATE utf8mb4_bin DEFAULT 'CHARACTER SET utf8mb4 COLLATE utf8mb4_bin' COMMENT 'keep  two spaces'`);
  assert.equal(normalizeSnapshotCreateTable(input, [character()]), normalizeCreateTable(expected));
});

test("preserves double-quoted defaults and backtick identifiers, including doubled backticks", () => {
  const input = table('`weird``name` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT "a\\" CHARACTER SET utf8mb4 COLLATE utf8mb4_bin", KEY `CHARACTER SET utf8mb4 COLLATE utf8mb4_bin` (`weird``name`)');
  assert.equal(normalizeSnapshotCreateTable(input, [character("weird`name")]),
    normalizeCreateTable(input.replace("varchar(30) CHARACTER SET utf8mb4", "varchar(30)")));
});

test("does not rewrite CHARACTER SET inside nested expressions", () => {
  const input = table("`label` varchar(30) GENERATED ALWAYS AS (CAST('x' AS CHAR CHARACTER SET utf8mb4 COLLATE utf8mb4_bin)) STORED");
  assert.equal(normalizeSnapshotCreateTable(input, [character()]), normalizeCreateTable(input));
});

test("retains standalone charset and non-adjacent clauses", () => {
  for (const definition of [
    "`label` varchar(30) CHARACTER SET utf8mb4",
    "`label` varchar(30) CHARACTER SET utf8mb4 NOT NULL COLLATE utf8mb4_bin",
    "`label` varchar(30) COLLATE utf8mb4_bin",
  ]) assert.equal(normalizeSnapshotCreateTable(table(definition), [character()]), normalizeCreateTable(table(definition)));
});

test("preserves block comments exactly and does not normalize across comments", () => {
  const input = table("`label` varchar(30) CHARACTER SET utf8mb4 /* keep  \"quotes\" and  two spaces */ COLLATE utf8mb4_bin COMMENT 'ok'");
  assert.equal(normalizeSnapshotCreateTable(input, [character()]), input);
  const withComment = table(`\`label\` varchar(30) ${clause} /* CHARACTER SET utf8mb4 COLLATE utf8mb4_bin */`);
  assert.equal(normalizeSnapshotCreateTable(withComment, [character()]),
    table("`label` varchar(30) COLLATE utf8mb4_bin /* CHARACTER SET utf8mb4 COLLATE utf8mb4_bin */"));
});

test("preserves line comment terminators and ignores fake syntax inside comments", () => {
  const input = table(`\`label\` varchar(30) ${clause} -- comma, ) 'unterminated quote in comment\n NOT NULL`);
  const output = normalizeSnapshotCreateTable(input, [character()]);
  assert.ok(output.includes("-- comma, ) 'unterminated quote in comment\n"));
  assert.ok(output.endsWith("NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin"));
  assert.ok(!output.includes("varchar(30) CHARACTER SET"));
});

test("preserves table options, indexes, defaults, and character differences", () => {
  const source = table(`\`label\` varchar(30) ${clause} DEFAULT 'x', UNIQUE KEY \`uq_label\` (\`label\`(12))`).replace("ENGINE=InnoDB", "ENGINE=InnoDB AUTO_INCREMENT=29");
  const normalized = normalizeSnapshotCreateTable(source, [character()]);
  assert.ok(normalized.includes("AUTO_INCREMENT=29"));
  assert.ok(normalized.includes("UNIQUE KEY `uq_label` (`label`(12))"));
  assert.ok(normalized.includes("DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin"));
  assert.notEqual(normalizeSnapshotCreateTable(source.replace("DEFAULT 'x'", "DEFAULT 'y'"), [character()]), normalized);
  const changed = source.replaceAll("utf8mb4_bin", "utf8mb4_unicode_ci");
  assert.notEqual(normalizeSnapshotCreateTable(changed, [character("label", "utf8mb4", "utf8mb4_unicode_ci")]), normalized);
});

test("rejects missing, duplicate, extra, or incomplete catalog", () => {
  const input = table(`\`label\` varchar(30) ${clause}`);
  for (const catalog of [undefined, [], [character("different")], [character(), character()], [character(), binary("extra")], [{ columnName: "label", characterSetName: "utf8mb4" }]]) {
    assert.throws(() => normalizeSnapshotCreateTable(input, catalog), error => /^DDL_COLUMN_CATALOG/.test(error.code));
  }
});

test("rejects mismatched charset/collation instead of masking a real difference", () => {
  const input = table(`\`label\` varchar(30) ${clause}`);
  for (const catalog of [character("label", "latin1", "latin1_bin"), character("label", "utf8mb4", "utf8mb4_unicode_ci"), binary("label")]) {
    assert.throws(() => normalizeSnapshotCreateTable(input, [catalog]), { code: "DDL_CHARACTER_SET_CATALOG_MISMATCH" });
  }
});

test("handles distinct per-column charsets and leaves BINARY syntax alone", () => {
  const input = table("`label` varchar(30) CHARACTER SET latin1 COLLATE latin1_bin, `body` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci, `payload` varbinary(20)");
  const output = normalizeSnapshotCreateTable(input, [character("label", "latin1", "latin1_bin"), character("body", "utf8mb4", "utf8mb4_unicode_ci"), binary("payload")]);
  assert.ok(output.includes("`label` varchar(30) COLLATE latin1_bin"));
  assert.ok(output.includes("`body` text COLLATE utf8mb4_unicode_ci"));
  assert.ok(output.includes("`payload` varbinary(20)"));
});

test("rejects malformed SHOW CREATE rather than partially normalizing", () => {
  for (const input of [
    "SELECT 1",
    "CREATE TABLE `example` (`label` varchar(30)",
    "CREATE TABLE `example` (`label` varchar(30) COMMENT 'unterminated)",
    "CREATE TABLE `example` (`label` varchar(30) /* unterminated)",
    table(`\`label\` varchar(30) ${clause} ${clause}`),
  ]) assert.throws(() => normalizeSnapshotCreateTable(input, [character()]));
});
