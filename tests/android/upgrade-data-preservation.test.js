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
  assert.match(gradleSource, /versionCode\s+43\b/);
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
