/**
 * 회원 앱 아이콘 원본 하나(`member-app/resources/icon-source.png`)에서
 * 나머지를 전부 만든다.
 *
 *   node member-app/scripts/make-icons.mjs     # 그다음 npm run member:assets
 *
 * 만드는 것
 *   member-app/resources/   icon-only · icon-foreground · icon-background ·
 *                           splash · splash-dark   (capacitor-assets 의 원본)
 *   member/public/          favicon · apple-touch-icon · PWA 아이콘 · manifest
 *
 * ── 왜 원본을 하나로 두나 ──
 * 다섯 장을 손으로 따로 만들면 언젠가 한 장만 옛 로고로 남는다. 원본이 바뀌면
 * 이것을 다시 돌리면 된다.
 *
 * ── 안전 영역 ──
 * Android 적응형 아이콘은 108dp 캔버스를 기기마다 다른 모양(원 · 둥근 사각형 ·
 * 물방울)으로 자른다. 어떤 모양이든 **가운데 지름 66dp 원**은 남는다. 그래서
 * 전경의 글자는 그 원 안에만 둔다 -- 원 밖으로 한 픽셀이라도 나가면 이 스크립트가
 * 멈춘다. 눈으로 확인하는 것으로는 어느 기기에서 B 나 A 끝이 잘리는지 모른다.
 *
 * 강사 앱(루트 resources/ · android/ · ios/)은 열지 않는다.
 */

import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// sharp 는 @capacitor/assets 가 들고 온다. 같은 것을 쓴다.
const sharp = createRequire(path.join(root, "node_modules/@capacitor/assets/package.json"))("sharp");

const resources = path.join(root, "member-app/resources");
const web = path.join(root, "member/public");
const SOURCE = path.join(resources, "icon-source.png");

const BLACK = { r: 0, g: 0, b: 0, alpha: 1 };
const ICON = 1024;
const SPLASH = 2732;
/**
 * 적응형 아이콘에서 어떤 마스크에도 남는 원의 반지름, **이 1024px 원본 기준**.
 *
 * capacitor-assets 는 앞면을 `inset 16.7%` 로 넣는다 (mipmap-anydpi-v26/
 * ic_launcher.xml). 108dp 캔버스의 가운데 72dp -- 마스크가 자르는 보이는
 * 영역 전체 -- 가 곧 이 원본 1024px 이다. 안전 원 66dp 는 그 안에서
 * 1024 × 66/72 지름이다. 108 로 나누면 글자가 쓸데없이 작아진다 (처음에 그렇게
 * 만들었다가 생성된 XML 을 보고 고쳤다).
 */
export const SAFE_RADIUS = (ICON * 66) / 72 / 2;
/** 그 원 안에서도 가장자리에 붙지 않게 둔다. */
const SAFE_MARGIN = 0.94;
/** 스플래시에서 로고 너비 (캔버스 대비). */
const SPLASH_LOGO = 0.22;

function fail(code, message) {
  console.error(`\n[${code}] ${message}`);
  process.exit(1);
}

if (!existsSync(SOURCE)) fail("ICON_SOURCE_MISSING", `${SOURCE} 가 없습니다.`);

const meta = await sharp(SOURCE).metadata();
if (meta.width !== meta.height) fail("ICON_SOURCE_NOT_SQUARE", `원본이 정사각형이 아닙니다: ${meta.width}x${meta.height}`);

/* 글자만 떼어 낸다 (검정 바탕을 잘라 낸다). */
const { data: trimmedBuffer, info: trimmed } = await sharp(SOURCE)
  .flatten({ background: BLACK })
  .trim({ background: "#000000", threshold: 24 })
  .toBuffer({ resolveWithObject: true });

/* 글자 색. 가장 밝은 픽셀들의 평균이다 -- 테두리 안티앨리어싱은 섞지 않는다. */
const { data: raw, info: rawInfo } = await sharp(trimmedBuffer).removeAlpha().raw()
  .toBuffer({ resolveWithObject: true });
const sum = [0, 0, 0];
let count = 0;
for (let index = 0; index < raw.length; index += rawInfo.channels) {
  const [r, g, b] = [raw[index], raw[index + 1], raw[index + 2]];
  if (Math.max(r, g, b) > 200) { sum[0] += r; sum[1] += g; sum[2] += b; count += 1; }
}
if (!count) fail("ICON_SOURCE_NO_LOGO", "원본에서 글자를 찾지 못했습니다.");
const ink = { r: Math.round(sum[0] / count), g: Math.round(sum[1] / count), b: Math.round(sum[2] / count) };

/**
 * 글자를 투명 바탕으로. 바탕이 검정이므로 가장 밝은 채널이 곧 글자의 덮임
 * 정도다 -- 테두리의 반투명까지 그대로 살린다.
 */
