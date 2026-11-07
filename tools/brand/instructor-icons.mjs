#!/usr/bin/env node
/**
 * 강사 앱(com.pilateacher.app) 아이콘 · 시작 화면 이미지를 한 장에서 전부 만든다 (2026-11-08 대표 지시).
 *
 *   node tools/brand/instructor-icons.mjs [원본.png]
 *
 * 원본: resources/icon-only.png (1024, 정사각형을 핫핑크로 가득 채운 것 -- 흰 여백 · 미리 깎은 둥근 모서리 없음).
 * 둥근 모서리는 각 OS 가 씌운다. 여기서는 안드로이드 옛 런처용 ic_launcher(둥근 사각) · ic_launcher_round(원)만 깎는다.
 *
 * 만드는 것
 * - iOS   AppIcon 1024 (알파 없음 -- App Store 가 알파를 거절한다)
 * - Android  mipmap-*: ic_launcher · ic_launcher_round · 적응형 배경(원본) · 전경(투명)
 * - Play   public/PlayStore-512.png (512, 알파 없음)
 * - 웹    icon-192 · icon-512 · icon-512-maskable · apple-touch-icon(180)
 * - 시작 화면  Android drawable-xxx/splash.png · iOS Splash.imageset · resources/splash*.png -- 어두운 배경 + 가운데 아이콘.
 *   웹 로딩 화면(App.jsx Splash)과 같은 배경이라 네이티브 → 웹으로 넘어갈 때 튀지 않는다.
 *
 * **보니따 VIP 회원 앱(member-app/)은 건드리지 않는다.**
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const masterPath = path.resolve(process.argv[2] || "resources/icon-only.png");

/* 웹 로딩 화면(App.jsx SPLASH_THEME)과 같은 색 */
export const SPLASH_COLORS = Object.freeze({ center: "#3A0C26", mid: "#1B0A16", edge: "#0E0A10", glow: "#EC1A72" });

const rel = (p) => path.relative(root, p).replace(/\\/g, "/");
const written = [];
const save = async (pipeline, file) => {
  await pipeline.png({ compressionLevel: 9 }).toFile(file);
  written.push(rel(file));
};

const roundedMask = (size, radiusRatio) => Buffer.from(
  `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${size * radiusRatio}" ry="${size * radiusRatio}" fill="#fff"/></svg>`,
);
const circleMask = (size) => Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);

async function shaped(master, size, mask) {
  const base = await sharp(master).resize(size, size, { kernel: "lanczos3" }).ensureAlpha().png().toBuffer();
  return sharp(base).composite([{ input: mask, blend: "dest-in" }]);
}

async function splashImage(master, width, height) {
  const s = Math.min(width, height);
  const icon = Math.round(s * 0.2);
  const glow = Math.round(icon * 2.6);
  const bg = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="bg" cx="50%" cy="46%" r="75%">
        <stop offset="0%" stop-color="${SPLASH_COLORS.center}"/>
        <stop offset="45%" stop-color="${SPLASH_COLORS.mid}"/>
        <stop offset="100%" stop-color="${SPLASH_COLORS.edge}"/>
      </radialGradient>
      <radialGradient id="glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="${SPLASH_COLORS.glow}" stop-opacity="0.38"/>
        <stop offset="100%" stop-color="${SPLASH_COLORS.glow}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#bg)"/>
    <circle cx="${width / 2}" cy="${height / 2}" r="${glow / 2}" fill="url(#glow)"/>
  </svg>`);
  const iconPng = await (await shaped(master, icon, roundedMask(icon, 0.225))).toBuffer();
  return sharp(bg).composite([{ input: iconPng, left: Math.round((width - icon) / 2), top: Math.round((height - icon) / 2) }]).flatten({ background: SPLASH_COLORS.edge });
}

async function main() {
  if (!fs.existsSync(masterPath)) throw new Error(`원본이 없습니다: ${masterPath}`);
  const meta = await sharp(masterPath).metadata();
  if (meta.width !== meta.height || meta.width < 1024) throw new Error(`원본은 1024 이상 정사각형이어야 합니다 (지금 ${meta.width}x${meta.height})`);
  const master = await sharp(masterPath).resize(1024, 1024).removeAlpha().png().toBuffer();
  const opaque = (size) => sharp(master).resize(size, size, { kernel: "lanczos3" }).removeAlpha();

  /* resources (다음에 capacitor-assets 를 써도 같은 그림이 나오게) */
  if (path.resolve("resources/icon-only.png") !== masterPath) await save(sharp(master), path.join(root, "resources/icon-only.png"));
  await save(sharp(master), path.join(root, "resources/icon-background.png"));
  await save(sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }), path.join(root, "resources/icon-foreground.png"));

  /* iOS */
  await save(opaque(1024), path.join(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"));

  /* Android 런처 -- 크기는 지금 있는 파일을 따른다 */
  const res = path.join(root, "android/app/src/main/res");
  for (const dir of fs.readdirSync(res).filter((d) => d.startsWith("mipmap-") && !d.includes("anydpi"))) {
    const at = (name) => path.join(res, dir, name);
    const size = (await sharp(at("ic_launcher.png")).metadata()).width;
    await save(await shaped(master, size, roundedMask(size, 0.18)), at("ic_launcher.png"));
    await save(await shaped(master, size, circleMask(size)), at("ic_launcher_round.png"));
    await save(opaque(size), at("ic_launcher_background.png"));
    await save(sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }), at("ic_launcher_foreground.png"));
  }

  /* Play · 웹 */
  await save(opaque(512), path.join(root, "public/PlayStore-512.png"));
  await save(opaque(512), path.join(root, "public/icon-512.png"));
  await save(opaque(512), path.join(root, "public/icon-512-maskable.png"));
  await save(opaque(192), path.join(root, "public/icon-192.png"));
  await save(opaque(180), path.join(root, "public/apple-touch-icon.png"));

  /* 시작 화면 -- 지금 있는 파일마다 그 크기로 */
  const splashes = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/^splash\.png$/i.test(name) || /^Default@\dx~universal~anyany(-dark)?\.png$/.test(name)) splashes.push(full);
    }
  };
  walk(res);
  walk(path.join(root, "ios/App/App/Assets.xcassets/Splash.imageset"));
  splashes.push(path.join(root, "resources/splash.png"), path.join(root, "resources/splash-dark.png"));
  for (const file of splashes) {
    const { width, height } = await sharp(file).metadata();
    await save(await splashImage(master, width, height), file);
  }

  console.log(`${written.length}개 파일을 만들었습니다`);
  for (const file of written) console.log(`  ${file}`);
}

main().catch((error) => { console.error(error.message || error); process.exit(1); });
