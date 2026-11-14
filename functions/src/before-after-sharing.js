"use strict";

const { createHash } = require("node:crypto");
const { mayAccessPhoto } = require("./photo-access");
const { validateCard, deleteShareCard, digest, MAX_BYTES } = require("./share-card");
const VERSION = 3;
const CONSENT_VERSION = "before-after-member-v1";
const fail = (code) => { throw Object.assign(new Error(code), { httpsCode: "failed-precondition", code }); };
const id = (v) => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(v);
const hash = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const consentPath = (uid, org, client) => `memberPhotoConsents/${uid}/scopes/${hash([org, client])}`;
const scoped = (a, b) => a.organizationId === b.organizationId && a.clientId === b.clientId;
function enabled(flag, teacher, member) {
  return flag?.mode === "test" && flag.phase1Verified === true
    && (!teacher || flag.teacherIds?.includes(teacher)) && (!member || flag.memberIds?.includes(member));
}
function cleanEdit(raw = {}) {
  const ranges = { rotate: [-180, 180, 0], crop: [0, 70, 0], zoom: [.5, 3, 1], x: [-50, 50, 0], y: [-50, 50, 0], brightness: [.3, 2, 1] };
  return Object.fromEntries(Object.entries(ranges).map(([k, [min, max, fallback]]) => [k, Number.isFinite(raw[k]) ? Math.min(max, Math.max(min, raw[k])) : fallback]));
}
// Do not return EXIF (including GPS), IPTC, comments or arbitrary APP segments to members.
function stripJpegMetadata(bytes) {
  if (bytes[0] !== 255 || bytes[1] !== 216) fail("share/image-format");
  const parts = [bytes.subarray(0, 2)]; let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 255) fail("share/image-format");
    const marker = bytes[offset + 1];
    if (marker === 218 || marker === 217) { parts.push(bytes.subarray(offset)); return Buffer.concat(parts); }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + length + 2 > bytes.length) fail("share/image-format");
    if (!((marker >= 224 && marker <= 239) || marker === 254)) parts.push(bytes.subarray(offset, offset + length + 2));
    offset += length + 2;
  }
  fail("share/image-format");
}

