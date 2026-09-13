import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PHOTO_BLOB_ID_FIELDS, photoBlobIdsIn } from "../../src/data/photo-blob-fields.js";
import { collectReferencedBlobIds } from "../../src/features/account/account-deletion.js";
import { buildPhotoGraph } from "../../src/features/backup/cloud-backup.js";

const read = (path) => readFile(new URL(`../../src/${path}`, import.meta.url), "utf8");

/* One list, because it used to be four.

   The same field names were spelled out separately in the cleanup pass, the
   account-deletion sweep, the backup stripper and half a dozen release calls.
   thumbnailBlobId was in three of them and missing from the fourth, so
   deleting an account left the member's body photos on the device.

   These tests hold the single list, and hold each consumer to it. */

test("every field a photo record can point an image with is in one list", () => {
  assert.deepEqual([...PHOTO_BLOB_ID_FIELDS], ["blobId", "cleanBlobId", "thumbnailBlobId", "maskBlobId"]);
  assert.ok(Object.isFrozen(PHOTO_BLOB_ID_FIELDS), "nobody edits it in place");
});

test("a record hands over every image it points at, and nothing else", () => {
  const record = { id: "p1", blobId: "b", cleanBlobId: "c", thumbnailBlobId: "t", maskBlobId: "m", src: "blob:x", note: "메모" };
  assert.deepEqual(photoBlobIdsIn(record).sort(), ["b", "c", "m", "t"]);
});

test("absent and empty fields are skipped rather than counted", () => {
  assert.deepEqual(photoBlobIdsIn({ blobId: "b" }), ["b"]);
  assert.deepEqual(photoBlobIdsIn({ blobId: "", cleanBlobId: null, maskBlobId: undefined }), []);
  for (const value of [null, undefined, "string", 7]) assert.deepEqual(photoBlobIdsIn(value), []);
});

/* --------------------------- account deletion ---------------------------- */

test("deleting an account sweeps up every image a photo record holds", () => {
  /* This is the one that was broken: thumbnailBlobId was not in the sweep, so
     the file stayed in IndexedDB after the account was gone. */
  const stored = {
    photos: {
      m1: {
        poses: [{ id: "p", blobId: "raw", cleanBlobId: "clean", thumbnailBlobId: "thumb", maskBlobId: "mask" }],
        front: [{ id: "f", blobId: "front_raw" }],
      },
    },
    sessions: [{ audioBlobId: "audio", recordingBlobId: "rec" }],
  };
  const swept = [...collectReferencedBlobIds(stored)];
  for (const id of ["raw", "clean", "thumb", "mask", "front_raw", "audio", "rec"]) {
    assert.ok(swept.includes(id), `${id} would be left on the device`);
  }
});

test("the deletion sweep is built from the shared list, not its own copy", async () => {
  const source = await read("features/account/account-deletion.js");
  assert.match(source, /import \{ PHOTO_BLOB_ID_FIELDS \} from "\.\.\/\.\.\/data\/photo-blob-fields\.js";/);
  assert.match(source, /const DEFAULT_BLOB_ID_FIELDS = new Set\(\[\s*\r?\n\s*\.\.\.PHOTO_BLOB_ID_FIELDS,/);
  const listed = source.slice(source.indexOf("DEFAULT_BLOB_ID_FIELDS"), source.indexOf("]);", source.indexOf("DEFAULT_BLOB_ID_FIELDS")));
  for (const field of PHOTO_BLOB_ID_FIELDS) {
    assert.ok(!listed.includes(`"${field}"`), `${field} is spelled out again instead of coming from the list`);
  }
});

/* ------------------------------ cloud backup ----------------------------- */

test("no image id rides along into the backup copy", () => {
  /* The image itself never goes; the id would go and point at nothing. */
  const graph = buildPhotoGraph({
    m1: { sets: [{ id: "s", blobId: "raw", cleanBlobId: "clean", thumbnailBlobId: "thumb", maskBlobId: "mask", view: "front" }] },
  });
  const serialized = JSON.stringify(graph);
  for (const id of ["raw", "clean", "thumb", "mask"]) {
    assert.ok(!serialized.includes(id), `${id} reached the backup`);
  }
  assert.ok(serialized.includes("front"), "the rest of the record still travels");
});

test("both backup strippers read the shared list", async () => {
  const source = await read("features/backup/cloud-backup.js");
  assert.match(source, /import \{ PHOTO_BLOB_ID_FIELDS \} from "\.\.\/\.\.\/data\/photo-blob-fields\.js";/);
  assert.equal((source.match(/\.\.\.PHOTO_BLOB_ID_FIELDS\]\);/g) || []).length, 2, "stripBinaryDeep and stripRuntimePhotoFields");
  for (const field of PHOTO_BLOB_ID_FIELDS) {
    assert.ok(!source.includes(`"${field}"]`), `${field} is spelled out again`);
  }
});

/* -------------------------- the release call sites ----------------------- */

test("every place that lets go of a photo lets go of all of its images", async () => {
  /* A release that names only some of the fields leaves the rest behind, and
     nothing ever points at them again. */
  const source = (await read("App.jsx")).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(source, /import \{ photoBlobIdsIn \} from "\.\/data\/photo-blob-fields\.js";/);
  for (const site of [
    "PHOTO_KEYS.forEach((k) => (Array.isArray(ph?.[k]) ? ph[k] : []).forEach((p) => out.push(...photoBlobIdsIn(p))));",
    "const discardedBlobIds = [...new Set(removal.removedRecords.flatMap(photoBlobIdsIn))]",
    "forgetBlobs(gone.flatMap(photoBlobIdsIn));",
    "forgetBlobs(photoBlobIdsIn(out));",
    "forgetBlobs(photoBlobIdsIn(previous).filter((blobId) => !kept.has(blobId)));",
    "forgetBlobs(photoBlobIdsIn(gone));",
  ]) {
    assert.ok(source.includes(site), `a release site does not use the shared list: ${site}`);
  }
});

test("no release site spells the field names out by hand any more", async () => {
  const source = (await read("App.jsx")).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!source.includes("[out.blobId, out.cleanBlobId]"));
  assert.ok(!source.includes("[gone?.blobId, gone?.cleanBlobId]"));
  assert.ok(!source.includes("pose.blobId, pose.cleanBlobId, pose.thumbnailBlobId"));
  assert.ok(!source.includes("[record?.blobId, record?.cleanBlobId]"));
});

test("a replaced pose keeps the images it is still using", async () => {
  /* The old record and the new one can share a file. Releasing the old set
     blindly would delete a file the new record still points at. */
  const source = (await read("App.jsx")).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(source.includes("const kept = new Set(photoBlobIdsIn(out));"));
});
