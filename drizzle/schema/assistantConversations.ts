import { char, customType, datetime, index, int, json, mysqlEnum, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/** Private dialogue storage. Importing these definitions never creates tables or starts workers. */
const mediumBlob = customType<{ data: Buffer }>({ dataType: () => "mediumblob" });
export const assistantConversationThreads = mysqlTable("assistant_conversation_threads", {
  id: int("id").autoincrement().primaryKey(), workspaceId: int("workspace_id").notNull(), userId: int("user_id").notNull(),
  threadId: char("thread_id", { length: 36 }).notNull(), agentKey: varchar("agent_key", { length: 32 }).notNull(),
  title: varchar("title", { length: 80 }).notNull(), creationHash: char("creation_hash", { length: 64 }).notNull(),
  version: int("version").notNull(), nextSequence: int("next_sequence").notNull(), activeTurn: char("active_turn", { length: 36 }),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(), updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull(),
}, table => [uniqueIndex("uq_assistant_thread_identity").on(table.workspaceId, table.userId, table.threadId), index("ix_assistant_thread_history").on(table.workspaceId, table.userId, table.agentKey, table.id)]);

export const assistantConversationTurns = mysqlTable("assistant_conversation_turns", {
  id: int("id").autoincrement().primaryKey(), workspaceId: int("workspace_id").notNull(), userId: int("user_id").notNull(),
  operationId: char("operation_id", { length: 36 }).notNull(), threadId: char("thread_id", { length: 36 }).notNull(), agentKey: varchar("agent_key", { length: 32 }).notNull(),
  sequence: int("sequence"), expectedThreadVersion: int("expected_thread_version"), requestHash: char("request_hash", { length: 64 }), snapshotHash: char("snapshot_hash", { length: 64 }),
  mode: mysqlEnum("mode", ["work", "coach"]), request: json("request_snapshot"), configuration: json("configuration_snapshot"), runtime: json("runtime_snapshot"),
  state: mysqlEnum("state", ["queued", "route_dispatched", "route_ready", "reply_dispatched", "reply_ready", "succeeded", "failed", "canceled", "unknown"]).notNull(),
  leaseToken: char("lease_token", { length: 36 }), leaseOwner: varchar("lease_owner", { length: 128 }), attempt: int("attempt").notNull(),
  leaseExpiresAt: datetime("lease_expires_at", { mode: "string", fsp: 3 }), heartbeatAt: datetime("heartbeat_at", { mode: "string", fsp: 3 }),
  routeDispatch: json("route_dispatch"), routeResult: json("route_result"), replyDispatch: json("reply_dispatch"), replyResult: json("reply_result"), proposal: json("proposal"),
  errorCode: varchar("error_code", { length: 100 }), createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(), updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull(), completedAt: datetime("completed_at", { mode: "string", fsp: 3 }),
}, table => [uniqueIndex("uq_assistant_turn_operation").on(table.workspaceId, table.userId, table.operationId), uniqueIndex("uq_assistant_turn_sequence").on(table.workspaceId, table.userId, table.threadId, table.sequence), index("ix_assistant_turn_queue").on(table.state, table.leaseExpiresAt, table.id)]);

export const assistantConversationAttachments = mysqlTable("assistant_conversation_attachments", {
  id: int("id").autoincrement().primaryKey(), workspaceId: int("workspace_id").notNull(), userId: int("user_id").notNull(),
  operationId: char("operation_id", { length: 36 }).notNull(), ordinal: int("ordinal").notNull(), fileName: varchar("file_name", { length: 180 }).notNull(),
  mimeType: varchar("mime_type", { length: 128 }).notNull(), byteSize: int("byte_size").notNull(), contentHash: char("content_hash", { length: 64 }).notNull(),
  originalBytes: mediumBlob("original_bytes").notNull(), extraction: json("extraction").notNull(), createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
}, table => [uniqueIndex("uq_assistant_attachment_ordinal").on(table.workspaceId, table.userId, table.operationId, table.ordinal)]);
