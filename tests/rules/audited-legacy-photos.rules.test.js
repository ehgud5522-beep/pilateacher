import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { ref, uploadBytes, getBytes } from 'firebase/storage';

// Private production identifiers stay in an untracked local audit, never in fixtures.
let audit, rules;
try {
  audit = JSON.parse(await readFile('release/qa/phase2-final/private-photo-audit.json', 'utf8'));
  const deployed = JSON.parse(await readFile('release/qa/phase2-final/live-rules.json', 'utf8'));
  rules = deployed.find(x => x.name.includes('firebase.storage/')).files[0].content;
} catch { /* CI has no production audit; generic security scenarios run separately. */ }
test('audited legacy files remain inaccessible with deployed rules (synthetic bytes only)', { skip: !audit }, async () => {
  assert.equal(audit.rows.length, 4);
  const env = await initializeTestEnvironment({ projectId:'pilateacher-dev', storage:{rules} });
  try {
    for (const row of audit.rows) {
      assert.equal(row.scopeBound, false);
      assert.equal(row.bearerTokenPresent, false);
      await env.withSecurityRulesDisabled(async ctx => {
        await uploadBytes(ref(ctx.storage(), row.file), new Uint8Array([1,2,3]), {contentType:'image/jpeg'});
      });
      for (const ctx of [env.unauthenticatedContext(), env.authenticatedContext('unrelated-member'), env.authenticatedContext(row.memberUserId), env.authenticatedContext(row.uploaderUid)]) {
        await assertFails(getBytes(ref(ctx.storage(), row.file)));
      }
    }
  } finally { await env.cleanup(); }
});
