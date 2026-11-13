import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getBytes, ref } from 'firebase/storage';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createSharingService, CONSENT_VERSION, consentPath, stripJpegMetadata } = require('./src/before-after-sharing');
const { notifyShare, eraseMemberShares } = require('./src/before-after-notifications');
const projectId = 'pilateacher-dev';
let env, app, db, service, onDownload;
const scope = { organizationId: 'org', clientId: 'client' };
const bytes = Buffer.from([255,216,255,225,0,6,1,2,3,4,255,218,0,2,255,217]);
const bucket = { file: (path) => ({
  getMetadata: async () => [{ size: bytes.length, generation: '1', contentType: path.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream', metadata: { ...scope, sha256: 'checksum' } }],
  download: async () => { if (onDownload) await onDownload(); return [bytes]; },
}) };
const call = (uid, action, input = {}) => service.handle(uid, { schemaVersion: 2, action, ...input });
const preparation = { ...scope, requestId: 'operation', photoIds: ['p1', 'p2'], feedback: '회원용 피드백', shareType: 'comparison', comparisonConfig: { mode: 'overlay', align: [{ x: 2 }, {}], split: 40 } };
async function activate() { const share = await call('teacher', 'prepare', preparation); await call('teacher', 'activate', { shareId: share.id, confirmed: true }); return share; }
before(async () => {
  env = await initializeTestEnvironment({ projectId,
    firestore: { rules: await readFile(new URL('../../firestore.foundation.rules', import.meta.url), 'utf8') },
    storage: { rules: await readFile(new URL('../../storage.rules', import.meta.url), 'utf8') } });
  app = initializeApp({ projectId }, projectId); db = getFirestore(app);
  service = createSharingService({ db, bucket });
});
after(async () => { await db?.terminate(); if (app) await deleteApp(app); await env?.cleanup(); });
beforeEach(async () => {
  onDownload = null;
  await env.clearFirestore();
  const data = {
    'runtimeConfig/beforeAfterSharing': { mode: 'test', phase1Verified: true, teacherIds: ['teacher'], memberIds: ['member', 'other'] },
    'memberships/org_teacher': { status: 'active', role: 'instructor', name: '선생님' },
    'organizations/org/clients/client': { userId: 'member', name: '동명이인', instructorIds: ['teacher'] },
    'organizations/org/clients/other': { userId: 'other', name: '동명이인', instructorIds: ['teacher'] },
    'memberLinks/member': { status: 'linked', links: [scope] },
    'memberLinks/other': { status: 'linked', links: [{ organizationId: 'org', clientId: 'other' }] },
    [consentPath('member', 'org', 'client')]: { version: CONSENT_VERSION, status: 'granted', revision: 1, notifications: true },
  };
  for (const id of ['p1', 'p2', 'unshared']) data[`users/teacher/photoBackups/${id}`] = { ...scope, photoId: id, status: 'active', originalPath: `users/teacher/photos/${id}/original.bin`, originalSha256: 'checksum', storagePath: `users/teacher/photos/${id}/image.jpg`, date: '2026-11-13', record: { albumEdit: { rotate: 90 }, analysis: { private: 'never return' } } };
  const batch = db.batch(); for (const [path, value] of Object.entries(data)) batch.set(db.doc(path), value); await batch.commit();
});

test('draft is private; explicit activation exposes only selected photos and feedback to the linked member', async () => {
  const draft = await call('teacher', 'prepare', preparation);
  assert.equal(draft.status, 'draft'); assert.deepEqual((await call('member', 'memberList')).shares, []);
  await assert.rejects(call('member', 'media', { shareId: draft.id, photoId: 'p1' }));
  await assert.rejects(call('teacher', 'activate', { shareId: draft.id }));
  await call('teacher', 'activate', { shareId: draft.id, confirmed: true });
  const list = (await call('member', 'memberList')).shares;
  assert.equal(list.length, 1); assert.equal(list[0].photos.length, 2); assert.equal(list[0].photos[0].edit.rotate, 90);
  assert.equal(list[0].comparisonConfig.split, 40); assert.ok(!JSON.stringify(list).includes('never return'));
  const media = await call('member', 'media', { shareId: draft.id, photoId: 'p1' });
  assert.deepEqual(Buffer.from(media.base64, 'base64'), stripJpegMetadata(bytes));
  await assert.rejects(call('member', 'media', { shareId: draft.id, photoId: 'unshared' }));
});
test('same-name other member, unrelated instructor and anonymous caller cannot read or share', async () => {
  const s = await activate();
  await assert.rejects(call('other', 'detail', { shareId: s.id }));
  await assert.rejects(call('other', 'media', { shareId: s.id, photoId: 'p1' }));
  await assert.rejects(call('intruder', 'prepare', preparation));
  await assert.rejects(call(null, 'detail', { shareId: s.id }));
  await assert.rejects(call('teacher', 'prepare', { ...preparation, clientId: 'other' }));
});
test('sharing documents, consent, rollout flag and instructor files are never directly accessible to members', async () => {
  const s = await activate(); const member = env.authenticatedContext('member');
  for (const path of [`beforeAfterShares/${s.id}`, consentPath('member', 'org', 'client'), 'runtimeConfig/beforeAfterSharing']) {
    await assertFails(getDoc(doc(member.firestore(), path))); await assertFails(setDoc(doc(member.firestore(), path), { status: 'active' }));
  }
  await assertFails(getBytes(ref(member.storage(), 'users/teacher/photos/p1/image.jpg')));
  await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), 'users/teacher/photos/p1/original.bin')));
});
test('revoke blocks list, open detail and media without modifying originals or analysis records', async () => {
  const old = (await db.doc('users/teacher/photoBackups/p1').get()).data(); const s = await activate();
  await call('teacher', 'revoke', { shareId: s.id });
  assert.equal((await call('member', 'memberList')).shares.length, 0);
  await assert.rejects(call('member', 'detail', { shareId: s.id }));
  await assert.rejects(call('member', 'media', { shareId: s.id, photoId: 'p1' }));
  assert.deepEqual((await db.doc('users/teacher/photoBackups/p1').get()).data(), old);
  assert.ok((await db.collection(`beforeAfterShares/${s.id}/events`).get()).size >= 3);
});
test('current assignment revocation and retired instructor deny the same caller session', async () => {
  const s = await activate();
  await db.doc('organizations/org/clients/client').update({ photoAccessRevoked: { teacher: true } });
  await assert.rejects(call('teacher', 'prepare', { ...preparation, requestId: 'new' }));
  await assert.rejects(call('member', 'media', { shareId: s.id, photoId: 'p1' }));
  await db.doc('organizations/org/clients/client').update({ photoAccessRevoked: {} });
  await db.doc('memberships/org_teacher').update({ status: 'inactive' });
  await assert.rejects(call('teacher', 'detail', { shareId: s.id }));
});
test('withdrawal invalidates prior consent permanently; accepting again does not revive shares', async () => {
  const s = await activate();
  await call('member', 'consent', { ...scope, granted: false });
  await assert.rejects(call('teacher', 'prepare', { ...preparation, requestId: 'new' }));
  await assert.rejects(call('member', 'detail', { shareId: s.id }));
  await call('member', 'consent', { ...scope, granted: true, confirmed: true, version: CONSENT_VERSION });
  await assert.rejects(call('member', 'detail', { shareId: s.id }));
});
test('member relink, source deletion or source move revokes access without migration', async () => {
  const s = await activate();
  await db.doc('memberLinks/member').update({ links: [] }); await assert.rejects(call('member', 'detail', { shareId: s.id }));
  await db.doc('memberLinks/member').update({ links: [scope] });
  await db.doc('users/teacher/photoBackups/p1').update({ status: 'deleted' }); await assert.rejects(call('member', 'detail', { shareId: s.id }));
  await db.doc('users/teacher/photoBackups/p1').update({ status: 'active', clientId: 'other' }); await assert.rejects(call('member', 'detail', { shareId: s.id }));
});
test('idempotent retries and concurrent requests produce one share; changed requests never overwrite', async () => {
  const results = await Promise.all([call('teacher', 'prepare', preparation), call('teacher', 'prepare', preparation)]);
  assert.equal(results[0].id, results[1].id);
  await Promise.all(results.map((s) => call('teacher', 'activate', { shareId: s.id, confirmed: true })));
  assert.equal((await db.collection('beforeAfterShares').get()).size, 1);
  await assert.rejects(call('teacher', 'prepare', { ...preparation, feedback: 'changed' }));
});
test('off, unverified Phase 1, unlisted accounts, missing consent and old protocol all fail closed', async () => {
  await assert.rejects(service.handle('teacher', { action: 'prepare', ...preparation }));
  for (const flag of [{}, { mode: 'all' }, { mode: 'test', phase1Verified: false, teacherIds: ['teacher'], memberIds: ['member'] }, { mode: 'test', phase1Verified: true, teacherIds: [], memberIds: ['member'] }]) {
    await db.doc('runtimeConfig/beforeAfterSharing').set(flag); await assert.rejects(call('teacher', 'prepare', preparation));
  }
});
test('AI is separately unavailable and backup absence blocks sharing', async () => {
  await assert.rejects(call('teacher', 'prepare', { ...preparation, aiResults: { text: 'diagnosis' } }));
  await db.doc('users/teacher/photoBackups/p1').update({ originalPath: null }); await assert.rejects(call('teacher', 'prepare', preparation));
});
test('push failure does not roll back sharing; trigger retries do not duplicate send', async () => {
  const s = await activate(); await db.doc('memberPush/member').set({ tokens: { t: { token: 'test-device' } } });
  let sends = 0; const messaging = { sendEachForMulticast: async (message) => { sends++; assert.ok(!JSON.stringify(message.notification).includes('동명이인')); assert.equal(message.notification.imageUrl, undefined); throw new Error('offline'); } };
  await notifyShare({ db, bucket, messaging }, s.id); await notifyShare({ db, bucket, messaging }, s.id);
  assert.equal(sends, 1); assert.equal((await db.doc(`beforeAfterShares/${s.id}`).get()).data().status, 'active');
});


