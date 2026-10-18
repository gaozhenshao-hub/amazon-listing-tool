export const OPERATIONS_BOARD_SCHEMA_CANDIDATE: "0313_integration_ops_profit_board.sql";
export const OPERATIONS_BOARD_LEGACY_TABLES: readonly string[];
export const OPERATIONS_BOARD_SCHEMA_DDL: readonly string[];

export interface OperationsBoardSchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | number | null;
  extra: string;
  collation?: string | null;
}
export interface OperationsBoardSchemaIndex {
  name: string;
  columns: string[];
  unique: boolean;
  prefixLengths: (number | null)[];
  type?: string;
  visible?: boolean;
}
export type OperationsBoardSchemaTable = {
  name: string;
  complete: true;
  exists: false;
  engine?: null;
  collation?: null;
  columns?: [];
  indexes?: [];
} | {
  name: string;
  complete: true;
  exists: true;
  engine: string;
  collation: string;
  columns: OperationsBoardSchemaColumn[];
  indexes: OperationsBoardSchemaIndex[];
};
export interface OperationsBoardSchemaSnapshot {
  complete: true;
  databaseVerified: true;
  reservedFile: typeof OPERATIONS_BOARD_SCHEMA_CANDIDATE;
  tables: OperationsBoardSchemaTable[];
}
export interface OperationsBoardSchemaPlan {
  candidate: typeof OPERATIONS_BOARD_SCHEMA_CANDIDATE;
  state: "migration_required" | "structure_ready";
  statements: string[];
  executable: false;
  productionApproved: false;
  ledgerRegistration: "unchanged";
  sourceTablesModified: false;
  businessRowsModified: false;
  scheduleSeeding: "none";
  verificationScope: string;
  legacyMigration: { status: "requires_reconciliation"; tables: string[]; statements: [] };
  remainingGates: string[];
  rollback: string;
}
/** Throws on an incomplete or incompatible snapshot; never performs I/O. */
export function planOperationsBoardSchema(snapshot: OperationsBoardSchemaSnapshot): OperationsBoardSchemaPlan;
