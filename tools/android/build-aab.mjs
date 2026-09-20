/**
 * 서명된 릴리스 AAB 를 한 줄로 만든다. Android Studio 를 열지 않는다.
 *
 * ── 왜 있는가 ──
 * 워크트리가 스무 개가 넘고 Android Studio 창이 여러 개 열려 있으면, 어느 창에서
 * 빌드했는지가 매번 헷갈린다. 빌드 변형(Build Variant)이 debug 로 남아 있으면
 * "Generate Signed App Bundle" 도 debug 번들을 뱉는데, 알림 문구는 성공이라 그
 * 사실이 드러나지 않는다 -- release 폴더의 옛 파일을 보고 새 빌드로 착각하게 된다.
 *
 * 이 스크립트는 지금 폴더가 어디든 이 저장소 루트를 기준으로 돌고, 끝나면 만든
 * 파일의 절대 경로와 버전과 서명 지문을 찍는다.
 *
 * ── 왜 bash 가 아니라 Node 인가 ──
 * 이 기기의 사용자는 PowerShell 을 쓰고 거기에는 bash 가 없다. .ps1 을 따로 두면
 * 두 벌이 되어 언젠가 한쪽만 고쳐진다 -- 그때 어긋나는 것이 하필 debuggable 검사
 * 라면 debug 번들이 그대로 Play 로 간다. Node 는 이 저장소가 이미 쓰고 있으므로
 * 의존성이 늘지 않고, 한 벌로 윈도우·맥·리눅스에서 같이 돈다.
 *
 * ── 이것이 대신하지 않는 것 ──
 * Play 에 올릴 AAB 는 `npm run android:release:build` 로 만든다. 그쪽은 브랜치,
 * 승인 UI 기준 커밋, 정책의 lastPublishedVersionCode 까지 본다
 * (docs/android-release-safety.md). 이 스크립트는 그 셋을 보지 않는다.
 *
 * 대신 실질적인 것은 순서로 보장한다: npm run build 가 타입 검사와 테스트를
 * 먼저 돌리고(prebuild), cap sync 가 dist 를 안드로이드 자산으로 복사하므로
 * "옛 화면이 담긴 최신 버전 코드" 가 나올 수 없다.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { javaTool, useJava } from "../java-home.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const isWindows = process.platform === "win32";

/** 실패를 코드와 함께 말하고 멈춘다. 코드 없는 "실패했습니다" 를 남기지 않는다. */
function fail(code, ...lines) {
  console.error(`\n[${code}]`);
  for (const line of lines) console.error(line);
  process.exit(1);
}

/**
 * 윈도우의 npm·npx·gradlew 는 .cmd / .bat 이고, Node 는 이것을 직접 spawn 하지
 * 않는다 -- CVE-2024-27980 이후로 EINVAL 로 거절한다. 그래서 윈도우에서만
 * cmd.exe 를 거친다.
 *
 * 셸을 거치면 인자가 다시 해석되므로, 공백이나 메타문자가 든 인자는 따옴표로
 * 감싼다. 지금 넘기는 것은 전부 단순하지만 다음 사람이 경로를 하나 넘기는 날
 * 조용히 두 토막이 나는 일을 막는다.
 */
function launcher(command) {
  /* gradlew 는 PATH 에 없고 android/ 안에 있다. cmd.exe 는 현재 폴더를 실행
     경로에서 빼도록 설정된 기기가 있어(NoDefaultCurrentDirectoryInExePath)
     이름만 넘기면 "인식할 수 없는 명령" 으로 끝난다 -- 절대 경로로 부른다. */
  if (command === "gradlew") return path.join(root, "android", isWindows ? "gradlew.bat" : "gradlew");
  return isWindows ? `${command}.cmd` : command;
}

const quoteForShell = (value) => (/[\s&|<>^"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value);

function run(command, args, options = {}) {
  /* 셸을 거칠 때는 인자를 따로 넘기지 않고 한 줄로 합친다. Node 가 배열을 그냥
     이어 붙이기만 하므로(DEP0190) 따옴표는 여기서 우리가 붙인다 -- 명령 자체도
     포함이다. 워크트리 경로에 공백이 있을 수 있다. */
  const result = isWindows
    ? spawnSync([launcher(command), ...args].map(quoteForShell).join(" "), {
      cwd: options.cwd ?? root, stdio: "inherit", env: process.env, shell: true,
    })
    : spawnSync(launcher(command), args, {
      cwd: options.cwd ?? root, stdio: "inherit", env: process.env,
    });
  if (result.error) fail("SPAWN_FAILED", `${command} 을 실행하지 못했습니다: ${result.error.message}`);
  if (result.status !== 0) fail("STEP_FAILED", `${command} ${args.join(" ")} 이 ${result.status} 로 끝났습니다.`);
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd ?? root, encoding: "utf8" });
  return result.status === 0 ? String(result.stdout ?? "").trim() : "";
}

