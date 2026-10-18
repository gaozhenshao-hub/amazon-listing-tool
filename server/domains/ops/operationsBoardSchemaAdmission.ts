import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DbExecutor } from "../../repositories/dbClient";
import {
  OPERATIONS_BOARD_SCHEMA_CANDIDATE, planOperationsBoardSchema,
  type OperationsBoardSchemaIndex, type OperationsBoardSchemaTable,
} from "../../../scripts/integration/operationsBoardSchemaPlan.mjs";

// These names constrain the introspection scope, not a second schema spec.
// All structural compatibility decisions remain in the pure 0313 planner.
const tables = ["ops_board_states", "ops_board_editions", "ops_board_notes", "ops_board_partner_pairs"] as const;
const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_$]{0,63}$/u);
const tableName = z.enum(tables);
const metadataBase = z.object({ schemaName: identifier, tableName });
const tableRow = metadataBase.extend({ tableType: z.literal("BASE TABLE"), engine: z.string().min(1).max(64), collation: z.string().min(1).max(64) }).strict();
const columnRow = metadataBase.extend({
  columnName: identifier, ordinal: z.number().int().min(1).max(400), dataType: z.string().regex(/^[a-z]+$/u), columnType: z.string().min(1).max(1000),
  isNullable: z.enum(["YES", "NO"]), defaultValue: z.union([z.string().max(1000), z.number().finite(), z.null()]),
  extra: z.string().max(200), collation: z.string().min(1).max(64).nullable(),
}).strict();
const indexRow = metadataBase.extend({
  indexName: identifier, nonUnique: z.union([z.literal(0), z.literal(1)]), sequence: z.number().int().min(1).max(64),
  columnName: identifier, prefixLength: z.number().int().positive().max(65535).nullable(), indexType: z.string().min(1).max(64),
}).strict();
function fail(reason: "DATABASE_UNVERIFIED" | "METADATA_INVALID" | "READ_UNAVAILABLE" | "MIGRATION_REQUIRED" | "INCOMPATIBLE"): never {
  // No raw SQL, database identifier, driver error/cause or schema dump crosses
  // the API boundary. This gate does not approve any of the data/release gates.
  throw new TRPCError({ code: "PRECONDITION_FAILED", message: `OPERATIONS_BOARD_SCHEMA_${reason}` });
}
async function readRows(tx: DbExecutor, query: SQL, limit: number): Promise<unknown[]> {
  let result: unknown;
  try { result = await tx.execute(query); } catch { return fail("READ_UNAVAILABLE"); }
  if (!Array.isArray(result) || result.length !== 2 || !Array.isArray(result[0]) || !Array.isArray(result[1])
    || result[0].length > limit || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) fail("METADATA_INVALID");
  return result[0];
}
function parseRows<S extends z.ZodTypeAny>(schema: S, rows: unknown[]): z.infer<S>[] {
  const parsed = z.array(schema).safeParse(rows);
  if (!parsed.success) fail("METADATA_INVALID");
  return parsed.data;
}

/** Read-only structural admission in the caller's existing transaction. No own
 * connection/transaction, DDL, data scan, migration approval or hidden repair. */
