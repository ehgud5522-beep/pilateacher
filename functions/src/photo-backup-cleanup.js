"use strict";

const SAFE_PATH = /^users\/([A-Za-z0-9_-]{1,160})\/photos\/([A-Za-z0-9._:-]{1,160})\/(image|thumb)\.jpg$/;

function asDate(value) {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === "function") return value.toDate();
  return new Date(value || 0);
}

function ownedPhotoPath(path, uid, photoId) {
  const match = String(path || "").match(SAFE_PATH);
  return Boolean(match && match[1] === uid && match[2] === photoId);
}

function createPhotoBackupCleanupService({ firestore, bucket, now = () => new Date(), limit = 100 } = {}) {
  if (!firestore || !bucket) throw new TypeError("photo cleanup dependencies are required");
  async function purgeEntries(docs) {
      const current = asDate(now());
      const expired = docs.filter((entry) => {
        const data = entry.data() || {};
        return data.status === "deleted" && asDate(data.purgeAfter) <= current;
      }).slice(0, Math.max(1, Math.min(200, Number(limit) || 100)));
      let purged = 0;
      for (const entry of expired) {
        const data = entry.data() || {};
        const uid = String(data.storagePath || "").match(SAFE_PATH)?.[1] || "";
        const paths = [data.storagePath, data.thumbnailPath].filter((path) => ownedPhotoPath(path, uid, entry.id));
        if (paths.length !== 2) continue;
        await Promise.all(paths.map((path) => bucket.file(path).delete({ ignoreNotFound: true })));
        await entry.ref.delete();
        purged += 1;
      }
      return { purged, remaining: Math.max(0, expired.length - purged) };
  }
  return Object.freeze({
    async purgeForUser(uid) {
      const safeUid = String(uid || "").trim();
      if (!/^[A-Za-z0-9_-]{1,160}$/.test(safeUid)) throw Object.assign(new Error("invalid uid"), { code: "invalid_request" });
      const snapshot = await firestore.collection(`users/${safeUid}/photoBackups`).get();
      return purgeEntries(snapshot.docs);
    },
    async purgeExpiredGlobal() {
      const query = firestore.collectionGroup("photoBackups")
        .where("purgeAfter", "<=", asDate(now()))
        .limit(Math.max(1, Math.min(200, Number(limit) || 100)));
      const snapshot = await query.get();
      return purgeEntries(snapshot.docs);
    },
  });
}

module.exports = { createPhotoBackupCleanupService, ownedPhotoPath };
