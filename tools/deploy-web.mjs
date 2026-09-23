/**
 * 웹 앱을 Firebase Hosting 으로 내보낸다. 한 줄로.
 *
 * ── 왜 있는가 ──
 * 대표가 PC 에서 앱을 쓰려면 지금까지 터미널을 켜고 dev 서버를 띄워야 했다.
 * 이관·발급·급여 집계는 폰보다 PC 가 편한 일인데, 그 앞에 개발 도구가 놓여
 * 있었다. 주소만 치면 되는 자리로 옮긴다.
 *
 * ── 왜 bash 가 아니라 Node 인가 ──
 * 이 기기의 사용자는 PowerShell 을 쓰고 거기에는 bash 가 없다. tools/java-home
 * 과 build-aab 이 같은 이유로 Node 다.
 *
 * ── 순서가 보장하는 것 ──
 * npm run build 가 prebuild 로 타입 검사·린트·테스트를 먼저 돌린다. 그래서
 * "테스트가 깨진 채로 나간 빌드" 가 나올 수 없다. 배포는 그 뒤에만 일어난다.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const CONFIG = "firebase.foundation.json";

function fail(code, ...lines) {
  console.error(`\n[${code}]`);
  for (const line of lines) console.error(line);
  process.exit(1);
}

/* 윈도우의 npm·npx 는 .cmd 이고 Node 는 이것을 직접 spawn 하지 않는다
   (CVE-2024-27980 이후 EINVAL). cmd.exe 를 거치고, 인자는 배열로 넘기지 않고
   따옴표를 직접 붙여 한 줄로 합친다 (DEP0190). build-aab.mjs 와 같은 방식이다. */
const quoteForShell = (value) => (/[\s&|<>^"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value);

function run(command, args) {
  const result = isWindows
    ? spawnSync([`${command}.cmd`, ...args].map(quoteForShell).join(" "), {
      cwd: root, stdio: "inherit", env: process.env, shell: true,
    })
    : spawnSync(command, args, { cwd: root, stdio: "inherit", env: process.env });
  if (result.error) fail("SPAWN_FAILED", `${command} 을 실행하지 못했습니다: ${result.error.message}`);
  if (result.status !== 0) fail("STEP_FAILED", `${command} ${args.join(" ")} 이 ${result.status} 로 끝났습니다.`);
}

const capture = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  return result.status === 0 ? String(result.stdout ?? "").trim() : "";
};

/* ── 시작하기 전에 ──────────────────────────────────────────────────── */

if (!existsSync(path.join(root, CONFIG))) fail("CONFIG_MISSING", `${CONFIG} 이 없습니다.`);
const config = JSON.parse(readFileSync(path.join(root, CONFIG), "utf8"));
if (!config.hosting?.public) fail("HOSTING_NOT_CONFIGURED", `${CONFIG} 에 hosting 설정이 없습니다.`);

/* SPA 는 모든 경로가 index.html 로 가야 한다. 이 규칙이 빠지면 새로고침이나
   주소 직접 입력이 404 가 되고, 그 증상은 배포한 사람이 아니라 대표가 만난다. */
const fallback = (config.hosting.rewrites || []).some(
  (rule) => rule?.source === "**" && rule?.destination === "/index.html",
);
if (!fallback) fail("SPA_FALLBACK_MISSING", `${CONFIG} 의 hosting.rewrites 에 ** → /index.html 이 없습니다.`);

console.log("== 어디서 무엇을 내보내는지 먼저 밝힌다 ==");
console.log(`  워크트리: ${root}`);
console.log(`  브랜치  : ${capture("git", ["rev-parse", "--abbrev-ref", "HEAD"])} (${capture("git", ["rev-parse", "--short", "HEAD"])})`);
console.log(`  대상    : ${config.hosting.public}/ → Firebase Hosting (pilateacher)`);
console.log();

console.log("== 1/2 웹 빌드 (타입 검사 · 린트 · 테스트 포함) ==");
run("npm", ["run", "build"]);

const publicDir = path.join(root, config.hosting.public);
if (!existsSync(path.join(publicDir, "index.html"))) {
  fail("BUILD_OUTPUT_MISSING", `${config.hosting.public}/index.html 이 없습니다. 빌드가 만들지 못했습니다.`);
}
/* 서비스 워커가 빠지면 이미 설치한 브라우저가 404 를 받고 오프라인 셸을 잃는다.
   빌드가 조용히 빠뜨릴 수 있는 파일이라 여기서 본다. */
if (!existsSync(path.join(publicDir, "sw.js"))) {
  fail("SERVICE_WORKER_MISSING", `${config.hosting.public}/sw.js 가 없습니다. public/sw.js 가 복사되지 않았습니다.`);
}

const bytesIn = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((sum, item) => {
  const full = path.join(dir, item.name);
  return sum + (item.isDirectory() ? bytesIn(full) : statSync(full).size);
}, 0);
console.log(`\n  ${config.hosting.public}/ ${bytesIn(publicDir).toLocaleString()} bytes\n`);

console.log("== 2/2 배포 ==");
run("npx", ["firebase", "deploy", "--only", "hosting", "--project", "pilateacher", "--config", CONFIG]);

console.log();
console.log("주소: https://pilateacher.web.app");
console.log("사용자 지정 도메인은 docs/web-hosting.md 를 보세요.");
