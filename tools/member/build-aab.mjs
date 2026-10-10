/**
 * 회원 앱 서명 AAB 를 만든다. `npm run member:aab`.
 *
 * ── 강사 앱 명령과 섞이지 않게 ──
 * 두 앱이 한 저장소에 있고 gradlew 도 폴더마다 따로다. 루트의
 * `npm run android:aab` 는 **강사 앱**의 것이고, 이것은 회원 앱의 것이다.
 * 이름이 비슷하면 언젠가 틀리게 부르므로, 이 스크립트는 시작할 때 자기가
 * 무엇을 만드는지 먼저 찍는다.
 *
 * ── 무엇을 확인하나 ──
 * build-aab.mjs(강사 앱)와 같은 셋이다. 번들이 나왔는가, debuggable 이
 * 아닌가, 서명이 읽히는가. 만든 파일의 절대 경로와 버전과 서명 지문을 찍는다.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { javaTool, useJava } from "../java-home.mjs";
import { MEMBER_UPLOAD_KEY, checkUploadSignature } from "./upload-key.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const memberApp = path.join(root, "member-app");
const androidRoot = path.join(memberApp, "android");
const isWindows = process.platform === "win32";

function fail(code, ...lines) {
  console.error(`\n[${code}]`);
  for (const line of lines) console.error(line);
  process.exit(1);
}

const quote = (value) => (/[\s&|<>^"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value);

function launcher(command) {
  if (command === "gradlew") return path.join(androidRoot, isWindows ? "gradlew.bat" : "gradlew");
  if (isWindows && (command === "npm" || command === "npx")) return `${command}.cmd`;
  return command;
}

function run(command, args, options = {}) {
  const result = isWindows
    ? spawnSync([launcher(command), ...args].map(quote).join(" "), {
      cwd: options.cwd ?? root, stdio: "inherit", env: process.env, shell: true,
    })
    : spawnSync(launcher(command), args, { cwd: options.cwd ?? root, stdio: "inherit", env: process.env });
  if (result.error) fail("SPAWN_FAILED", `${command} 을 실행하지 못했습니다: ${result.error.message}`);
  if (result.status !== 0) fail("STEP_FAILED", `${command} ${args.join(" ")} 이 ${result.status} 로 끝났습니다.`);
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd ?? root, encoding: "utf8" });
  return String(result.stdout || "").trim();
}

function findFiles(dir, name) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findFiles(full, name));
    else if (entry.name === name) found.push(full);
  }
  return found;
}

if (!existsSync(androidRoot)) {
  fail("MEMBER_ANDROID_MISSING",
    `회원 앱의 android 폴더가 없습니다: ${androidRoot}`,
    "member-app 안에서 `npx cap add android` 를 먼저 하세요.",
    "그 전에 Firebase 콘솔 등록과 google-services.json 이 필요합니다 (member-app/README.md).");
}

const gradle = readFileSync(path.join(androidRoot, "app", "build.gradle"), "utf8");
const applicationId = gradle.match(/applicationId\s+"([^"]+)"/)?.[1] ?? "?";
/* versionCode 는 Codemagic 이 -PmemberVersionCode 로 넘긴다. 로컬에서는 기본값이다. */
const declaredCode = gradle.match(/findProperty\('memberVersionCode'\) \?: '(\d+)'/)?.[1]
  ?? gradle.match(/versionCode\s+(\d+)/)?.[1] ?? "?";
const declaredName = gradle.match(/versionName\s+"([^"]+)"/)?.[1] ?? "?";

/* 강사 앱을 만들고 있는 것이 아닌지 여기서 멈춘다. 이름이 비슷한 두 명령이
   있으면 언젠가 틀리게 부르고, 그때 나오는 것은 잘못된 번들이 아니라
   **맞는 것처럼 보이는** 번들이다. */
if (applicationId !== "com.bonitapilates.member") {
  fail("WRONG_APPLICATION_ID",
    `회원 앱이 아닙니다: ${applicationId}`,
    "강사 앱은 `npm run android:aab` 로 만듭니다.");
}

const java = useJava();

console.log("== 어디서 무엇을 만드는지 먼저 밝힌다 ==");
console.log(`  앱      : 회원 앱 (${applicationId})`);
console.log(`  워크트리: ${root}`);
console.log(`  브랜치  : ${capture("git", ["rev-parse", "--abbrev-ref", "HEAD"])} (${capture("git", ["rev-parse", "--short", "HEAD"])})`);
console.log(`  버전    : versionCode ${declaredCode} / versionName "${declaredName}"`);
console.log(`  Java    : ${java.home} (${java.source})`);
console.log();

console.log("== 1/2 웹 빌드 · 동기화 ==");
run("npm", ["run", "member:sync"]);

console.log("== 2/2 번들 ==");
run("gradlew", ["bundleRelease", "--console=plain"], { cwd: androidRoot });

const aab = path.join(androidRoot, "app", "build", "outputs", "bundle", "release", "app-release.aab");
if (!existsSync(aab)) fail("BUNDLE_MISSING", `번들이 나오지 않았습니다: ${aab}`);

const intermediates = path.join(androidRoot, "app", "build", "intermediates");
const [manifest] = [
  ...findFiles(path.join(intermediates, "bundle_manifest", "release"), "AndroidManifest.xml"),
  ...findFiles(path.join(intermediates, "packaged_manifests", "release"), "AndroidManifest.xml"),
];

console.log();
console.log("== 만들어진 파일 ==");
console.log(`  ${aab}`);
const size = statSync(aab);
console.log(`  ${size.size.toLocaleString()} bytes  ${size.mtime.toISOString()}`);

if (!manifest) {
  fail("MANIFEST_NOT_FOUND", `빌드된 매니페스트를 찾지 못해 debuggable 여부를 확인할 수 없습니다: ${intermediates}`);
}
const built = readFileSync(manifest, "utf8");
console.log(`  package="${built.match(/package="([^"]*)"/)?.[1] ?? "?"}"`);
console.log(`  versionCode="${built.match(/versionCode="(\d+)"/)?.[1] ?? "?"}" versionName="${built.match(/versionName="([^"]*)"/)?.[1] ?? "?"}"`);
if (/android:debuggable="true"/.test(built)) {
  fail("DEBUGGABLE_BUNDLE", "debuggable=true 입니다. release 변형이 아닙니다.");
}

const certificate = capture(javaTool(java, "keytool"), ["-printcert", "-jarfile", aab]);
const signature = checkUploadSignature(certificate);
console.log(`  서명 SHA1: ${signature.found || "(읽지 못했습니다 -- 서명되지 않았을 수 있습니다)"}`);
if (signature.code === "SIGNATURE_UNREADABLE") fail("SIGNATURE_UNREADABLE", "번들에서 서명을 읽지 못했습니다.");
/* 회원 앱 전용 업로드 키여야 한다. 강사 앱 키로 서명된 번들은 여기까지 다
   통과하고 Play 업로드에서 거절당한다 (upload-key.mjs). */
if (!signature.ok) {
  fail("WRONG_UPLOAD_KEY",
    `회원 앱 업로드 키가 아닙니다. 기대 ${MEMBER_UPLOAD_KEY.sha1}`,
    "member-app/android/keystore.properties 가 ~/bonita-member-key/ 의 키를 가리키는지 보세요.");
}

console.log();
console.log("강사 앱의 android/ · ios/ 는 건드리지 않았습니다.");
