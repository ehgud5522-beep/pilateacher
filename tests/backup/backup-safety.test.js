import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKUP_MAX_BYTES, BACKUP_SIZE, BACKUP_WARN_BYTES, backupSizeVerdict, buildMigrationSnapshot,
  describeBackups, deviceBackupId,
} from "../../src/features/backup/backup-safety.js";
import { DEVICE_ID_KEY, deviceIdentity } from "../../src/features/backup/device-identity.js";

/* 백업 안전망 (2026-10-31, 서버 기준 동기화 0단계). */

const memoryStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
};

test("기기 id 는 처음 한 번 만들고 그 뒤로는 같은 값", () => {
  const storage = memoryStorage();
  const first = deviceIdentity(storage);
  assert.match(first, /^[A-Za-z0-9]{8,64}$/);
  assert.equal(deviceIdentity(storage), first);
  assert.equal(storage.getItem(DEVICE_ID_KEY), first);
});

test("저장소를 못 쓰면 빈 값 — 실행마다 새 자리가 생기지 않게", () => {
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(deviceIdentity(broken), "");
  const forgetful = { getItem: () => null, setItem: () => {} };
  assert.equal(deviceIdentity(forgetful), "", "썼는데 다시 안 읽히면 없는 것으로 친다");
  assert.equal(deviceBackupId(""), null, "그때는 latest 만 쓴다");
  assert.equal(deviceBackupId("abc123XYZ"), "device_abc123XYZ");
  assert.equal(deviceBackupId("../etc"), "device_etc", "경로 문자는 걷는다");
});

test("크기 — 800KiB 까지 그대로, 넘으면 경고, 한도를 넘으면 올리지 않는다", () => {
  assert.equal(backupSizeVerdict(2 * 1024), BACKUP_SIZE.OK, "대표 계정 백업은 2KiB 쯤이다 (2026-10-31 측정)");
  assert.equal(backupSizeVerdict(BACKUP_WARN_BYTES), BACKUP_SIZE.OK);
  assert.equal(backupSizeVerdict(BACKUP_WARN_BYTES + 1), BACKUP_SIZE.WARN);
  assert.equal(backupSizeVerdict(BACKUP_MAX_BYTES + 1), BACKUP_SIZE.TOO_LARGE);
  assert.ok(BACKUP_MAX_BYTES < 1024 * 1024, "Firestore 문서 한도(1MiB)보다 아래에서 멈춘다");
});

test("복원 목록 — 이 기기 것은 own, 본문 없는 자리는 뺀다, 최근 것부터", () => {
  const listed = [
    { id: "latest", hasData: true, deviceId: "phone1234", device: "Android", at: "2026-10-30T10:00:00.000Z", counts: { members: 3, sessions: 10 } },
    { id: "device_phone1234", hasData: true, deviceId: "phone1234", device: "Android", at: "2026-10-30T10:00:00.000Z", counts: { members: 3, sessions: 10 } },
    { id: "device_pc567890", hasData: true, deviceId: "pc567890", device: "기타", at: "2026-10-31T09:00:00.000Z", counts: { members: 0, sessions: 40 } },
    { id: "previousPhone", hasData: true, device: "iPhone", at: "2026-09-18T16:04:24.090Z", counts: { members: 2, sessions: 26 } },
    { id: "device_empty000", hasData: false },
    { id: "stray", hasData: true },
  ];
  const rows = describeBackups(listed, { deviceId: "phone1234" });
  assert.deepEqual(rows.map((row) => [row.id, row.own]), [
    ["device_pc567890", false],
    ["previousPhone", false],
    ["latest", true],
    ["device_phone1234", true],
  ]);
  assert.equal(rows[0].sessions, 40);
});

test("스냅샷에는 사진 원본이 없다 — 사진 목록(참조)까지만", () => {
  const pixel = `data:image/jpeg;base64,${"A".repeat(5000)}`;
  const data = {
    members: [{ id: "m1", name: "회원", avatar: pixel, notes: [{ id: "n1", body: "기록" }] }],
    schedule: [{ id: "s1", date: "2026-11-03" }],
    settings: { center: "센터" },
  };
  const photos = {
    m1: {
      front: [{ id: "p1", photoId: "p1", blobId: "blob-p1", src: pixel, blob: { size: 9 }, cleanBlob: { size: 9 }, view: "front", date: "2026-10-01",
        cloud: { storagePath: "users/u/photos/p1/image.jpg", thumbnailPath: "users/u/photos/p1/thumb.jpg", imageBytes: 120000 } }],
      sets: [{ id: "set1", front: { id: "p1", src: pixel } }],
    },
  };
  const snapshot = buildMigrationSnapshot({ data, photos, deviceId: "pc567890", appBuild: "143", at: new Date("2026-10-31T01:02:03Z") });
  assert.equal(snapshot.snapshotId, "pc567890_20261031010203");
  assert.doesNotMatch(snapshot.body, /data:image/, "본문 어디에도 그림 원본이 없다");
  assert.doesNotMatch(snapshot.body, /AAAAAAAAAA/);
  assert.ok(snapshot.strippedBinaries >= 1, "db 안에 섞인 원본도 걷었다");
  const parsed = JSON.parse(snapshot.body);
  assert.equal(parsed.kind, "migration_snapshot");
  assert.equal(parsed.data.members[0].notes[0].body, "기록", "기록은 그대로");
  assert.equal(parsed.data.members[0].avatar, null);
  // 사진은 어디에 있는지만: 기기 blobId · 클라우드 경로 · 크기.
  assert.equal(parsed.photoManifest.length, 1);
  assert.equal(parsed.photoManifest[0].blobId, "blob-p1");
  assert.equal(parsed.photoManifest[0].storagePath, "users/u/photos/p1/image.jpg");
  assert.equal(parsed.photoManifest[0].record.src, undefined);
  assert.deepEqual(snapshot.counts, { members: 1, sessions: 1, photos: 1 });
  assert.ok(snapshot.bytes < 8000, `원본이 빠져 작다 (${snapshot.bytes}B)`);
});
