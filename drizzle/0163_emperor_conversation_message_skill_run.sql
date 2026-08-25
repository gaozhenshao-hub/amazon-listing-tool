-- Persist the governed planner/Skill Run that produced an assistant message.
-- Forward-only schema repair: no existing conversation message is modified.
ALTER TABLE `emperor_conversation_messages`
  ADD COLUMN `skillRunId` VARCHAR(80) NULL AFTER `structuredContent`;
