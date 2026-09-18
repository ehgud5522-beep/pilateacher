import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readCaptureTimer } from "../../src/features/posture/posture-camera.js";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/legacy-backup.json", import.meta.url), "utf8"));
const appSource = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
const gradleSource = readFileSync(new URL("../../android/app/build.gradle", import.meta.url), "utf8");

function seedPreviousBuildStorage(source) {
  const values = new Map();
  const userId = source.userId;
  values.set(`pilateacher_db_${userId}`, JSON.stringify(source.backup.data));
  values.set(`pilateacher_photos_${userId}`, JSON.stringify(source.local.photos));
  values.set("pilateacher.posture.captureTimerSeconds", "5");
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test("previous Android build data remains readable after the version 43 upgrade", () => {
  const storage = seedPreviousBuildStorage(fixture);
  const userId = fixture.userId;

  assert.match(gradleSource, /applicationId\s+["']com\.pilateacher\.app["']/);
  /* 이 검사가 말하려는 것은 "43 다음 빌드 이상을 보고 있다"이지, 그 빌드가
     정확히 44 라는 것이 아니다. 숫자를 못박아 둔 탓에 versionCode 가 52 가 될
     때까지 여덟 번 올라가는 동안 이 파일은 깨진 채로 있었고, 어느 스크립트도
     돌리지 않아 아무도 몰랐다. 바닥만 지킨다. */
  const versionCode = Number(/versionCode\s+(\d+)/.exec(gradleSource)?.[1]);
  assert.ok(Number.isInteger(versionCode), "build.gradle 에서 versionCode 를 읽지 못했다");
  assert.ok(versionCode >= 44, `43 다음 빌드를 기대했는데 versionCode 가 ${versionCode} 다`);
  assert.match(appSource, /`pilateacher_db_\$\{id\}`/);
  assert.match(appSource, /`pilateacher_photos_\$\{id\}`/);

  const db = JSON.parse(storage.getItem(`pilateacher_db_${userId}`));
  const photos = JSON.parse(storage.getItem(`pilateacher_photos_${userId}`));

  assert.deepEqual(db.settings, fixture.backup.data.settings, "center and instructor settings must survive");
  assert.deepEqual(db.members, fixture.backup.data.members, "members and lesson notes must survive");
  assert.deepEqual(db.schedule, fixture.backup.data.schedule, "lesson records and attendance must survive");
  assert.deepEqual(photos, fixture.local.photos, "photo metadata and pose records must survive");
  assert.equal(photos["legacy-member-1"].front[0].blobId, "fixture-blob-1");
  assert.equal(readCaptureTimer(storage), 5, "device setting must survive");
});
