import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { TrpcContext } from "../../_core/context";
import { requireDb, type DbExecutor } from "../../repositories/dbClient";
import { assertResourceAction } from "../../services/securityGovernance";
import {
  OperationsBoardPartnersExecuteInputSchema, OperationsBoardPartnersOptionsInputSchema, OperationsBoardPartnersOptionsResultSchema,
  OperationsBoardPartnersRecoverInputSchema, OperationsBoardPartnersWriteResultSchema, operationsBoardPartnersRequestHash,
  type OperationsBoardPartnersExecuteInput, type OperationsBoardPartnersOptionsInput, type OperationsBoardPartnersRecoverInput, type OperationsBoardPartnersWriteResult,
} from "../../../shared/operationsBoardPartners";
import { authorizeOperationsBoardAccess, type OperationsBoardAccessSession } from "./operationsBoardAccess";
import { assertOperationsBoardSchema } from "./operationsBoardSchemaAdmission";
import { assertOperationsBoardOperationJournalSchema, OperationsBoardOperationJournalError } from "./operationsBoardOperationJournal";
import { createOperationsBoardPartnerJournal, OperationsBoardPartnerJournalError } from "./operationsBoardPartnerJournal";
import { createOperationsBoardPartnerStore, OperationsBoardPartnerStoreError } from "./operationsBoardPartnerStore";

export interface OperationsBoardPartnerDatabase { transaction<T>(callback: (tx: DbExecutor) => Promise<T>): Promise<T> }
const id = z.number().int().positive().max(2147483647);
type Identity = { workspaceId: number; userId: number };
function fail(reason: string, code: "UNAUTHORIZED" | "FORBIDDEN" | "CONFLICT" | "PRECONDITION_FAILED" = "PRECONDITION_FAILED"): never {
  throw new TRPCError({ code, message: `OPERATIONS_BOARD_PARTNERS_${reason}` });
}
function sanitized(error: unknown): never {
  if (error instanceof TRPCError && /^(?:OPERATIONS_BOARD_ACCESS_|OPERATIONS_BOARD_SCHEMA_|OPERATIONS_BOARD_PARTNERS_)[A-Z0-9_]+$/u.test(error.message)) throw error;
  if (error instanceof OperationsBoardPartnerStoreError || error instanceof OperationsBoardPartnerJournalError || error instanceof OperationsBoardOperationJournalError) {
    if (/CONFLICT|CANCELLED/u.test(error.code)) fail(error.code, "CONFLICT");
    fail(error.code);
  }
  fail("UNAVAILABLE");
}
function uncertain(error: unknown): boolean {
  if (error instanceof TRPCError) return !/^(?:OPERATIONS_BOARD_ACCESS_|OPERATIONS_BOARD_SCHEMA_|OPERATIONS_BOARD_PARTNERS_)[A-Z0-9_]+$/u.test(error.message);
  if (error instanceof OperationsBoardPartnerStoreError || error instanceof OperationsBoardPartnerJournalError || error instanceof OperationsBoardOperationJournalError)
    return /STORAGE_UNKNOWN|WRITE_FAILED|WRITE_UNCONFIRMED|READBACK_MISMATCH|WRITE_CONFLICT|READ_FAILED|JOURNAL_READ_INVALID/u.test(error.code);
  return true;
}
function unknown(identity: Identity, operationId: string): OperationsBoardPartnersWriteResult {
  return OperationsBoardPartnersWriteResultSchema.parse({ identity, operationId, status: "unknown", requestHash: null, pair: null, reasonCode: "outcome_unknown_check_same_operation" });
}