function createSharingService({ db, bucket, now = () => new Date() }) {
  const read = async (reader, path) => (await reader.get(db.doc(path))).data();
  const direct = { get: (ref) => ref.get() };
  async function relationship(reader, scope, memberUid) {
    if (!id(scope.organizationId) || !id(scope.clientId)) fail("share/member-required");
    const client = await read(reader, `organizations/${scope.organizationId}/clients/${scope.clientId}`);
    const uid = memberUid || client?.userId;
    if (!id(uid) || client?.userId !== uid || client.deletedAt || ["deleted", "archived"].includes(client.status)) fail("share/member-not-linked");
    const link = await read(reader, `memberLinks/${uid}`);
    if (!["linked", "ended", "multi_location"].includes(link?.status) || !link.links?.some((l) => scoped(l, scope))) fail("share/member-not-linked");
    return { client, memberUserId: uid };
  }
  async function authority(reader, share, { consent = true, flag = true } = {}) {
    const linked = await relationship(reader, share, share.memberUserId);
    const membership = await read(reader, `memberships/${share.organizationId}_${share.teacherId}`);
    if (!mayAccessPhoto(share.teacherId, membership, linked.client)) fail("share/teacher-access-revoked");
    if (flag && !enabled(await read(reader, "runtimeConfig/beforeAfterSharing"), share.teacherId, linked.memberUserId)) fail("share/disabled");
    const grant = await read(reader, consentPath(linked.memberUserId, share.organizationId, share.clientId));
    if (consent && (grant?.status !== "granted" || grant.version !== CONSENT_VERSION || (share.consentRevision && share.consentRevision !== grant.revision))) fail("share/consent-required");
    return { ...linked, grant, teacherName: membership.displayName || membership.name || "담당 선생님" };
  }
  async function photo(reader, share, photoId) {
    const p = await read(reader, `users/${share.teacherId}/photoBackups/${photoId}`);
    if (!p || !scoped(p, share) || p.status !== "active" || p.moving || p.record?.photoDeleted || !p.originalPath) fail("share/photo-not-ready");
    if (p.storagePath !== `users/${share.teacherId}/photos/${photoId}/image.jpg`) fail("share/photo-not-ready");
    return p;
  }
  const publicShare = (s) => s.shareType === "card" ? ({ id: s.id, status: s.status, shareType: "card", dates: s.dates, teacherName: s.teacherName, sharedAt: s.sharedAt?.toDate?.().toISOString() || s.sharedAt || null, unread: !s.readAt, downloadEnabled: false }) : ({ id: s.id, status: s.status, shareType: s.shareType, photos: s.photos,
    feedback: s.feedback, teacherName: s.teacherName, memberName: s.memberName, comparisonConfig: s.comparisonConfig,
    sharedAt: s.sharedAt?.toDate?.().toISOString() || s.sharedAt || null, unread: !s.readAt, downloadEnabled: false });
  const audit = (tx, shareId, action, uid) => tx.set(db.collection(`beforeAfterShares/${shareId}/events`).doc(), { action, actorId: uid, at: now() });
  async function authorizeShare(reader, uid, shareId, memberOnly = false) {
    if (!id(shareId)) fail("share/not-found");
    const s = await read(reader, `beforeAfterShares/${shareId}`);
    if (!s || (memberOnly ? s.memberUserId !== uid : s.teacherId !== uid && s.memberUserId !== uid)) fail("share/not-found");
    if (s.status !== "active" && (memberOnly || s.teacherId !== uid || s.status !== "draft")) fail("share/revoked");
    await authority(reader, s);
    if (s.shareType !== "card") for (const p of s.photos) await photo(reader, s, p.id);
    return s;
  }
  async function handle(uid, input) {
    if (!uid) throw Object.assign(new Error("unauthenticated"), { httpsCode: "unauthenticated" });
    if (![2, VERSION].includes(input?.schemaVersion)) fail("share/update-required");
    const action = input.action;
    if (input.schemaVersion < VERSION && ["activate", "read", "detail", "media"].includes(action) && id(input.shareId)) {
      const existing = await read(direct, "beforeAfterShares/" + input.shareId);
      if (existing?.shareType === "card" && [existing.teacherId, existing.memberUserId].includes(uid)) fail("share/update-required");
    }
    if (action === "capability") {
      const flag = await read(direct, "runtimeConfig/beforeAfterSharing");
      return { enabled: enabled(flag, input.role === "teacher" ? uid : null, input.role === "teacher" ? null : uid), aiEnabled: false, schemaVersion: VERSION };
    }
    if (action === "consent" || action === "consentStatus") return db.runTransaction(async (tx) => {
      await relationship(tx, input, uid);
      const path = consentPath(uid, input.organizationId, input.clientId);
      const old = await read(tx, path);
      if (action === "consentStatus") return { status: old?.status || "missing", version: CONSENT_VERSION };
      if (input.granted !== false && (!enabled(await read(tx, "runtimeConfig/beforeAfterSharing"), null, uid) || input.version !== CONSENT_VERSION || input.confirmed !== true)) fail("share/consent-required");
      if (typeof input.granted !== "boolean") fail("share/consent-required");
      const value = { status: input.granted === true ? "granted" : "revoked", version: CONSENT_VERSION, notifications: input.notifications === true,
        revision: (old?.revision || 0) + 1, organizationId: input.organizationId, clientId: input.clientId, at: now() };
      tx.set(db.doc(path), value);
      tx.set(db.collection(`${path}/events`).doc(), { status: value.status, revision: value.revision, at: now() });
      return { status: value.status, version: CONSENT_VERSION };
    });
    if (action === "prepare") {
      if (input.shareType !== "card" || input.aiResults) fail("share/unsupported-type");
      if (!id(input.requestId) || !Array.isArray(input.photoIds) || input.photoIds.length !== 2 || !input.photoIds.every(id) || new Set(input.photoIds).size !== 2) fail("share/invalid-selection");
      if (input.schemaVersion !== VERSION) fail("share/update-required");
      const bytes = validateCard(input);
      const shareId = hash([uid, input.requestId]);
      const fingerprint = hash([input.organizationId, input.clientId, input.photoIds, input.sha256, input.width, input.height, input.dates, input.comment]);
      const ref = db.doc("beforeAfterShares/" + shareId);
      // Reserve before upload so retries cannot replace a different card.
      const reserved = await db.runTransaction(async (tx) => {
        const old = (await tx.get(ref)).data();
        const base = { organizationId: input.organizationId, clientId: input.clientId, teacherId: uid };
        const auth = await authority(tx, old || base);
        if (old) {
          if (old.fingerprint !== fingerprint) fail("share/request-conflict");
          if (old.status === "revoked") fail("share/revoked");
          return old;
        }
        const share = { ...base, id: shareId, memberUserId: auth.memberUserId, teacherName: auth.teacherName,
          photoIds: input.photoIds, dates: input.dates, feedback: input.comment, shareType: "card",
          status: "preparing", schemaVersion: VERSION, consentRevision: auth.grant.revision,
          consentReference: consentPath(auth.memberUserId, base.organizationId, base.clientId),
          fingerprint, createdAt: now(), sharedAt: null, revokedAt: null, downloadEnabled: false };
        tx.set(ref, share); return share;
      });
      if (["draft", "active"].includes(reserved.status)) return publicShare(reserved);
      const path = "beforeAfterShares/" + shareId + "/card.jpg", file = bucket.file(path);
      try {
        try { await file.save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: "image/jpeg", cacheControl: "private, no-store, max-age=0", metadata: { sha256: input.sha256 } } }); }
        catch (error) { if (Number(error.code) !== 412) throw error; }
        const [meta] = await file.getMetadata();
        if (meta.metadata?.sha256 !== input.sha256 || Number(meta.size) !== bytes.length) fail("share/card-conflict");
        const card = { path, generation: String(meta.generation), sha256: input.sha256, bytes: bytes.length, width: input.width, height: input.height };
        return await db.runTransaction(async (tx) => {
          const current = (await tx.get(ref)).data();
          if (!current || current.status === "revoked") fail("share/revoked");
          await authority(tx, current);
          if (["draft", "active"].includes(current.status)) return publicShare(current);
          tx.update(ref, { card, status: "draft" }); audit(tx, shareId, "prepared", uid);
          return publicShare({ ...current, card, status: "draft" });
        });
      } catch (error) {
        const current = (await ref.get()).data();
        if (!current || current.status === "revoked") await deleteShareCard(bucket, reserved);
        throw error;
      }
    }
    if (["activate", "revoke", "read"].includes(action)) {
      const result = await db.runTransaction(async (tx) => {
      const ref = db.doc(`beforeAfterShares/${id(input.shareId) ? input.shareId : "invalid"}`);
      const s = (await tx.get(ref)).data();
      if (!s) fail("share/not-found");
      if (action === "revoke") {
        if (uid !== s.teacherId) fail("share/not-found");
        // Revocation remains possible with the rollout switch off or consent withdrawn.
        await authority(tx, s, { consent: false, flag: false });
        if (s.status !== "revoked") { tx.update(ref, { status: "revoked", revokedAt: now() }); audit(tx, s.id, "revoked", uid); }
        return { id: s.id, status: "revoked", shareType: s.shareType };
      }
      await authorizeShare(tx, uid, s.id, action === "read");
      if (action === "activate") {
        if (uid !== s.teacherId || input.confirmed !== true) fail("share/confirmation-required");
        if (s.status === "draft") { tx.update(ref, { status: "active", sharedAt: now(), notificationStatus: "pending" }); audit(tx, s.id, "activated", uid); }
        return { id: s.id, status: "active" };
      }
      tx.update(ref, { readAt: now() }); audit(tx, s.id, "viewed", uid); return publicShare(s);
    });
      if (action === "revoke") await deleteShareCard(bucket, result);
      return result;
    }
    if (action === "teacherList" || action === "memberList") {
      const teacher = action === "teacherList";
      if (!enabled(await read(direct, "runtimeConfig/beforeAfterSharing"), teacher ? uid : null, teacher ? null : uid)) fail("share/disabled");
      const docs = await db.collection("beforeAfterShares").where(teacher ? "teacherId" : "memberUserId", "==", uid).get();
      const shares = [];
      for (const doc of docs.docs) {
        const s = doc.data();
        if (input.schemaVersion < VERSION && s.shareType === "card") continue;
        if (input.clientId && !scoped(input, s)) continue;
        try { await authorizeShare(direct, uid, doc.id, !teacher); shares.push(publicShare(s)); } catch { /* never expose revoked or unrelated records */ }
      }
      return { shares: shares.sort((a, b) => String(b.sharedAt).localeCompare(String(a.sharedAt))) };
    }
    if (action === "detail") return publicShare(await authorizeShare(direct, uid, input.shareId));
    if (action === "media") {
      const s = await authorizeShare(direct, uid, input.shareId);
      if (s.shareType === "card") {
        if (input.photoId) fail("share/not-found");
        const card = s.card;
        if (!card || card.path !== "beforeAfterShares/" + s.id + "/card.jpg") fail("share/card-not-ready");
        const file = bucket.file(card.path, { generation: card.generation });
        const [meta] = await file.getMetadata();
        if (String(meta.generation) !== card.generation || Number(meta.size) !== card.bytes || Number(meta.size) > MAX_BYTES) fail("share/card-changed");
        const [bytes] = await file.download();
        if (digest(bytes) !== card.sha256) fail("share/card-changed");
        await authorizeShare(direct, uid, input.shareId);
        await db.collection("beforeAfterShares/" + s.id + "/events").add({ action: "media-read", actorId: uid, at: now() });
        return { base64: bytes.toString("base64"), contentType: "image/jpeg" };
      }
      const p = s.photos.find((p) => p.id === input.photoId);
      if (!p) fail("share/not-found");
      const file = bucket.file(`users/${s.teacherId}/photos/${p.id}/image.jpg`, { generation: p.generation });
      const [meta] = await file.getMetadata();
      if (String(meta.generation) !== p.generation || Number(meta.size) > 4 * 1024 * 1024 || !scoped(meta.metadata || {}, s) || meta.metadata?.moving === "true") fail("share/photo-changed");
      const [bytes] = await file.download();
      await authorizeShare(direct, uid, input.shareId);
      await db.collection(`beforeAfterShares/${s.id}/events`).add({ action: "media-read", actorId: uid, at: now() });
      return { base64: stripJpegMetadata(bytes).toString("base64"), contentType: "image/jpeg" };
    }
    fail("share/invalid-action");
  }
  return { handle, authorizeShare: (uid, shareId) => authorizeShare(direct, uid, shareId, true) };
}

module.exports = { createSharingService, enabled, stripJpegMetadata, cleanEdit, CONSENT_VERSION, consentPath };