test('revocation while image bytes are loading is checked again before returning media', async () => {
  const s = await activate();
  onDownload = () => db.doc('beforeAfterShares/' + s.id).update({ status: 'revoked' });
  await assert.rejects(call('member', 'media', { shareId: s.id, photoId: 'p1' }));
});

test('deleting a member erases private share content and consent while preserving instructor originals', async () => {
  const s = await activate();
  await eraseMemberShares(db, 'member');
  assert.equal((await db.doc('beforeAfterShares/' + s.id).get()).exists, false);
  assert.equal((await db.doc(consentPath('member', 'org', 'client')).get()).exists, false);
  assert.equal((await db.doc('users/teacher/photoBackups/p1').get()).exists, true);
});

test('only the linked member can grant consent and explicit confirmation is mandatory', async () => {
  await db.doc(consentPath('member', 'org', 'client')).delete();
  await assert.rejects(call('teacher', 'prepare', preparation));
  await assert.rejects(call('teacher', 'consent', { ...scope, granted: true, confirmed: true, version: CONSENT_VERSION }));
  await assert.rejects(call('other', 'consent', { ...scope, granted: true, confirmed: true, version: CONSENT_VERSION }));
  await assert.rejects(call('member', 'consent', { ...scope, granted: true, version: CONSENT_VERSION }));
});