async function logoOnTransparent(width) {
  const height = Math.round((trimmed.height * width) / trimmed.width);
  const resized = await sharp(trimmedBuffer).resize(width, height).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = Buffer.alloc(width * height * 4);
  const peak = Math.max(ink.r, ink.g, ink.b);
  for (let index = 0, out = 0; index < resized.data.length; index += 3, out += 4) {
    const level = Math.max(resized.data[index], resized.data[index + 1], resized.data[index + 2]);
    pixels[out] = ink.r;
    pixels[out + 1] = ink.g;
    pixels[out + 2] = ink.b;
    pixels[out + 3] = Math.min(255, Math.round((level / peak) * 255));
  }
  return { buffer: await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer(), width, height };
}

const square = (size) => sharp({ create: { width: size, height: size, channels: 3, background: BLACK } });

/** 글자가 원 안에 다 들어가는 가장 큰 너비. 모서리(대각선 끝)가 기준이다. */
const halfDiagonal = Math.hypot(trimmed.width / 2, trimmed.height / 2);
const foregroundWidth = Math.floor((trimmed.width * SAFE_RADIUS * SAFE_MARGIN) / halfDiagonal);

/* ── 1. iOS · 기본 아이콘: 원본 그대로, 투명 없이 ───────────────────── */
await sharp(SOURCE).resize(ICON, ICON).flatten({ background: BLACK }).removeAlpha()
  .png().toFile(path.join(resources, "icon-only.png"));

/* ── 2. Android 적응형: 뒷면은 단색 검정, 앞면은 안전 영역 안의 글자 ──── */
await square(ICON).png().toFile(path.join(resources, "icon-background.png"));
const foregroundLogo = await logoOnTransparent(foregroundWidth);
const foreground = await sharp({ create: { width: ICON, height: ICON, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: foregroundLogo.buffer, gravity: "centre" }])
  .png().toBuffer();
writeFileSync(path.join(resources, "icon-foreground.png"), foreground);

/* 안전 영역 검사. 보이는 픽셀이 하나라도 원 밖이면 멈춘다. */
{
  const { data, info } = await sharp(foreground).raw().toBuffer({ resolveWithObject: true });
  const centre = ICON / 2;
  let farthest = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] > 8) {
        farthest = Math.max(farthest, Math.hypot(x + 0.5 - centre, y + 0.5 - centre));
      }
    }
  }
  if (farthest > SAFE_RADIUS) {
    fail("ICON_OUTSIDE_SAFE_ZONE", `글자가 안전 영역 밖까지 나갑니다: ${farthest.toFixed(1)}px > ${SAFE_RADIUS.toFixed(1)}px`);
  }
  console.log(`  적응형 앞면: 글자 너비 ${foregroundWidth}px, 가장 먼 픽셀 ${farthest.toFixed(1)}px / 안전 반지름 ${SAFE_RADIUS.toFixed(1)}px`);
}

/* ── 3. 스플래시: 검정 바탕, 가운데 작은 로고 (밝은 · 어두운 모드 같게) ── */
const splashLogo = await sharp(trimmedBuffer).resize(Math.round(SPLASH * SPLASH_LOGO)).png().toBuffer();
for (const name of ["splash.png", "splash-dark.png"]) {
  await square(SPLASH).composite([{ input: splashLogo, gravity: "centre" }])
    .png().toFile(path.join(resources, name));
}

/* ── 4. 웹 (PWA · 파비콘) ──────────────────────────────────────────── */
mkdirSync(path.join(web, "icons"), { recursive: true });
const opaque = (size) => sharp(SOURCE).resize(size, size).flatten({ background: BLACK }).removeAlpha().png();
await opaque(180).toFile(path.join(web, "apple-touch-icon.png"));
await opaque(192).toFile(path.join(web, "icons/icon-192.png"));
await opaque(512).toFile(path.join(web, "icons/icon-512.png"));
await opaque(32).toFile(path.join(web, "favicon-32.png"));
/* maskable: 안드로이드 홈 화면이 원이나 둥근 사각형으로 자른다. 웹 규칙의 안전
   영역은 앱과 다르다 -- 가운데 지름 80% 원이다. 그래서 따로 맞춘다. */
{
  const MASKABLE = 512;
  const radius = MASKABLE * 0.4 * SAFE_MARGIN;
  const logo = await logoOnTransparent(Math.floor((trimmed.width * radius) / halfDiagonal));
  await square(MASKABLE).composite([{ input: logo.buffer, gravity: "centre" }]).removeAlpha().png()
    .toFile(path.join(web, "icons/icon-maskable-512.png"));
}

console.log("  만들었습니다: member-app/resources/ 다섯 장 · member/public/ 아이콘");
console.log("  다음: npm run member:assets");
