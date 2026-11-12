import { POSTURE_STORAGE_KEYS, normalizePostureView } from '../posture/posture-model.js';

export const ALBUM_VIEWS = [['front', '정면'], ['back', '후면'], ['leftSide', '좌측면'], ['rightSide', '우측면'], ['custom', '기타']];
export const DEFAULT_EDIT = Object.freeze({ rotate: 0, brightness: 1, zoom: 1, x: 0, y: 0, crop: 0 });
export const photoKey = (p) => `${p.bucket}:${p.id}`;
// Read individual records, never normalize them into one photo per direction/day.
export function albumPhotos(buckets = {}) {
  const result = [];
  const seen = new Set();
  for (const bucket of [...POSTURE_STORAGE_KEYS, 'poses']) {
    for (const p of buckets[bucket] || []) {
      if (!p || !(p.src || p.blobId || p.cloud?.storagePath || p.storagePath)) continue;
      if (p.sourcePhotoId && POSTURE_STORAGE_KEYS.some((k) => (buckets[k] || []).some((x) => !x.sourcePhotoId && (x.photoId || x.blobId || x.id) === p.sourcePhotoId))) continue;
      if (bucket === 'poses' && p.assessmentId && POSTURE_STORAGE_KEYS.some((k) => (buckets[k] || []).some((x) => x.assessmentId === p.assessmentId && normalizePostureView(x.view || k) === normalizePostureView(p.view)))) continue;
      const identity = p.sourcePhotoId || p.photoId || p.blobId || p.id;
      if (seen.has(identity)) continue;
      seen.add(identity);
      result.push({ ...p, bucket, albumEdit: p.albumEdit || { ...DEFAULT_EDIT, rotate: p.rot || 0, zoom: p.scale || 1, x: p.x || 0, y: p.y || 0 }, view: normalizePostureView(p.albumView || p.view || bucket), date: String(p.albumDate || p.date || p.createdAt || p.at || '').slice(0, 10) });
    }
  }
  return result.sort((a, b) => b.date.localeCompare(a.date) || String(a.id).localeCompare(String(b.id)));
}
export function chronologicalPair(photos) {
  return [...photos].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 2);
}
export function patchAlbumPhoto(map, memberId, photo, patch, targetId = memberId) {
  const current = map[memberId] || {};
  const record = (current[photo.bucket] || []).find((p) => p.id === photo.id);
  if (!record) throw new Error('사진을 찾지 못했습니다.');
  if (targetId !== memberId) {
    const related = new Set([record.id, record.photoId, record.sourcePhotoId, record.blobId].filter(Boolean));
    const assessments = new Set([record.assessmentId].filter(Boolean));
    const entries = [...POSTURE_STORAGE_KEYS, 'poses'].flatMap((key) => (current[key] || []).map((p) => ({ key, p })));
    let expanded = true;
    const matches = (p) => assessments.has(p.assessmentId) || [p.id, p.photoId, p.sourcePhotoId, p.blobId].some((id) => id && related.has(id));
    while (expanded) {
      const size = related.size + assessments.size;
      for (const { p } of entries) if (matches(p)) { [p.id, p.photoId, p.sourcePhotoId, p.blobId].filter(Boolean).forEach((id) => related.add(id)); if (p.assessmentId) assessments.add(p.assessmentId); }
      for (const set of current.sets || []) if (related.has(set.beforeId) || related.has(set.afterId)) { if (set.beforeId) related.add(set.beforeId); if (set.afterId) related.add(set.afterId); }
      expanded = size !== related.size + assessments.size;
    }
    const source = { ...current }, target = { ...(map[targetId] || {}) };
    for (const key of [...POSTURE_STORAGE_KEYS, 'poses']) {
      const moved = (current[key] || []).filter(matches);
      if (!moved.length) continue;
      if (moved.some((p) => (target[key] || []).some((existing) => existing.id === p.id))) throw new Error('대상 회원에 같은 사진 ID가 있습니다. 덮어쓰지 않았습니다.');
      source[key] = (current[key] || []).filter((p) => !matches(p));
      target[key] = [...(target[key] || []), ...moved.map((p) => ({ ...p, ...(p.id === photo.id ? patch : {}), memberId: targetId, updatedAt: new Date().toISOString() }))];
    }
    const movedSets = (current.sets || []).filter((s) => related.has(s.beforeId) || related.has(s.afterId));
    source.sets = (current.sets || []).filter((s) => !movedSets.includes(s));
    target.sets = [...(target.sets || []), ...movedSets.map((s) => ({ ...s, memberId: targetId }))];
    return { ...map, [memberId]: source, [targetId]: target };
  }
  const updated = { ...record, ...patch, memberId: targetId, updatedAt: new Date().toISOString() };
  const next = { ...map, [memberId]: { ...current, [photo.bucket]: current[photo.bucket].filter((p) => p.id !== photo.id) } };
  next[targetId] = { ...next[targetId], [photo.bucket]: [...(next[targetId]?.[photo.bucket] || []), updated] };
  return next;
}
export function removeAlbumPhoto(map, memberId, photo) {
  const bucket = map[memberId] || {};
  const identity = photo.photoId || photo.blobId || photo.id;
  const linkedAnalyses = new Set(POSTURE_STORAGE_KEYS.flatMap((key) => bucket[key] || []).filter((p) => p.sourcePhotoId === identity).map((p) => p.assessmentId).filter(Boolean));
  const matches = (p) => p.id === photo.id || p.sourcePhotoId === identity || linkedAnalyses.has(p.assessmentId) || (photo.blobId && p.blobId === photo.blobId) || (photo.photoId && p.photoId === photo.photoId);
  const next = { ...bucket };
  const removed = new Set([photo.id]);
  for (const key of [...POSTURE_STORAGE_KEYS, 'poses']) {
    if (!Array.isArray(bucket[key])) continue;
    next[key] = bucket[key].flatMap((p) => {
      if (!matches(p)) return [p];
      removed.add(p.id);
      // Retain metrics/annotations as historical analysis, without a dangling photo reference.
      if (key === 'poses') {
        const result = { ...p, photoDeleted: true };
        for (const field of ['blobId', 'cleanBlobId', 'thumbnailBlobId', 'maskBlobId', 'src', 'cloud', 'storagePath', 'thumbnailPath']) delete result[field];
        return [result];
      }
      return [];
    });
  }
  next.sets = (bucket.sets || []).filter((s) => !removed.has(s.beforeId) && !removed.has(s.afterId));
  return { ...map, [memberId]: next };
}

