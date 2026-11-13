"use strict";

const safe = (value) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
function mayAccessPhoto(uid, membership, client) {
  return Boolean(uid && membership?.status === "active" && client
    && ["owner", "area_manager", "manager", "instructor", "staff"].includes(membership.role)
    && client.photoAccessRevoked?.[uid] !== true
    && (["owner", "area_manager"].includes(membership.role) || (client.instructorIds || []).includes(uid)));
}
async function checkPhotoAccess(db, uid, scope) {
  if (!safe(uid) || !safe(scope?.organizationId) || !safe(scope?.clientId)) throw new Error("photo/scope-required");
  const [membership, client] = await Promise.all([
    db.doc(`memberships/${scope.organizationId}_${uid}`).get(),
    db.doc(`organizations/${scope.organizationId}/clients/${scope.clientId}`).get(),
  ]);
  if (!mayAccessPhoto(uid, membership.data(), client.data())) throw new Error("photo/access-denied");
  return { organizationId: scope.organizationId, clientId: scope.clientId };
}
// Binding is additive and per-photo; unknown legacy member links fail closed, never guessed by name.
async function preparePhotoAccess(db, bucket, uid, input) {
  if (!safe(input?.photoId)) throw new Error("photo/invalid-id");
  const ref = db.doc(`users/${uid}/photoBackups/${input.photoId}`);
  const existing = await ref.get();
  const old = existing.data();
  if (old?.moving) throw new Error("photo/move-pending");
  let scope = input;
  if (old?.organizationId && old?.clientId) {
    if (old.organizationId !== input.organizationId || old.clientId !== input.clientId) throw new Error("photo/scope-immutable");
    scope = old;
  } else if (existing.exists) {
    const backup = (await db.doc(`users/${uid}/backup/latest`).get()).data();
    const member = (backup?.data?.members || []).find((m) => m.id === old.memberId);
    if (old.memberId !== input.clientId && member?.orgClientId !== input.clientId) throw new Error("photo/legacy-link-review-required");
  }
  scope = await checkPhotoAccess(db, uid, scope);
  if (existing.exists) {
    // Rules do not govern token URLs. Remove old bearer tokens and HTTP caches on touched objects.
    for (const name of ["image.jpg", "thumb.jpg", "original.bin"]) {
      const file = bucket.file(`users/${uid}/photos/${input.photoId}/${name}`);
      const [exists] = await file.exists();
      if (exists) {
        const [metadata] = await file.getMetadata();
        await file.setMetadata({ cacheControl: "private,no-store,max-age=0", metadata: { ...metadata.metadata, ...scope, firebaseStorageDownloadTokens: null } });
      }
    }
    await ref.set(scope, { merge: true });
  }
  return scope;
}
async function listAuthorizedPhotos(db, uid) {
  const snapshot = await db.collection(`users/${uid}/photoBackups`).get();
  const result = [];
  let legacyContext = null;
  for (const doc of snapshot.docs) {
    let item = doc.data();
    if (item.status === "deleted" || item.moving) continue;
    if (!item.organizationId || !item.clientId) {
      if (!legacyContext) {
        const [backup, memberships] = await Promise.all([db.doc(`users/${uid}/backup/latest`).get(), db.collection("memberships").where("userId", "==", uid).get()]);
        legacyContext = { members: backup.data()?.data?.members || [], memberships: memberships.docs.map((d) => d.data()).filter((m) => m.status === "active") };
      }
      const member = legacyContext.members.find((m) => m.id === item.memberId);
      const clientId = member?.orgClientId || item.memberId;
      const scopes = [];
      for (const membership of legacyContext.memberships) {
        try { scopes.push(await checkPhotoAccess(db, uid, { organizationId: membership.organizationId, clientId })); } catch { /* no name-based guessing */ }
      }
      if (scopes.length !== 1) continue;
      item = { ...item, ...scopes[0], needsScopeBinding: true };
    }
    try { await checkPhotoAccess(db, uid, item); result.push({ ...item, id: doc.id }); } catch { /* no metadata for revoked/unresolved members */ }
  }
  return result;
}
async function movePhotoGroup(db, bucket, uid, input) {
  const { createHash } = require("node:crypto");
  const ids = [...new Set(input?.photoIds || [])].sort();
  if (!ids.length || ids.length > 40 || !ids.every(safe) || !safe(input.targetMemberId)) throw new Error("photo/invalid-move");
  const target = await checkPhotoAccess(db, uid, input);
  const operationId = createHash("sha256").update(JSON.stringify([ids, target, input.targetMemberId])).digest("hex");
  const journal = db.doc(`users/${uid}/photoMoves/${operationId}`);
  const existing = (await journal.get()).data();
  if (existing?.state === "complete") return { operationId, state: "complete" };
  const before = existing?.before || await Promise.all(ids.map(async (id) => {
    const doc = await db.doc(`users/${uid}/photoBackups/${id}`).get();
    if (!doc.exists) throw new Error("photo/move-source-missing");
    const data = doc.data(); await checkPhotoAccess(db, uid, data);
    if (data.organizationId !== target.organizationId) throw new Error("photo/cross-organization-move-denied");
    return { id, data };
  }));
  for (const item of before) await checkPhotoAccess(db, uid, item.data);
  // Durable recovery journal contains metadata only; interrupted calls resume the same operation.
  if (!existing) await journal.create({ state: "moving", before, target, targetMemberId: input.targetMemberId });
  const refs = before.map(({ id }) => db.doc(`users/${uid}/photoBackups/${id}`));
  const lock = db.batch(); refs.forEach((ref) => lock.update(ref, { moving: true })); await lock.commit();
  for (const { id } of before) {
    for (const name of ["image.jpg", "thumb.jpg", "original.bin"]) {
      const file = bucket.file(`users/${uid}/photos/${id}/${name}`);
      if (!(await file.exists())[0]) continue;
      const [meta] = await file.getMetadata();
      await file.setMetadata({ cacheControl: "private,no-store,max-age=0", metadata: { ...meta.metadata, ...target, moving: "true", firebaseStorageDownloadTokens: null } });
    }
  }
  await checkPhotoAccess(db, uid, target);
  for (const item of before) await checkPhotoAccess(db, uid, item.data);
  const batch = db.batch();
  before.forEach(({ data }, i) => batch.update(refs[i], { ...target, memberId: input.targetMemberId,
    record: { ...data.record, memberId: input.targetMemberId },
    references: (data.references || []).map((ref) => ({ ...ref, memberId: input.targetMemberId, record: { ...ref.record, memberId: input.targetMemberId } })), moving: true }));
  await batch.commit();
  for (const { id } of before) for (const name of ["image.jpg", "thumb.jpg", "original.bin"]) {
    const file = bucket.file(`users/${uid}/photos/${id}/${name}`);
    if ((await file.exists())[0]) await file.setMetadata({ metadata: { moving: null, firebaseStorageDownloadTokens: null } });
  }
  const finish = db.batch(); refs.forEach((ref) => finish.update(ref, { moving: false }));
  finish.update(journal, { state: "complete" }); await finish.commit();
  return { operationId, state: "complete" };
}
module.exports = { mayAccessPhoto, checkPhotoAccess, preparePhotoAccess, listAuthorizedPhotos, movePhotoGroup };
