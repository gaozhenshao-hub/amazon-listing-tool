UPDATE design_conversations
SET title=COALESCE(
  (SELECT LEFT(g.prompt,60) FROM design_generations g
   WHERE g.conversationId=design_conversations.id ORDER BY g.createdAt,g.id LIMIT 1),
  CONVERT(0xE696B0E5AFB9E8AF9D USING utf8mb4)
)
WHERE title=DEFAULT(title);
ALTER TABLE design_conversations ALTER COLUMN title SET DEFAULT 'New conversation';
