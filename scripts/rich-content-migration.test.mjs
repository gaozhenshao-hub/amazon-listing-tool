import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadRichContentTranslationMigrationPlan} from './run-database-migrations.mjs';
test('rich-content migration has an explicit dedicated plan and only additive source changes',()=>{
 const plan=loadRichContentTranslationMigrationPlan();assert.equal(plan.length,1);assert.equal(plan[0].fileName,'0318_rich_content_pretranslations.sql');
 const source=readFileSync(new URL('../drizzle/0318_rich_content_pretranslations.sql',import.meta.url),'utf8');
 assert(source.startsWith('-- DEDICATED RELEASE ONLY:'));assert(source.includes('information_schema.columns'));assert(source.includes('CREATE TABLE IF NOT EXISTS media_pretranslations'));assert(source.includes('WHERE NOT EXISTS (SELECT 1 FROM emperor_skills'));
 assert(!/\b(?:DELETE|DROP|TRUNCATE)\b/i.test(source));assert(source.includes('mode=image_audit'));assert(source.includes('mode=adjust'));
});
