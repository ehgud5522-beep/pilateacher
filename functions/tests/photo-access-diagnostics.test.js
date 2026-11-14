const test = require('node:test');
const assert = require('node:assert/strict');
const { photoAccessRejection } = require('../src/photo-access-diagnostics');
test('access rejection exposes only fixed stage and allowlisted reason, never caller or backend text', () => {
  assert.deepEqual(photoAccessRejection(Error('photo/scope-required')), { stage:'prepare_access',reasonCode:'photo/scope-required',hasPhotoId:false,hasOrganizationId:false,hasClientId:false });
  const result=photoAccessRejection(Object.assign(Error('김회원 01012345678 users/secret token=abc'),{uid:'private-uid'}));
  assert.deepEqual(result,{stage:'prepare_access',reasonCode:'photo/access-check-failed',hasPhotoId:false,hasOrganizationId:false,hasClientId:false});
});
test('scope-required says which id was missing, as yes/no only -- never the values', () => {
  const result = photoAccessRejection(Error('photo/scope-required'), { photoId: 'album_abc', organizationId: 'bonita', clientId: undefined });
  assert.deepEqual(result, { stage: 'prepare_access', reasonCode: 'photo/scope-required', hasPhotoId: true, hasOrganizationId: true, hasClientId: false });
  assert.ok(!JSON.stringify(result).includes('bonita') && !JSON.stringify(result).includes('album_abc'));
});
