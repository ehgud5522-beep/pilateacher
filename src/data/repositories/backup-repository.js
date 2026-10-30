/**
 * 클라우드 백업 읽고 쓰기 (2026-10-31, 서버 기준 동기화 0단계).
 *
 * firebase.js 의 fbPushBackup 이 하던 일을 여기로 옮겼다. firestore · storage 를
 * 받으므로 규칙 테스트가 **이 코드 그대로** 에뮬레이터를 지난다 -- 가짜 저장소만
 * 으로는 규칙이 막는 것을 못 잡았다 (#96 → #98).
 *
 * 무엇이 바뀌었나:
 * - 기기별 자리 `device_{기기 id}` 에도 같은 본문을 쓴다. `latest` 는 그대로
 *   쓴다 (옛 빌드의 복원 자리). 둘은 한 트랜잭션이다.
 * - 올리기 전에 크기를 잰다. 한도를 넘으면 쓰지 않고 `backup/too-large`.
 * - 옮기기 전 스냅샷을 Storage 에 올린다 (사진 원본 없이).
 */

import {
  BACKUP_SIZE, BACKUP_TOO_LARGE_CODE, backupSizeVerdict, bytesOfJson, deviceBackupId,
} from "../../features/backup/backup-safety.js";
import {
  CLOUD_BACKUP_VERSION, backupCounts, evaluateOverwriteRisk, sanitizeFirestorePayload,
} from "../../features/backup/cloud-backup.js";

const load = () => import("firebase/firestore");

/**
 * @param {any} firestore
 * @param {string} uid
 * @param {any} data
 * @param {{
 *   deviceId?: string, appBuild?: string, device?: string,
 *   photoManifest?: any[], photoGraph?: object, photoCount?: number, photoPending?: number,
 *   storageUsage?: object, allowDestructiveOverwrite?: boolean,
 * }} [options]
 * @returns {Promise<{ counts: object, bytes: number, size: string, deviceBackupId: string | null, latestWritten: boolean }>}
 */
export async function pushBackup(firestore, uid, data, options = {}) {
  const { doc, runTransaction, serverTimestamp } = await load();
  const payload = sanitizeFirestorePayload(data);
  const photoManifest = sanitizeFirestorePayload(options.photoManifest || []);
  const photoGraph = sanitizeFirestorePayload(options.photoGraph || {});
  const counts = backupCounts(payload, photoManifest, photoGraph);
  const ownId = deviceBackupId(options.deviceId);

  /* 문서에 실릴 것 중 큰 것은 data 와 photoGraph 다. 둘을 함께 잰다. */
  const bytes = bytesOfJson({ data: payload, photoGraph, storageUsage: options.storageUsage || null });
  const size = backupSizeVerdict(bytes);
  if (size === BACKUP_SIZE.TOO_LARGE) {
    throw Object.assign(new Error("Cloud backup is too large for one document."), {
      code: BACKUP_TOO_LARGE_CODE, bytes, counts,
    });
  }

  const none = { blocked: false, reasons: [] };
  const force = options.allowDestructiveOverwrite === true;
  const latestWritten = await runTransaction(firestore, async (transaction) => {
    const backupRef = doc(firestore, "users", uid, "backup", "latest");
    const ownRef = ownId ? doc(firestore, "users", uid, "backup", ownId) : null;
    const snapshot = await transaction.get(backupRef);
    const ownSnapshot = ownRef ? await transaction.get(ownRef) : null;
    const latest = snapshot.exists() ? snapshot.data() : null;
    const ownPrevious = ownSnapshot?.exists() ? ownSnapshot.data() : null;
    /* 덮어쓰기 보호는 "이 기기가 갑자기 비었다" 를 잡는 장치다.

       기기 자리가 생긴 뒤로는 **자기 지난 백업과** 견준다. latest 와 견주면
       PC(일정 40)가 쓴 뒤 폰(일정 3)이 쓸 때마다 "대량 손실" 로 막혔다 --
       잃은 것이 아니라 다른 기기다 (2026-10-31, 규칙 테스트 A3 에서 드러남).
       자기 자리가 아직 없는 기기(새 기기 · 옛 빌드)는 지금처럼 latest 와 견준다.
       빈 새 폰이 옛 기록을 덮는 것을 막던 원래 자리다. */
    const comparedTo = ownId && ownPrevious ? ownPrevious : latest;
    const risk = comparedTo ? evaluateOverwriteRisk(payload, comparedTo) : none;
    if (risk.blocked && !force) {
      throw Object.assign(new Error("Cloud backup overwrite was blocked."), {
        code: "backup/overwrite-blocked", reasons: risk.reasons, risk,
      });
    }
    /* latest 는 옛 빌드의 복원 자리다. 다른 기기가 쓴 더 큰 백업을 이 기기가
       줄여서 덮지 않는다 -- 그때는 latest 를 건너뛰고 자기 자리에만 쓴다.
       기기 자리가 없으면(기기 id 를 못 만든 기기) 지금처럼 latest 에 쓴다. */
    const latestRisk = ownId && latest ? evaluateOverwriteRisk(payload, latest) : none;
    const writeLatest = force || !ownId || !latestRisk.blocked;
    const current = ownPrevious || latest;
    const body = {
      schemaVersion: CLOUD_BACKUP_VERSION,
      data: payload,
      device: String(options.device || "기타"),
      at: serverTimestamp(),
      members: counts.members,
      counts: {
        ...counts,
        photos: Number.isFinite(Number(options.photoCount))
          ? Math.max(0, Number(options.photoCount))
          : Math.max(0, Number(current?.counts?.photos) || 0),
      },
      photoPending: Math.max(0, Number(options.photoPending) || 0),
      storageUsage: options.storageUsage && typeof options.storageUsage === "object"
        ? sanitizeFirestorePayload(options.storageUsage) : current?.storageUsage || null,
      photoGraph: options.photoGraph && typeof options.photoGraph === "object" ? photoGraph : current?.photoGraph || {},
      /* 어느 기기 · 어느 빌드가 쓴 것인가. 복원 목록이 보여 주고, 서버 기준
         전환 때 "이 계정의 기기가 모두 최소 버전 이상인가" 를 여기서 본다. */
      deviceId: String(options.deviceId || ""),
      appBuild: String(options.appBuild || ""),
      bytes,
    };
    if (writeLatest) transaction.set(backupRef, body);
    if (ownRef) transaction.set(ownRef, body);
    return writeLatest;
  });
  return { counts, bytes, size, deviceBackupId: ownId, latestWritten };
}

