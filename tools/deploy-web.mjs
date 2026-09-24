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
import { deployBlockers } from "./deploy-guard.mjs";

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

/* 무엇이 나가는지 알 수 있는 상태인가. 웹은 스토어 심사 같은 관문이 없어서
   누르는 즉시 전부에게 가고, 되돌리려면 다시 배포하는 수밖에 없다.

   판정은 tools/deploy-guard.mjs 에 있다 -- git 상태를 만들어 가며 시험할 수는
   없으므로 떼어 두었다. */
const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
/* porcelain 은 trim 하지 않는다. ` M path` 의 첫 칸이 공백이라, 출력 전체를
   trim 하면 첫 줄만 한 칸 밀려 경로가 한 글자 깎인다 -- package-lock.json 이
   제외 목록에 걸리지 않는 채로 배포가 막혔다. */
const statusResult = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
const status = statusResult.status === 0 ? String(statusResult.stdout ?? "") : "";
const blockers = deployBlockers({ branch, status });
if (blockers.length) {
  console.error("\n배포를 멈춥니다.\n");
  for (const blocker of blockers) console.error(`  [${blocker.code}] ${blocker.message}\n`);
  process.exit(1);
}

if (!existsSync(path.join(root, CONFIG))) fail("CONFIG_MISSING", `${CONFIG} 이 없습니다.`);
const config = JSON.parse(readFileSync(path.join(root, CONFIG), "utf8"));

/* 사이트가 둘이다. 강사 앱과 회원 앱은 번들도 크기도 다르고, 한 사이트에
   두면 SPA fallback(** → /index.html) 이 둘을 가르지 못한다 -- 그 한 줄이
   틀리면 회원이 강사 앱 2.1MB 를 받는다. */
const SITES = {
  app: {
    site: "pilateacher", build: "build", url: "https://pilateacher.web.app",
    /* 서비스 워커가 빠지면 이미 설치한 브라우저가 404 를 받고 오프라인 셸을
       잃는다. 빌드가 조용히 빠뜨릴 수 있는 파일이라 여기서 본다. */
    requiresServiceWorker: true,
  },
  member: {
    site: "pilateacher-member", build: "build:member", url: "https://pilateacher-member.web.app",
    /* 회원 앱에는 서비스 워커를 두지 않는다. 이 화면의 값어치 전부가 "지금
       몇 회 남았나" 인데 캐시가 어제 숫자를 보여주면 그것은 틀린 답이다. */
    requiresServiceWorker: false,
  },
};

const siteArgument = process.argv.includes("--site")
  ? String(process.argv[process.argv.indexOf("--site") + 1] || "").trim()
  : "app";
const target = SITES[siteArgument];
if (!target) fail("UNKNOWN_SITE", `--site 는 ${Object.keys(SITES).join(" · ")} 중 하나입니다: ${siteArgument}`);

const hostingList = Array.isArray(config.hosting) ? config.hosting : [config.hosting];
const hosting = hostingList.find((entry) => entry?.site === target.site) || null;
if (!hosting?.public) {
  fail("HOSTING_NOT_CONFIGURED", `${CONFIG} 에 site "${target.site}" 의 hosting 설정이 없습니다.`);
}

/* SPA 는 모든 경로가 index.html 로 가야 한다. 이 규칙이 빠지면 새로고침이나
   주소 직접 입력이 404 가 되고, 그 증상은 배포한 사람이 아니라 대표가 만난다. */
const fallback = (hosting.rewrites || []).some(
  (rule) => rule?.source === "**" && rule?.destination === "/index.html",
);
if (!fallback) fail("SPA_FALLBACK_MISSING", `${CONFIG} 의 ${target.site} rewrites 에 ** → /index.html 이 없습니다.`);

console.log("== 어디서 무엇을 내보내는지 먼저 밝힌다 ==");
console.log(`  워크트리: ${root}`);
console.log(`  브랜치  : ${capture("git", ["rev-parse", "--abbrev-ref", "HEAD"])} (${capture("git", ["rev-parse", "--short", "HEAD"])})`);
console.log(`  대상    : ${hosting.public}/ → Firebase Hosting (${target.site})`);
console.log();

console.log("== 1/2 웹 빌드 (타입 검사 · 린트 · 테스트 포함) ==");
run("npm", ["run", target.build]);

const publicDir = path.join(root, hosting.public);
if (!existsSync(path.join(publicDir, "index.html"))) {
  fail("BUILD_OUTPUT_MISSING", `${hosting.public}/index.html 이 없습니다. 빌드가 만들지 못했습니다.`);
}
if (target.requiresServiceWorker && !existsSync(path.join(publicDir, "sw.js"))) {
  fail("SERVICE_WORKER_MISSING", `${hosting.public}/sw.js 가 없습니다. public/sw.js 가 복사되지 않았습니다.`);
}

const bytesIn = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((sum, item) => {
  const full = path.join(dir, item.name);
  return sum + (item.isDirectory() ? bytesIn(full) : statSync(full).size);
}, 0);
console.log(`\n  ${hosting.public}/ ${bytesIn(publicDir).toLocaleString()} bytes\n`);

console.log("== 2/2 배포 ==");
/* 사이트를 이름으로 지정한다. --only hosting 만 주면 두 사이트가 함께 나가고,
   회원 앱을 고치려다 강사 앱까지 내보내게 된다. */
run("npx", [
  "firebase", "deploy", "--only", `hosting:${target.site}`,
  "--project", "pilateacher", "--config", CONFIG,
]);

console.log();
console.log(`주소: ${target.url}`);
console.log("사용자 지정 도메인은 docs/web-hosting.md 를 보세요.");
