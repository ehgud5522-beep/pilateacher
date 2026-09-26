/**
 * 큰 사진만 줄인다.
 *
 * 브라우저의 캔버스가 없으므로 디코더와 캔버스를 주입한다. 가짜 캔버스가
 * 내놓는 바이트는 **EXIF 가 없는 최소 JPEG**이다 -- 진짜 canvas.toBlob 도
 * EXIF 를 실어 보낼 수 없기 때문에, 이 테스트가 고정하는 것은 "줄인 결과가
 * 원본 바이트가 아니라 캔버스가 구운 바이트" 라는 사실이다.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { CAPTURE_MAX_EDGE, downscaleToFit } from "../../src/features/photos/downscale.js";
import { optimizePhotoBackup } from "../../src/features/backup/photo-optimizer.js";

/** APP1 세그먼트("Exif\0\0")가 들어 있는가. GPS 는 이 안에만 들어간다. */
function hasExif(bytes) {
  const view = new Uint8Array(bytes);
  for (let index = 0; index + 5 < view.length; index += 1) {
    if (view[index] === 0xff && view[index + 1] === 0xe1
      && view[index + 4] === 0x45 && view[index + 5] === 0x78) return true;
  }
  return false;
}

/** EXIF(GPS 포함)를 품은 JPEG 흉내. 실제 바이트 구조만 맞춘다. */
function jpegWithGps() {
  const exif = [
    0xff, 0xd8,                          // SOI
    0xff, 0xe1, 0x00, 0x16,              // APP1, 길이
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,  // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a,              // TIFF 헤더
    0x00, 0x00, 0x00, 0x08,
    0x88, 0x25, 0x00, 0x04,              // GPS IFD 포인터 태그
    0xff, 0xd9,                          // EOI
  ];
  return new Blob([new Uint8Array(exif)], { type: "image/jpeg" });
}

/** 캔버스가 구운 것처럼 EXIF 없는 JPEG 을 내놓는 가짜 캔버스. */
const fakeCanvas = () => {
  const drawn = [];
  const createCanvas = () => ({
    width: 0, height: 0,
    getContext: () => ({ drawImage: (...args) => drawn.push(args) }),
    toBlob(resolve, type, quality) {
      const body = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9]);
      const blob = new Blob([body], { type });
      blob.quality = quality;
      resolve(blob);
    },
  });
  return { createCanvas, drawn };
};

/** EXIF 방향을 실제로 적용하는 디코더 흉내. */
const decoderOf = (rawWidth, rawHeight, { rotated = false } = {}) => async (blob, options) => {
  const applied = rotated && options?.imageOrientation === "from-image";
  return {
    width: applied ? rawHeight : rawWidth,
    height: applied ? rawWidth : rawHeight,
    close() {},
  };
};

test("1440px 사진은 한 바이트도 바뀌지 않는다", async () => {
  const input = jpegWithGps();
  const { createCanvas, drawn } = fakeCanvas();
  const result = await downscaleToFit(input, {
    createBitmap: decoderOf(1080, 1440), createCanvas,
  });
  assert.equal(result.resized, false);
  assert.equal(result.reason, "within_limit");
  assert.equal(result.blob, input, "받은 blob 객체를 그대로 돌려준다");
  assert.equal(drawn.length, 0, "다시 굽지 않는다");
});

test("4032px 사진은 긴 변 1600 으로 줄어든다", async () => {
  const { createCanvas } = fakeCanvas();
  const result = await downscaleToFit(new Blob(["x"], { type: "image/jpeg" }), {
    createBitmap: decoderOf(4032, 3024), createCanvas,
  });
  assert.equal(result.resized, true);
  assert.equal(Math.max(result.width, result.height), CAPTURE_MAX_EDGE);
  assert.deepEqual([result.width, result.height], [1600, 1200]);
});

test("세로로 찍은 사진은 줄여도 세로다", async () => {
  /* 원시 픽셀은 4032×3024(가로)인데 EXIF 가 세로라고 말한다. 방향을 먼저
     적용하지 않으면 결과가 눕는다 -- iOS 폴백 경로에서 실제로 나는 일이다. */
  const { createCanvas } = fakeCanvas();
  const result = await downscaleToFit(new Blob(["x"], { type: "image/jpeg" }), {
    createBitmap: decoderOf(4032, 3024, { rotated: true }), createCanvas,
  });
  assert.equal(result.resized, true);
  assert.ok(result.height > result.width, `세로여야 하는데 ${result.width}x${result.height}`);
  assert.deepEqual([result.width, result.height], [1200, 1600]);
});

test("줄인 결과에는 GPS 가 남지 않는다", async () => {
  const input = jpegWithGps();
  assert.equal(hasExif(await input.arrayBuffer()), true, "입력에는 EXIF 가 있다");

  const { createCanvas } = fakeCanvas();
  const result = await downscaleToFit(input, {
    createBitmap: decoderOf(4032, 3024), createCanvas,
  });
  assert.equal(result.resized, true);
  assert.equal(hasExif(await result.blob.arrayBuffer()), false);
});

test("방향을 못 읽으면 줄이지 않는다 — 누운 사진을 만드느니 큰 파일이 낫다", async () => {
  const input = new Blob(["x"], { type: "image/jpeg" });
  const { createCanvas, drawn } = fakeCanvas();
  const result = await downscaleToFit(input, {
    createBitmap: async () => { throw new Error("imageOrientation unsupported"); },
    createCanvas,
  });
  assert.equal(result.resized, false);
  assert.equal(result.reason, "orientation_unknown");
  assert.equal(result.blob, input);
  assert.equal(drawn.length, 0);
});

test("제한 안이어도 JPEG 이 아니면 다시 굽는다", async () => {
  /* 제한은 픽셀에만 걸려 있다. 1200×1600 PNG 는 20MB 일 수 있다. */
  const { createCanvas } = fakeCanvas();
  const result = await downscaleToFit(new Blob(["x"], { type: "image/png" }), {
    createBitmap: decoderOf(1200, 1600), createCanvas,
  });
  assert.equal(result.resized, true);
  assert.equal(result.reason, "reencoded");
  assert.deepEqual([result.width, result.height], [1200, 1600], "크기는 그대로다");
  assert.equal(result.blob.type, "image/jpeg");
});

test("업로드 — 1800 이하 JPEG 은 재인코딩 없이 그대로 올라간다", async () => {
  const input = new Blob(["already-small"], { type: "image/jpeg" });
  const { createCanvas, drawn } = fakeCanvas();
  const result = await optimizePhotoBackup(input, {
    createBitmap: decoderOf(1080, 1440), createCanvas,
  });
  assert.equal(result.image.blob, input, "원본 바이트를 그대로 보낸다");
  assert.deepEqual([result.image.width, result.image.height], [1080, 1440]);
  assert.equal(drawn.length, 1, "썸네일만 새로 만든다");
  assert.deepEqual([result.thumbnail.width, result.thumbnail.height], [240, 320]);
});

test("업로드 — 1800 을 넘으면 줄인다 (예전 그대로)", async () => {
  const { createCanvas } = fakeCanvas();
  const result = await optimizePhotoBackup(new Blob(["big"], { type: "image/jpeg" }), {
    createBitmap: decoderOf(4000, 3000), createCanvas,
  });
  assert.deepEqual([result.image.width, result.image.height], [1800, 1350]);
  assert.deepEqual([result.thumbnail.width, result.thumbnail.height], [320, 240]);
});
