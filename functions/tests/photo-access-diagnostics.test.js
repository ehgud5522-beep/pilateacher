const test = require('node:test');
const assert = require('node:assert/strict');
const { photoAccessRejection } = require('../src/photo-access-diagnostics');
test('access rejection exposes only fixed stage and allowlisted reason, never caller or backend text', () => {
  assert.deepEqual(photoAccessRejection(Error('photo/scope-required')), { stage:'prepare_access',reasonCode:'photo/scope-required' });
  const result=photoAccessRejection(Object.assign(Error('김회원 01012345678 users/secret token=abc'),{uid:'private-uid'}));
  assert.deepEqual(result,{stage:'prepare_access',reasonCode:'photo/access-check-failed'});
});
