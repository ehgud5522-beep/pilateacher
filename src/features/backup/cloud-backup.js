export const CLOUD_BACKUP_VERSION = 2;
export const CLOUD_PHOTO_CONSENT_VERSION = "2026-08-24";
export const PHOTO_RETENTION_DAYS = 30;
export const PHOTO_QUEUE_PREFIX = "pilateacher_cloud_photo_queue_v1_";

const safeId = (value) => String(value || "").trim().replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 160);
const bytesOf = (value) => new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength;
const stripBinaryDeep = (value) => {
  if (Array.isArray(value)) return value.map(stripBinaryDeep);
  if (!value || typeof value !== "object") return typeof value === "string" && value.startsWith("data:image") ? "" : value;
  const blocked = new Set(["src", "blob", "cleanBlob", "blobId", "cleanBlobId", "thumbnailBlobId"]);
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => !blocked.has(key) && typeof item !== "function").map(([key, item]) => [key, stripBinaryDeep(item)]));
};

export function backupCounts(data, photoManifest = [], photoGraph = {}) {
  const members = Array.isArray(data?.members) ? data.members.length : 0;
  const sessions = Array.isArray(data?.schedule) ? data.schedule.length : 0;
  const activePhotos = (photoManifest || []).filter((item) => item?.status !== "deleted");
  const assessments = new Set(activePhotos.map((item) => item.assessmentId).filter(Boolean)).size;
  return { members, sessions, assessments, photos: activePhotos.length, firestoreBytes: bytesOf(data) + bytesOf(photoManifest) + bytesOf(photoGraph) };
}

export function evaluateOverwriteRisk(localData, cloudBackup, options = {}) {
  const cloudCounts = cloudBackup?.counts || backupCounts(cloudBackup?.data || {}, cloudBackup?.photoManifest || []);
  const localCounts = backupCounts(localData || {}, []);
  const ratio = Math.max(0.1, Math.min(0.9, Number(options.ratio) || 0.5));
  const reasons = [];
  if (cloudCounts.members > 0 && localCounts.members === 0) reasons.push("members_empty");
  if (cloudCounts.sessions > 0 && localCounts.sessions === 0) reasons.push("sessions_empty");
  if (localCounts.members > 0 && cloudCounts.members >= 10 && localCounts.members < cloudCounts.members * ratio) reasons.push("members_mass_decrease");
  if (localCounts.sessions > 0 && cloudCounts.sessions >= 20 && localCounts.sessions < cloudCounts.sessions * ratio) reasons.push("sessions_mass_decrease");
  return { blocked: reasons.length > 0, reasons, localCounts, cloudCounts };
}

function stripRuntimePhotoFields(record) {
  const source = record && typeof record === "object" ? record : {};
  const blocked = new Set(["src", "blob", "cleanBlob", "blobId", "cleanBlobId", "thumbnailBlobId"]);
  return Object.fromEntries(Object.entries(source).filter(([key, value]) => !blocked.has(key) && typeof value !== "function"));
}

export function buildPhotoGraph(photoMap) {
  return Object.fromEntries(Object.entries(photoMap || {}).map(([memberId, buckets]) => [safeId(memberId), {
    sets: Array.isArray(buckets?.sets) ? stripBinaryDeep(buckets.sets) : [],
  }]).filter(([memberId, graph]) => memberId && graph.sets.length));
}

export function mergePhotoGraph(photoMap, photoGraph) {
  const result = { ...(photoMap || {}) };
  Object.entries(photoGraph || {}).forEach(([memberId, graph]) => {
    if (!memberId || !Array.isArray(graph?.sets)) return;
    result[memberId] = { ...(result[memberId] || {}), sets: stripBinaryDeep(graph.sets) };
  });
  return result;
}