export async function assertOperationsBoardSchema(tx: DbExecutor): Promise<void> {
  if (!tx || typeof tx.execute !== "function") fail("READ_UNAVAILABLE");
  const databaseRows = await readRows(tx, sql`SELECT DATABASE() AS databaseName`, 1);
  const database = z.array(z.object({ databaseName: identifier }).strict()).length(1).safeParse(databaseRows);
  if (!database.success) fail("DATABASE_UNVERIFIED");
  const databaseName = database.data[0].databaseName;
  const tableNames = sql.join(tables.map(name => sql`${name}`), sql`, `);
  const foundTables = parseRows(tableRow, await readRows(tx, sql`
    SELECT TABLE_SCHEMA AS schemaName,TABLE_NAME AS tableName,TABLE_TYPE AS tableType,ENGINE AS engine,TABLE_COLLATION AS collation
    FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tableNames})
    ORDER BY TABLE_NAME LIMIT 5`, 4));
  const foundColumns = parseRows(columnRow, await readRows(tx, sql`
    SELECT TABLE_SCHEMA AS schemaName,TABLE_NAME AS tableName,COLUMN_NAME AS columnName,ORDINAL_POSITION AS ordinal,
      DATA_TYPE AS dataType,COLUMN_TYPE AS columnType,IS_NULLABLE AS isNullable,COLUMN_DEFAULT AS defaultValue,EXTRA AS extra,COLLATION_NAME AS collation
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tableNames})
    ORDER BY TABLE_NAME,ORDINAL_POSITION LIMIT 401`, 400));
  // INDEX_TYPE is available on both MySQL 5.7 and 8. Do not query the 8-only
  // IS_VISIBLE column and accidentally reject every 5.7 deployment.
  const foundIndexes = parseRows(indexRow, await readRows(tx, sql`
    SELECT TABLE_SCHEMA AS schemaName,TABLE_NAME AS tableName,INDEX_NAME AS indexName,NON_UNIQUE AS nonUnique,
      SEQ_IN_INDEX AS sequence,COLUMN_NAME AS columnName,SUB_PART AS prefixLength,INDEX_TYPE AS indexType
    FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tableNames})
    ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX LIMIT 6401`, 6400));
  if ([...foundTables, ...foundColumns, ...foundIndexes].some(row => row.schemaName !== databaseName)
    || new Set(foundTables.map(row => row.tableName)).size !== foundTables.length) fail("METADATA_INVALID");
  const snapshotTables: OperationsBoardSchemaTable[] = tables.map(name => {
    const current = foundTables.find(row => row.tableName === name);
    const columns = foundColumns.filter(row => row.tableName === name).sort((a, b) => a.ordinal - b.ordinal);
    const indexRows = foundIndexes.filter(row => row.tableName === name);
    if (!current) {
      // Rows in COLUMNS/STATISTICS contradict table absence, so do not turn
      // partial or malformed metadata into permission to create a table.
      if (columns.length || indexRows.length) fail("METADATA_INVALID");
      return { name, complete: true, exists: false };
    }
    if (!columns.length || !indexRows.length || columns.some((column, index) => column.ordinal !== index + 1
      || column.columnType.toLowerCase().match(/^[a-z]+/u)?.[0] !== column.dataType)) fail("METADATA_INVALID");
    const indexes: OperationsBoardSchemaIndex[] = [];
    for (const indexName of new Set(indexRows.map(row => row.indexName))) {
      const entries = indexRows.filter(row => row.indexName === indexName).sort((a, b) => a.sequence - b.sequence), first = entries[0];
      if (entries.some((entry, index) => entry.sequence !== index + 1 || entry.nonUnique !== first.nonUnique || entry.indexType !== first.indexType)) fail("METADATA_INVALID");
      indexes.push({ name: indexName, unique: first.nonUnique === 0, columns: entries.map(entry => entry.columnName), prefixLengths: entries.map(entry => entry.prefixLength), type: first.indexType });
    }
    return { name, complete: true, exists: true, engine: current.engine, collation: current.collation,
      columns: columns.map(column => ({ name: column.columnName, type: column.columnType, nullable: column.isNullable === "YES", defaultValue: column.defaultValue, extra: column.extra, collation: column.collation })), indexes };
  });
  let plan;
  try { plan = planOperationsBoardSchema({ complete: true, databaseVerified: true, reservedFile: OPERATIONS_BOARD_SCHEMA_CANDIDATE, tables: snapshotTables }); }
  catch { return fail("INCOMPATIBLE"); }
  if (plan.state !== "structure_ready" || plan.statements.length !== 0) fail("MIGRATION_REQUIRED");
}
