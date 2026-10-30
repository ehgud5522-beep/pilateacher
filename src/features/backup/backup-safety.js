/**
 * 백업 안전망 (2026-10-31, 서버 기준 동기화 0단계). **순수 함수다.**
 *
 * ── 기기별 자리 ──
 * 같은 계정의 PC 와 폰이 `users/{uid}/backup/latest` 한 자리를 번갈아 덮었다.
 * 그 백업으로 복원하면 다른 기기에서 넣은 것은 빠진다. 이제 기기마다
 * `device_{기기 id}` 에도 쓴다. `latest` 는 옛 빌드가 복원을 거기서 찾으므로
 * 당분간 같이 쓴다.
 *
 * ── 크기 ──
 * 백업은 문서 하나다. Firestore 문서 한 건의 한도는 1 MiB 이고, 넘으면
 * `invalid-argument` 로 거절돼 원인이 다른 실패와 뭉개진다. 올리기 전에 재서
 * 경고 · 멈춤을 우리 코드로 남긴다.
 *
 * ── 옮기기 전 스냅샷 ──
 * 기기 데이터를 서버로 옮기기 직전에 통째로 한 벌 남긴다 (Storage, 파일 하나).
 * **사진 원본은 넣지 않는다** (대표 결정, 용량). 사진은 목록 -- 어느 회원의
 * 어느 사진인지, 기기 · 클라우드의 어디에 있는지 -- 까지만 담는다.
 */

import { buildPhotoGraph, buildPhotoManifest, sanitizeFirestorePayload } from "./cloud-backup.js";

/** 경고: 한도의 80% 쯤. 1 MiB = 1,048,576 바이트. */
export const BACKUP_WARN_BYTES = 800 * 1024;
/**
 * 올리지 않는 선. Firestore 가 세는 크기는 JSON 과 조금 달라 (필드 이름 · 형식
 * 표시) 한도에 여유를 둔다.
 */
export const BACKUP_MAX_BYTES = 1_000_000;

export const BACKUP_SIZE = Object.freeze({ OK: "ok", WARN: "warn", TOO_LARGE: "too_large" });

/** 이 자리에 쓰면 백업이 거절된다. 우리 코드 -- invalid-argument 와 갈라 둔다. */
export const BACKUP_TOO_LARGE_CODE = "backup/too-large";

export const bytesOfJson = (value) => new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength;

export function backupSizeVerdict(bytes) {
  const size = Number(bytes) || 0;
  if (size > BACKUP_MAX_BYTES) return BACKUP_SIZE.TOO_LARGE;
  if (size > BACKUP_WARN_BYTES) return BACKUP_SIZE.WARN;
  return BACKUP_SIZE.OK;
}

const safeToken = (value) => String(value || "").trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);

/** 기기별 백업 문서 id. 기기 id 가 없으면 null -- 그때는 latest 만 쓴다. */
export function deviceBackupId(deviceId) {
  const token = safeToken(deviceId);
  return token ? `device_${token}` : null;
}

export const isDeviceBackupId = (id) => /^device_[A-Za-z0-9_-]{1,64}$/.test(String(id || ""));

/**
 * 복원 목록에 보일 것. 백업 본문(data)은 꺼내지 않는다.
 * own: 이 기기가 쓴 것 -- 자기 자리이거나, 마지막에 이 기기가 쓴 latest.
 * 다른 기기 것을 찾으러 연 목록이라 화면은 own 을 뺀다.
 */
export function describeBackups(documents, { deviceId = "" } = {}) {
  const own = deviceBackupId(deviceId);
  const token = safeToken(deviceId);
  return (Array.isArray(documents) ? documents : [])
    .filter((item) => item?.id && item.hasData)
    .map((item) => ({
      id: item.id,
      kind: item.id === "latest" ? "latest" : item.id === "previousPhone" ? "previousPhone" : isDeviceBackupId(item.id) ? "device" : "other",
      own: item.id === own || Boolean(token && safeToken(item.deviceId) === token),
      device: String(item.device || ""),
      appBuild: String(item.appBuild || ""),
      at: item.at || null,
      members: Number(item.counts?.members) || 0,
      sessions: Number(item.counts?.sessions) || 0,
    }))
    .filter((item) => item.kind !== "other")
    .sort((left, right) => Number(left.own) - Number(right.own)
      || String(right.at || "").localeCompare(String(left.at || "")));
}

/* 문자열 속 그림 원본 (data:image/... base64). 사진 원본이 db 안으로 섞여 들어온
   옛 데이터가 있을 수 있어 스냅샷 직전에 한 번 더 걷는다. */
const isInlineBinary = (value) => typeof value === "string" && /^data:(image|video|audio|application\/octet-stream)/i.test(value);

function stripInlineBinary(value, tally) {
  if (Array.isArray(value)) return value.map((item) => stripInlineBinary(item, tally));
  if (isInlineBinary(value)) { tally.count += 1; return null; }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripInlineBinary(item, tally)]));
}

export const SNAPSHOT_KIND = "migration_snapshot";
export const SNAPSHOT_MAX_BYTES = 20 * 1024 * 1024;

/**
 * 옮기기 전 스냅샷 한 벌.
 *
 * @param {{ data?: any, photos?: any, deviceId?: string, appBuild?: string, at?: Date }} input
 * @returns {{ snapshotId: string, body: string, bytes: number, counts: object, strippedBinaries: number }}
 */
export function buildMigrationSnapshot({ data, photos = {}, deviceId = "", appBuild = "", at = new Date() } = {}) {
  const tally = { count: 0 };
  const clean = stripInlineBinary(sanitizeFirestorePayload(data ?? {}), tally);
  /* 사진은 목록만. buildPhotoManifest 는 원본 · 썸네일 데이터를 싣지 않고
     어디에 있는지(기기 blobId, 클라우드 경로)만 싣는다. */
  const photoManifest = stripInlineBinary(buildPhotoManifest(photos || {}), tally);
  const photoGraph = stripInlineBinary(buildPhotoGraph(photos || {}), tally);
  const stamp = at instanceof Date && Number.isFinite(at.getTime()) ? at : new Date();
  const snapshotId = `${safeToken(deviceId) || "device"}_${stamp.toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
  const envelope = {
    app: "pilateacher",
    kind: SNAPSHOT_KIND,
    version: 1,
    at: stamp.toISOString(),
    deviceId: safeToken(deviceId),
    appBuild: String(appBuild || ""),
    data: clean,
    photoManifest,
    photoGraph,
  };
  const body = JSON.stringify(envelope);
  return {
    snapshotId,
    body,
    bytes: new TextEncoder().encode(body).byteLength,
    counts: {
      members: Array.isArray(clean?.members) ? clean.members.length : 0,
      sessions: Array.isArray(clean?.schedule) ? clean.schedule.length : 0,
      photos: photoManifest.length,
    },
    strippedBinaries: tally.count,
  };
}