export function buildPhotoManifest(photoMap) {
  const byPhotoId = new Map();
  Object.entries(photoMap || {}).forEach(([memberId, buckets]) => {
    Object.entries(buckets || {}).forEach(([bucketKey, records]) => {
      if (!Array.isArray(records) || bucketKey === "sets") return;
      records.forEach((record) => {
        if (!record || typeof record !== "object") return;
        const photoId = safeId(record.photoId || record.id || record.blobId);
        if (!photoId) return;
        const reference = {
          memberId: safeId(record.memberId || memberId),
          assessmentId: safeId(record.assessmentId || ""),
          bucketKey: safeId(bucketKey),
          view: String(record.view || bucketKey || "").slice(0, 40),
          date: String(record.date || record.createdAt || record.at || "").slice(0, 40),
          record: stripRuntimePhotoFields({ ...record, photoId }),
        };
        const candidate = {
          schemaVersion: 1,
          photoId,
          memberId: safeId(record.memberId || memberId),
          assessmentId: safeId(record.assessmentId || ""),
          bucketKey: safeId(bucketKey),
          view: String(record.view || bucketKey || "").slice(0, 40),
          date: String(record.date || record.createdAt || record.at || "").slice(0, 40),
          width: Math.max(0, Number(record.width || record.sourceWidth) || 0),
          height: Math.max(0, Number(record.height || record.sourceHeight) || 0),
          blobId: String(record.blobId || ""),
          storagePath: String(record.cloud?.storagePath || record.storagePath || ""),
          thumbnailPath: String(record.cloud?.thumbnailPath || record.thumbnailPath || ""),
          imageBytes: Math.max(0, Number(record.cloud?.imageBytes || record.imageBytes) || 0),
          thumbnailBytes: Math.max(0, Number(record.cloud?.thumbnailBytes || record.thumbnailBytes) || 0),
          status: record.deletedAt ? "deleted" : "active",
          record: reference.record,
          references: [reference],
        };
        const current = byPhotoId.get(photoId);
        if (!current) byPhotoId.set(photoId, candidate);
        else {
          const referenceKey = (item) => `${item.memberId}:${item.bucketKey}:${item.assessmentId}:${item.record?.id || item.record?.photoId || photoId}`;
          const references = new Map((current.references || []).map((item) => [referenceKey(item), item]));
          references.set(referenceKey(reference), reference);
          byPhotoId.set(photoId, {
            ...current,
            ...(current.blobId || !candidate.blobId ? {} : { blobId: candidate.blobId, width: candidate.width, height: candidate.height }),
            references: [...references.values()],
          });
        }
      });
    });
  });
  return [...byPhotoId.values()].sort((a, b) => a.photoId.localeCompare(b.photoId));
}

export function restorePhotoMetadata(manifest) {
  const result = {};
  (manifest || []).filter((item) => item?.status !== "deleted" && item?.photoId).forEach((item) => {
    const references = Array.isArray(item.references) && item.references.length ? item.references : [{ memberId: item.memberId, assessmentId: item.assessmentId, bucketKey: item.bucketKey, view: item.view, date: item.date, record: item.record }];
    references.filter((reference) => reference?.memberId && reference?.bucketKey).forEach((reference) => {
    const member = result[reference.memberId] || {};
    const records = Array.isArray(member[reference.bucketKey]) ? member[reference.bucketKey] : [];
    const record = {
      ...(reference.record && typeof reference.record === "object" ? reference.record : {}),
      id: reference.record?.id || item.photoId,
      photoId: item.photoId,
      memberId: reference.memberId,
      assessmentId: reference.assessmentId || reference.record?.assessmentId || "",
      view: reference.view || reference.record?.view || reference.bucketKey,
      date: reference.date || reference.record?.date || "",
      cloud: {
        storagePath: item.storagePath || "",
        thumbnailPath: item.thumbnailPath || "",
        imageBytes: Math.max(0, Number(item.imageBytes) || 0),
        thumbnailBytes: Math.max(0, Number(item.thumbnailBytes) || 0),
      },
    };
    member[reference.bucketKey] = [record, ...records.filter((entry) => (entry?.photoId || entry?.id) !== item.photoId)];
    result[reference.memberId] = member;
    });
  });
  return result;
}

