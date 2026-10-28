import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validatePlan, schemaFingerprint } from './apply-qingdao-reviewed-delta.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
function fixture(sql = 'CREATE TABLE example (id int PRIMARY KEY)') {
  const plan = { upfrontChecks: [{ sql: 'SELECT COUNT(*) AS n FROM information_schema.tables', equals: 0 }], steps: [{ id: '001', sql, sha256: sha(sql), preconditions: [], postconditions: [] }] };
  const bytes = Buffer.from(JSON.stringify(plan));
  return { plan, bytes, hash: sha(bytes) };
}
test('accepts exact reviewed bytes and statement hashes', () => {
  const x = fixture(); assert.equal(validatePlan(x.plan, x.bytes, x.hash).length, 1);
});
test('refuses changed plan bytes and altered SQL', () => {
  const x = fixture();
  assert.throws(() => validatePlan(x.plan, Buffer.from('changed'), x.hash), /PLAN_HASH_MISMATCH/);
  x.plan.steps[0].sql += ' changed';
  assert.throws(() => validatePlan(x.plan, x.bytes, x.hash), /STEP_ID_OR_HASH_MISMATCH/);
});
test('refuses destructive statements even with their valid hashes', () => {
  for (const sql of ['DROP TABLE example', 'ALTER TABLE example DROP COLUMN id', 'DELETE FROM example']) {
    const x = fixture(sql); assert.throws(() => validatePlan(x.plan, x.bytes, x.hash));
  }
});
test('does not enable optional legacy indexes or role changes', () => {
  const x = fixture(); x.plan.steps[0].enabledByDefault = false;
  const bytes = Buffer.from(JSON.stringify(x.plan));
  assert.deepEqual(validatePlan(x.plan, bytes, sha(bytes)), []);
});
test('preserving index replacement is allowed; narrowing is separately reviewed in pinned SQL', () => {
  const x = fixture('ALTER TABLE example DROP INDEX lookup, ADD INDEX lookup (name(191)), MODIFY name varchar(2000)');
  assert.equal(validatePlan(x.plan, x.bytes, x.hash).length, 1);
});
test('schema fingerprint covers column/index changes but not data snapshots', () => {
  const x = { tables: [{ TABLE_NAME: 'example' }], columns: [{ COLUMN_NAME: 'id', COLUMN_TYPE: 'int' }], indexes: [], foreignKeys: [], ledger: [] };
  assert.equal(schemaFingerprint(x), schemaFingerprint({ ...x, capturedAt: 'later', ledger: [{ name: 'old' }] }));
  assert.notEqual(schemaFingerprint(x), schemaFingerprint({ ...x, columns: [{ COLUMN_NAME: 'id', COLUMN_TYPE: 'bigint' }] }));
});
