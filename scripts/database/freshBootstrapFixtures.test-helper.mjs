// Shape-only fixtures for controlled tests; never an approved application catalog.
import { DDL_CATALOG } from "../integration/exportProductionDdl.mjs";
import { buildStructureContract, loadFreshBootstrapPlan } from "./freshBootstrapPlan.mjs";
const bundle = loadFreshBootstrapPlan();
export function catalogFixture(schema = "amazon_listing_ci") {
  const catalog = Object.fromEntries(Object.keys(DDL_CATALOG).map(key => [key, []]));
  catalog.schema = [{ schemaName: schema, characterSetName: "utf8mb4", collationName: "utf8mb4_0900_ai_ci", defaultEncryption: "NO" }];
  for (const tableName of [...bundle.manifest.requiredBusinessTables, "app_schema_migrations"].sort()) {
    catalog.tables.push({ tableName, tableType: "BASE TABLE", engine: "InnoDB", version: 10, rowFormat: "Dynamic",
      autoIncrement: 1, collationName: "utf8mb4_0900_ai_ci", createOptions: "", tableComment: "" });
    catalog.columns.push({ tableName, columnName: "id", ordinalPosition: 1, columnDefault: null, isNullable: "NO", dataType: "int",
      columnType: "int", characterMaximumLength: null, characterOctetLength: null, numericPrecision: 10, numericScale: 0,
      datetimePrecision: null, characterSetName: null, collationName: null, columnKey: "PRI", extra: "auto_increment",
      columnComment: "", generationExpression: "", srsId: null });
    catalog.indexes.push({ tableName, indexName: "PRIMARY", nonUnique: 0, sequence: 1, columnName: "id", direction: "A",
      prefixLength: null, packed: null, nullable: "", indexType: "BTREE", comment: "", indexComment: "", visible: "YES", expression: null });
    catalog.constraints.push({ tableName, constraintName: "PRIMARY", constraintType: "PRIMARY KEY", enforced: "YES" });
    catalog.keyColumns.push({ tableName, constraintName: "PRIMARY", columnName: "id", ordinalPosition: 1,
      uniqueConstraintPosition: null, referencedTableSchema: null, referencedTableName: null, referencedColumnName: null });
  }
  return catalog;
}
export function contractFixture(catalog = catalogFixture()) {
  return buildStructureContract({ bundle, catalog,
    platform: { mysqlMajorMinor: "8.0", lowerCaseTableNames: 0, schemaCharacterSet: "utf8mb4", schemaCollation: "utf8mb4_0900_ai_ci" },
    derivation: { kind: "public-source-projection-plus-reviewed-history", candidateDatabaseUsed: false, productionDdlUsed: false,
      tables: catalog.tables.map(table => ({ name: table.tableName, sources: [bundle.manifest.sources[0]] })) } });
}