export function mergePhotoMetadata(localMap, cloudManifest) {
  const cloud = restorePhotoMetadata(cloudManifest);
  const result = { ...(localMap || {}) };
  Object.entries(cloud).forEach(([memberId, buckets]) => {
    const current = result[memberId] || {};
    const next = { ...current };
    Object.entries(buckets).forEach(([bucketKey, records]) => {
      const localRecords = Array.isArray(current[bucketKey]) ? current[bucketKey] : [];
      const byId = new Map(localRecords.map((record) => [record?.photoId || record?.id, record]));
      records.forEach((record) => {
        const currentRecord = byId.get(record.photoId);
        // Cloud paths enrich an existing local record, while local blob/src fields win.
        byId.set(record.photoId, currentRecord ? { ...record, ...currentRecord, cloud: { ...record.cloud, ...currentRecord.cloud } } : record);
      });
      next[bucketKey] = [...byId.values()].filter(Boolean);
    });
    result[memberId] = next;
  });
  return result;
}

export function createPhotoQueue(storage, uid) {
  const key = `${PHOTO_QUEUE_PREFIX}${safeId(uid)}`;
  const read = () => {
    try {
      const parsed = JSON.parse(storage?.getItem?.(key) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) { return []; }
  };
  const write = (items) => storage?.setItem?.(key, JSON.stringify(items || []));
  const upsert = (items) => {
    const byId = new Map(read().map((item) => [`${item.action || "upload"}:${item.photoId}`, item]));
    (items || []).forEach((item) => {
      if (!item?.photoId) return;
      const action = item.action === "delete" ? "delete" : "upload";
      byId.set(`${action}:${item.photoId}`, { ...item, action, queuedAt: item.queuedAt || new Date().toISOString() });
      if (action === "delete") byId.delete(`upload:${item.photoId}`);
    });
    const output = [...byId.values()];
    write(output);
    return output;
  };
  const remove = (photoId, action = "upload") => {
    const output = read().filter((item) => !(item.photoId === photoId && (item.action || "upload") === action));
    write(output);
    return output;
  };
  return Object.freeze({ key, read, upsert, remove, clear: () => write([]) });
}

export async function drainPhotoQueue(queue, handler) {
  let processed = 0;
  let failed = 0;
  for (const task of queue?.read?.() || []) {
    try {
      await handler(task);
      queue.remove(task.photoId, task.action || "upload");
      processed += 1;
    } catch (error) {
      failed += 1;
      break;
    }
  }
  return { processed, failed, pending: queue?.read?.().length || 0 };
}

export function storageUsage(manifest) {
  const active = (manifest || []).filter((item) => item?.status !== "deleted");
  return active.reduce((result, item) => ({
    photoCount: result.photoCount + 1,
    photoBytes: result.photoBytes + Math.max(0, Number(item.imageBytes) || 0),
    thumbnailBytes: result.thumbnailBytes + Math.max(0, Number(item.thumbnailBytes) || 0),
  }), { photoCount: 0, photoBytes: 0, thumbnailBytes: 0 });
}

export function createEmergencyBackupEnvelope({ data, photos, photoBinary = null, from = "", at = new Date().toISOString() } = {}) {
  return {
    app: "pilateacher",
    kind: "backup",
    ver: CLOUD_BACKUP_VERSION,
    at,
    from: String(from || ""),
    center: String(data?.settings?.center || ""),
    members: Array.isArray(data?.members) ? data.members : [],
    schedule: Array.isArray(data?.schedule) ? data.schedule : [],
    settings: data?.settings && typeof data.settings === "object" ? data.settings : {},
    photos: photoBinary && typeof photoBinary === "object" ? photoBinary : {},
    photoManifest: buildPhotoManifest(photos || {}).map(({ blobId, ...item }) => item),
    photoGraph: buildPhotoGraph(photos || {}),
  };
}