// EXIF DateTimeOriginal, bounded to the JPEG APP1 segment; no GPS is retained.
export function exifDate(buffer) {
  try {
    const v = new DataView(buffer);
    if (v.getUint16(0) !== 0xffd8) return null;
    for (let offset = 2; offset + 4 < v.byteLength;) {
      const marker = v.getUint16(offset); const size = v.getUint16(offset + 2);
      if (size < 2 || offset + 2 + size > v.byteLength) break;
      if (marker === 0xffe1 && v.getUint32(offset + 4) === 0x45786966) {
        const base = offset + 10, end = offset + 2 + size, le = v.getUint16(base) === 0x4949;
        const readIFD = (pos, depth = 0) => {
          if (depth > 1 || pos < base || pos + 2 > end) return null;
          const count = v.getUint16(pos, le);
          for (let i = 0; i < count && pos + 2 + (i + 1) * 12 <= end; i++) {
            const p = pos + 2 + i * 12, tag = v.getUint16(p, le);
            if (tag === 0x8769) { const date = readIFD(base + v.getUint32(p + 8, le), depth + 1); if (date) return date; }
            if (tag === 0x9003) {
              const at = base + v.getUint32(p + 8, le);
              if (at >= base && at + 10 <= end) {
                const text = String.fromCharCode(...new Uint8Array(buffer, at, 10));
                if (/^\d{4}:\d{2}:\d{2}$/.test(text)) return text.replaceAll(':', '-');
              }
            }
          }
          return null;
        };
        return readIFD(base + v.getUint32(base + 4, le));
      }
      offset += size + 2;
    }
  } catch { /* Missing/malformed metadata falls back to a visible editable date. */ }
  return null;
}
