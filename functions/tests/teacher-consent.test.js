/* 강사가 보내기 전에 회원의 공유 상태를 미리 읽는다 (teacherConsent).
   네 가지 상태만 돌려주고, 그 회원의 사진을 볼 수 있는 강사만 물을 수 있다. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSharingService, consentPath, CONSENT_VERSION } = require('../src/before-after-sharing');

const ORG = 'bonita', CLIENT = 'client1', TEACHER = 'teacher1', MEMBER = 'member1';
function service(overrides = {}) {
  const docs = {
    'runtimeConfig/beforeAfterSharing': { mode: 'test', phase1Verified: true, teacherIds: [TEACHER], memberIds: [MEMBER] },
    [`memberships/${ORG}_${TEACHER}`]: { status: 'active', role: 'instructor' },
    [`organizations/${ORG}/clients/${CLIENT}`]: { userId: MEMBER, instructorIds: [TEACHER], name: 'SECRET_NAME' },
    [`memberLinks/${MEMBER}`]: { status: 'linked', links: [{ organizationId: ORG, clientId: CLIENT }] },
    [consentPath(MEMBER, ORG, CLIENT)]: { status: 'granted', version: CONSENT_VERSION, revision: 'r1', grantedAt: 'SECRET_TIME' },
    ...overrides,
  };
  const db = { doc: (path) => ({ path, get: async () => ({ data: () => docs[path] }) }) };
  return createSharingService({ db, bucket: {} });
}
const ask = (svc, uid = TEACHER, extra = {}) => svc.handle(uid, { action: 'teacherConsent', schemaVersion: 3, organizationId: ORG, clientId: CLIENT, ...extra });

test('ready when the member is linked, opened and has agreed -- and nothing else leaks', async () => {
  const result = await ask(service());
  assert.deepEqual(result, { status: 'ready' });
  assert.ok(!JSON.stringify(result).includes('SECRET') && !JSON.stringify(result).includes(MEMBER));
});

test('consent_needed when the member has not agreed, withdrew, or agreed to an older text', async () => {
  const path = consentPath(MEMBER, ORG, CLIENT);
  for (const grant of [undefined, { status: 'revoked', version: CONSENT_VERSION }, { status: 'granted', version: 'older' }]) {
    assert.deepEqual(await ask(service({ [path]: grant })), { status: 'consent_needed' });
  }
});

test('not_linked when the member has no app account on this centre record', async () => {
  const client = `organizations/${ORG}/clients/${CLIENT}`;
  assert.deepEqual(await ask(service({ [client]: { instructorIds: [TEACHER] } })), { status: 'not_linked' });
  assert.deepEqual(await ask(service({ [`memberLinks/${MEMBER}`]: { status: 'linked', links: [] } })), { status: 'not_linked' });
});

test('not_open when the centre switch does not include this member yet', async () => {
  const flag = { mode: 'test', phase1Verified: true, teacherIds: [TEACHER], memberIds: [] };
  assert.deepEqual(await ask(service({ 'runtimeConfig/beforeAfterSharing': flag })), { status: 'not_open' });
});

test('only a teacher who may see this member\'s photos can ask', async () => {
  const client = `organizations/${ORG}/clients/${CLIENT}`;
  await assert.rejects(ask(service({ [client]: { userId: MEMBER, instructorIds: ['someone-else'] } })), { code: 'share/teacher-access-revoked' });
  await assert.rejects(ask(service({ [client]: { userId: MEMBER, instructorIds: [TEACHER], photoAccessRevoked: { [TEACHER]: true } } })), { code: 'share/teacher-access-revoked' });
  await assert.rejects(ask(service(), 'stranger'), { code: 'share/disabled' });
  await assert.rejects(ask(service(), TEACHER, { clientId: '' }), { code: 'share/member-required' });
  await assert.rejects(service().handle('', { action: 'teacherConsent', schemaVersion: 3 }), { httpsCode: 'unauthenticated' });
});