export function createOperationsBoardPartnerRepository(dependencies: {
  database?: () => Promise<OperationsBoardPartnerDatabase | null>; permission?: typeof assertResourceAction; enabled?: () => boolean;
  schema?: typeof assertOperationsBoardSchema; store?: typeof createOperationsBoardPartnerStore; journal?: typeof createOperationsBoardPartnerJournal;
} = {}) {
  const database = dependencies.database ?? (() => requireDb("Operations board partners")), permission = dependencies.permission ?? assertResourceAction;
  const enabled = dependencies.enabled ?? (() => process.env.ENABLE_MERGED_OPS_BOARD_EDITIONS === "true"), schema = dependencies.schema ?? assertOperationsBoardSchema;
  const store = dependencies.store ?? createOperationsBoardPartnerStore, journal = dependencies.journal ?? createOperationsBoardPartnerJournal;
  async function session<T>(ctx: TrpcContext, expectedWorkspaceId: number, body: (current: OperationsBoardAccessSession) => Promise<T>): Promise<T> {
    if (!ctx.user) fail("LOGIN_REQUIRED", "UNAUTHORIZED");
    const workspaceId = ctx.workspaceId !== undefined ? ctx.workspaceId : ctx.user.defaultWorkspaceId;
    if (!id.safeParse(ctx.user.id).success || !id.safeParse(workspaceId).success || workspaceId !== expectedWorkspaceId
      || !["admin", "super_admin"].includes(ctx.user.role)) fail("ACTOR_INVALID", "FORBIDDEN");
    const db = await database(); if (!db || typeof db.transaction !== "function") fail("TRANSACTION_REQUIRED");
    return db.transaction(async tx => {
      const current = await authorizeOperationsBoardAccess(tx, { identity: { userId: ctx.user!.id, workspaceId: expectedWorkspaceId }, expectedRole: ctx.user!.role, operation: "assign", write: true }, permission);
      return body(current);
    });
  }
  function log(current: OperationsBoardAccessSession, operationId: string) {
    return journal(current.tx, { identity: current.identity, operationId, actorRole: current.role });
  }
  async function options(ctx: TrpcContext, raw: OperationsBoardPartnersOptionsInput) {
    const input = OperationsBoardPartnersOptionsInputSchema.parse(raw);
    try { return await session(ctx, input.expectedWorkspaceId, async current => {
      await schema(current.tx); await assertOperationsBoardOperationJournalSchema(current.tx);
      const data = store({ tx: current.tx, identity: current.identity, role: current.role });
      const pairs = await data.loadAll(), members = await data.members(), available = enabled();
      return OperationsBoardPartnersOptionsResultSchema.parse({ identity: current.identity, request: input, pairs, members,
        capability: { available, reasonCode: available ? null : "not_enabled_before_release" } });
    }); } catch (error) { return sanitized(error); }
  }
  async function execute(ctx: TrpcContext, raw: OperationsBoardPartnersExecuteInput): Promise<OperationsBoardPartnersWriteResult> {
    const input = OperationsBoardPartnersExecuteInputSchema.parse(raw), requestHash = operationsBoardPartnersRequestHash(input); let captured: Identity | null = null;
    try { return await session(ctx, input.expectedWorkspaceId, async current => {
      captured = current.identity;
      const operation = log(current, input.operationId), existing = await operation.read();
      if (existing.final) {
        if (existing.final.requestHash !== null && existing.final.requestHash !== requestHash) fail("OPERATION_CONTENT_CONFLICT", "CONFLICT");
        return existing.final;
      }
      if (!enabled()) fail("NOT_ENABLED"); await schema(current.tx);
      if (!enabled()) fail("NOT_ENABLED");
      const pair = await store({ tx: current.tx, identity: current.identity, role: current.role }).setPair(input);
      if (!enabled()) fail("NOT_ENABLED");
      return operation.finalize(OperationsBoardPartnersWriteResultSchema.parse({ identity: current.identity, operationId: input.operationId,
        status: "committed", requestHash, pair, reasonCode: null }));
    }); } catch (error) { if (captured && uncertain(error)) return unknown(captured, input.operationId); return sanitized(error); }
  }
  async function recover(ctx: TrpcContext, raw: OperationsBoardPartnersRecoverInput): Promise<OperationsBoardPartnersWriteResult> {
    const input = OperationsBoardPartnersRecoverInputSchema.parse(raw); let captured: Identity | null = null;
    try { return await session(ctx, input.expectedWorkspaceId, async current => {
      captured = current.identity;
      // Recovery remains possible after writes are disabled or the new board
      // tables are rolled back. It still needs fresh admin/assign authority
      // and strict admission of the durable existing audit table.
      const operation = log(current, input.operationId);
      if (input.decision === "cancel") return operation.cancel();
      return (await operation.read()).final ?? unknown(current.identity, input.operationId);
    }); } catch (error) { if (captured && uncertain(error)) return unknown(captured, input.operationId); return sanitized(error); }
  }
  return { options, execute, recover };
}
export const operationsBoardPartnerRepository = createOperationsBoardPartnerRepository();
