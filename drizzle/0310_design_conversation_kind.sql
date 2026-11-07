ALTER TABLE design_conversations ADD COLUMN kind varchar(16) NOT NULL DEFAULT 'studio';
CREATE INDEX design_conversation_kind_owner ON design_conversations (workspaceId,userId,kind,deletedAt,updatedAt);
