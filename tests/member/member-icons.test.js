import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * 회원 앱 아이콘. 그림이 맞는지는 사람이 보고(미리보기), 여기서는 **스토어와
 * 브라우저가 거절하거나 조용히 무시하는 것**만 막는다.
 *
 * 원본: member-app/resources/icon-source.png → node member-app/scripts/make-icons.mjs
 *       → npm run member:assets
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const file = (relative) => path.join(root, relative);

/** PNG 머리(IHDR)에서 크기와 색 형식을 읽는다. 2 = RGB(투명 없음), 6 = RGBA. */
function png(relative) {
  const bytes = readFileSync(file(relative));
  assert.equal(bytes.toString("ascii", 1, 4), "PNG", relative);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] };
}

test("iOS 앱 아이콘은 1024 정사각형이고 투명이 없다 — App Store 가 거절한다", () => {
  for (const relative of [
    "member-app/resources/icon-only.png",
    "member-app/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
  ]) {
    const info = png(relative);
    assert.deepEqual([info.width, info.height], [1024, 1024], relative);
    assert.notEqual(info.colorType, 6, `${relative} 에 알파 채널이 있다`);
    assert.notEqual(info.colorType, 4, `${relative} 에 알파 채널이 있다`);
  }
});

test("원본이 있고 정사각형이다", () => {
  const info = png("member-app/resources/icon-source.png");
  assert.equal(info.width, info.height);
});

test("Android 적응형 아이콘 뒷면은 검정이다", () => {
  const xml = readFileSync(file("member-app/android/app/src/main/res/values/ic_launcher_background.xml"), "utf8");
  assert.match(xml, /#000000/);
});

test("웹 아이콘 링크가 실제 파일을 가리킨다", () => {
  /* 링크가 없는 파일을 가리키면 브라우저는 404 를 조용히 넘기고 기본 아이콘을 쓴다. */
  const html = readFileSync(file("member/index.html"), "utf8");
  for (const href of [...html.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)"[^>]*href="\/([^"]+)"/g)].map((m) => m[1])) {
    assert.ok(existsSync(file(`member/public/${href}`)), href);
  }
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /rel="manifest"/);

  const manifest = JSON.parse(readFileSync(file("member/public/manifest.webmanifest"), "utf8"));
  assert.equal(manifest.name, "보니따필라테스");
  for (const icon of manifest.icons) {
    const info = png(`member/public${icon.src}`);
    assert.equal(`${info.width}x${info.height}`, icon.sizes, icon.src);
  }
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));
});
