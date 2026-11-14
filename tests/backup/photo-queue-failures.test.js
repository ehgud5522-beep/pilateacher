import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoQueue, drainPhotoQueue } from '../../src/features/backup/cloud-backup.js';
import { photoFailure, photoFailureLabel, photoStage } from '../../src/features/backup/photo-errors.js';
import { deletePhotoManifest } from '../../src/features/backup/photo-delete.js';
const fixture = () => { const data = new Map(); const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }; return { storage, queue: createPhotoQueue(storage, 'u') }; };
const denied = () => Object.assign(new Error('photo/scope-required 이름 김회원 전화 01012345678 token secret'), { code: 'functions/permission-denied' });
test('first failure preserves original codes and task, while second and third upload succeed', async () => {
  const { queue, storage } = fixture(); queue.upsert(['photo001-more', 'photo002', 'photo003'].map(photoId => ({ photoId })));
  const logs = [], attempts = [];
  const handler = async task => { attempts.push(task.photoId); if (task.photoId.startsWith('photo001')) throw denied(); };
  const result = await drainPhotoQueue(queue, handler, { onFailure: e => logs.push(e) });
  assert.equal(result.processed, 2); assert.equal(result.failed, 1); assert.equal(result.pending, 1);
  assert.equal(logs[0].errorCode, 'functions/permission-denied'); assert.equal(logs[0].reasonCode, 'photo/scope-required');
  assert.equal(logs[0].photoIdPrefix, 'photo001'); assert.match(photoFailureLabel(logs[0]), /권한.*functions\/permission-denied/);
  assert.doesNotMatch(JSON.stringify(logs), /김회원|01012345678|secret|이름/);
  const restarted = createPhotoQueue(storage, 'u');
  restarted.upsert([{ photoId: 'photo001-more' }]);
  await drainPhotoQueue(restarted, handler); assert.equal(attempts.length, 3, 'upsert/restart must not unblock a denied task');
  await drainPhotoQueue(restarted, async () => {}, { manual: true }); assert.equal(restarted.read().length, 0);
});
test('only transient errors retry, with backoff and a persistent three-attempt limit', async () => {
  const { queue } = fixture(); queue.upsert([{ photoId: 'network' }]); let attempts = 0;
  const handler = async () => { attempts++; throw Object.assign(Error('private text'), { code: 'storage/retry-limit-exceeded' }); };
  let result = await drainPhotoQueue(queue, handler, { now: 0 }); assert.equal(result.retryAfterMs, 5000);
  await drainPhotoQueue(queue, handler, { now: 4999 }); assert.equal(attempts, 1);
  await drainPhotoQueue(queue, handler, { now: 5000 });
  result = await drainPhotoQueue(queue, handler, { now: 15000 }); assert.equal(attempts, 3); assert.equal(result.retryAfterMs, null);
  await drainPhotoQueue(queue, handler, { now: 999999 }); assert.equal(attempts, 3);
  for (const code of ['functions/invalid-argument', 'functions/unauthenticated', 'firestore/permission-denied', 'unknown']) assert.equal(photoFailure({ code }).retryable, false);
  assert.equal(photoFailure({ code: 'auth/operation-timeout', photoStage: 'manifest_write', photoDomain: 'firestore' }).retryable, true);
  assert.equal(photoFailure({ code: 'auth/operation-timeout' }).errorCode, 'auth/operation-timeout');
});
test('old queue items need no migration; in-flight success cannot remove a newer revision', async () => {
  const { queue, storage } = fixture(); storage.setItem(queue.key, JSON.stringify([{ photoId: 'old' }]));
  await drainPhotoQueue(queue, async () => queue.upsert([{ photoId: 'old' }]));
  assert.equal(queue.read().length, 1); assert.equal(queue.read()[0].revision, 1);
});
test('all operation stages preserve transport code and structured server reason without private text', async () => {
  for (const stage of ['prepare_access','original_metadata','original_upload','original_verify','image_upload','manifest_write','delete']) {
    try { await photoStage(stage, 'firebase_storage', () => { throw Object.assign(Error('김회원 01012345678 token secret'), { code: 'storage/unauthorized', details: { reasonCode: 'photo/access-denied', token: 'secret' } }); }); }
    catch (e) { const result=photoFailure(e,{ photoId:'abcdefgh-full' },{ organizationId:'private-org',clientId:'private-client',appBuild:'84',platform:'android' }); assert.equal(result.stage,stage); assert.equal(result.errorCode,'storage/unauthorized'); assert.equal(result.reasonCode,'photo/access-denied'); assert.equal(result.hasClientId,true); assert.equal(result.hasOrganizationId,true); assert.doesNotMatch(JSON.stringify(result),/김회원|01012345678|secret|private-org|private-client|full/); }
  }
});
test('delete never creates missing metadata, retains denied reads, and cannot block other uploads', async () => {
  let writes=0;
  assert.deepEqual(await deletePhotoManifest(async()=>({exists:()=>false}),async()=>writes++),{absent:true}); assert.equal(writes,0);
  const {queue}=fixture(); queue.upsert([{photoId:'delete-me',action:'delete'},{photoId:'upload-me'}]);
  const result=await drainPhotoQueue(queue,task=>task.action==='delete'?deletePhotoManifest(async()=>{throw Object.assign(Error('denied'),{code:'permission-denied'});},async()=>writes++):Promise.resolve());
  assert.equal(result.processed,1); assert.equal(queue.read()[0].photoId,'delete-me'); assert.equal(writes,0); assert.equal(result.failures[0].stage,'delete');
  await deletePhotoManifest(async()=>({exists:()=>true}),async()=>writes++); assert.equal(writes,1);
});
