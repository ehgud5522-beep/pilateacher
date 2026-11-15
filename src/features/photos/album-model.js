import { POSTURE_STORAGE_KEYS, normalizePostureView } from '../posture/posture-model.js';

export const ALBUM_VIEWS = [['front', '정면'], ['back', '후면'], ['leftSide', '좌측면'], ['rightSide', '우측면'], ['custom', '기타']];
import { DEFAULT_EDIT } from './photo-edit-model.js';
export { DEFAULT_EDIT };
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
/* [변화 카드 만들기] 가 처음에 골라 주는 두 장 (2026-11-15). 강사가 고르지 않아도 되게 한다.
   같은 방향끼리(정면 ↔ 정면) 가장 오래 떨어진 두 장이 먼저다 -- 방향이 다르면 체형 비교가 안 된다.
   그런 짝이 없으면 가장 오래된 사진과 가장 최근 사진. 두 장이 안 되면 빈 배열. */
export function suggestPair(photos) {
  const dated = [...(photos || [])].filter((p) => p?.date).sort((a, b) => a.date.localeCompare(b.date));
  if (dated.length < 2) return [];
  let best = null;
  for (const [view] of ALBUM_VIEWS) {
    if (view === 'custom') continue;
    const same = dated.filter((p) => p.view === view);
    if (same.length < 2 || same[0].date === same.at(-1).date) continue;
    const span = Date.parse(same.at(-1).date) - Date.parse(same[0].date);
    if (Number.isFinite(span) && (!best || span > best.span)) best = { span, pair: [same[0], same.at(-1)] };
  }
  return best ? best.pair : [dated[0], dated.at(-1)];
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

/* 센터 회원과 연결되지 않은 사진 (2026-11-14).
   사진은 photos[회원 id] 에 저장된다. 그 id 가 지금 명부의 센터 회원(orgClientId 있음)이 아니면
   사진 백업이 "어느 센터의 어느 회원인지" 를 보낼 수 없어 서버가 photo/scope-required 로 거절한다
   (이전 폰 기록 불러오기로 옛 회원 번호 아래 되살아난 사진이 실제로 그랬다). 화면에서도 안 보인다.
   이미 서버에 회원 범위와 함께 올라간 사진(cloud.clientId)은 제외한다 -- 그건 연결이 끝난 사진이다. */
export function unlinkedAlbumPhotos(photoMap = {}, members = []) {
  const linked = new Set(members.filter((m) => m && m.id && m.orgClientId).map((m) => String(m.id)));
  const result = [];
  for (const [memberKey, buckets] of Object.entries(photoMap || {})) {
    if (linked.has(String(memberKey))) continue;
    for (const photo of albumPhotos(buckets || {})) {
      if (photo.cloud?.clientId || photo.clientId) continue;
      result.push({ memberKey, photo });
    }
  }
  return result;
}