/** 폴더 아래에서 이름이 같은 파일을 모두 모아 최신 것부터 돌려준다. */
function findFiles(dir, name) {
  if (!existsSync(dir)) return [];
  const found = [];
  const walk = (current) => {
    for (const item of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.name === name) found.push(full);
    }
  };
  walk(dir);
  return found.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
}

/* ── 시작하기 전에 막을 것은 여기서 막는다 ──────────────────────────────────
   몇 분 기다린 끝에 듣는 것과 시작하자마자 듣는 것은 다르다. */

let java;
try {
  java = useJava();
} catch (error) {
  fail(error.code ?? "JAVA_HOME_NOT_FOUND", error.message);
}

if (!existsSync(path.join(root, "android", "keystore.properties"))) {
  fail(
    "KEYSTORE_MISSING",
    "android/keystore.properties 가 없습니다. 이 파일은 저장소에 없고",
    "릴리스를 만드는 PC 에만 둡니다 (docs/android-release-safety.md 2단계).",
  );
}

/* ── 어디서 만드는지 먼저 밝힌다 ──────────────────────────────────────────── */

const gradle = readFileSync(path.join(root, "android", "app", "build.gradle"), "utf8");
const declaredCode = gradle.match(/versionCode\s+(\d+)/)?.[1] ?? "?";
const declaredName = gradle.match(/versionName\s+"([^"]+)"/)?.[1] ?? "?";

console.log("== 어디서 만드는지 먼저 밝힌다 ==");
console.log(`  워크트리: ${root}`);
console.log(`  브랜치  : ${capture("git", ["rev-parse", "--abbrev-ref", "HEAD"])} (${capture("git", ["rev-parse", "--short", "HEAD"])})`);
console.log(`  버전    : versionCode ${declaredCode} / versionName "${declaredName}"`);
console.log(`  Java    : ${java.home} (${java.source})`);
console.log();

console.log("== 1/3 웹 빌드 (타입 검사 · 린트 · 테스트 포함) ==");
run("npm", ["run", "build"]);

console.log("== 2/3 안드로이드로 복사 ==");
run("npx", ["cap", "sync", "android"]);

console.log("== 3/3 서명된 번들 ==");
run("gradlew", ["bundleRelease", "--console=plain"], { cwd: path.join(root, "android") });

/* ── 나온 것을 확인한다 ─────────────────────────────────────────────────── */

const aab = path.join(root, "android", "app", "build", "outputs", "bundle", "release", "app-release.aab");
if (!existsSync(aab)) fail("BUNDLE_MISSING", `번들이 나오지 않았습니다: ${aab}`);

const intermediates = path.join(root, "android", "app", "build", "intermediates");
const [manifest] = [
  ...findFiles(path.join(intermediates, "bundle_manifest", "release"), "AndroidManifest.xml"),
  ...findFiles(path.join(intermediates, "packaged_manifests", "release"), "AndroidManifest.xml"),
];

console.log();
console.log("== 만들어진 파일 ==");
console.log(`  ${aab}`);
const size = statSync(aab);
console.log(`  ${size.size.toLocaleString()} bytes  ${size.mtime.toISOString()}`);

/* 매니페스트를 못 읽으면 debuggable 검사를 못 한다. 그냥 넘어가면 이 스크립트가
   있는 이유가 사라지므로, 조용히 통과시키지 않고 실패로 말한다. */
if (!manifest) {
  fail("MANIFEST_NOT_FOUND", `빌드된 매니페스트를 찾지 못해 debuggable 여부를 확인할 수 없습니다: ${intermediates}`);
}

const built = readFileSync(manifest, "utf8");
const builtCode = built.match(/versionCode="(\d+)"/)?.[1] ?? "?";
const builtName = built.match(/versionName="([^"]*)"/)?.[1] ?? "?";
console.log(`  versionCode="${builtCode}" versionName="${builtName}"`);

// debuggable 이 붙어 있으면 debug 변형이다 -- Play 가 받지 않는다.
if (/android:debuggable="true"/.test(built)) {
  fail("DEBUGGABLE_BUNDLE", "debuggable=true 입니다. release 변형이 아닙니다.");
}

const certificate = capture(javaTool(java, "keytool"), ["-printcert", "-jarfile", aab]);
const sha1 = certificate.split(/\r?\n/).find((line) => /SHA1:/i.test(line));
console.log(`  서명 ${sha1 ? sha1.trim() : "(읽지 못했습니다 -- 서명되지 않았을 수 있습니다)"}`);
if (!sha1) fail("SIGNATURE_UNREADABLE", "번들에서 서명을 읽지 못했습니다.");

console.log();
console.log("Play 에 올릴 것이면 npm run android:release:build 로 다시 만드세요 --");
console.log("이 스크립트는 브랜치와 정책(lastPublishedVersionCode)을 보지 않습니다.");
