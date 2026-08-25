-- Keep the conversation planner on the production quality-first model route.
UPDATE emperor_skills
   SET manifest = JSON_SET(manifest, '$.implementation.modelPolicy', 'gpt-5.6-sol'),
       version = version + 1,
       updatedAt = NOW()
 WHERE slug = 'emperor.conversation.plan';