/**
 * 이 계정의 백업 자리들. 본문(data)은 돌려주지 않는다 -- 목록을 그리는 데
 * 필요 없고, 크다.
 */
export async function listBackups(firestore, uid) {
  const { collection, getDocs } = await load();
  const page = await getDocs(collection(firestore, "users", uid, "backup"));
  return page.docs.map((snapshot) => {
    const value = snapshot.data() || {};
    const at = value.at?.toDate?.() || value.preservedAt?.toDate?.() || null;
    return {
      id: snapshot.id,
      hasData: Boolean(value.data && typeof value.data === "object"),
      device: String(value.device || ""),
      deviceId: String(value.deviceId || ""),
      appBuild: String(value.appBuild || ""),
      at: at ? at.toISOString() : null,
      counts: value.counts || null,
      bytes: Number(value.bytes) || 0,
    };
  });
}

/**
 * latest 를 이전 폰 보관본 자리로 한 번만 옮긴다 (firebase.js 의
 * fbPreservePreviousBackup 머리말). 이미 있으면 덮지 않는다.
 *
 * @returns {Promise<"saved" | "exists" | "nothing">}
 */
export async function preservePreviousBackup(firestore, uid, previousId = "previousPhone") {
  const { doc, runTransaction, serverTimestamp } = await load();
  return runTransaction(firestore, async (transaction) => {
    const previousRef = doc(firestore, "users", uid, "backup", previousId);
    const existing = await transaction.get(previousRef);
    if (existing.exists()) return "exists";
    const latest = await transaction.get(doc(firestore, "users", uid, "backup", "latest"));
    if (!latest.exists()) return "nothing";
    transaction.set(previousRef, { ...latest.data(), preservedAt: serverTimestamp() });
    return "saved";
  });
}

/** 스냅샷이 놓이는 자리. 규칙(storage.rules)과 같은 모양이어야 한다. */
export const snapshotPath = (uid, snapshotId) => `users/${uid}/snapshots/${snapshotId}/db.json`;

/**
 * 옮기기 전 스냅샷을 올린다. 같은 자리는 덮지 않는다 (규칙이 막는다).
 *
 * @param {any} storage
 * @param {string} uid
 * @param {{ snapshotId: string, body: string }} snapshot  buildMigrationSnapshot 의 결과
 */
export async function uploadMigrationSnapshot(storage, uid, snapshot) {
  const { ref, uploadBytes } = await import("firebase/storage");
  const path = snapshotPath(uid, snapshot.snapshotId);
  await uploadBytes(ref(storage, path), new TextEncoder().encode(snapshot.body), {
    contentType: "application/json",
  });
  return { path };
}
