/**
 * 회원 앱 웹 빌드를 네이티브로 옮긴다. `npm run member:sync`.
 *
 * ── 왜 별도 스크립트인가 ──
 * `npx cap sync` 는 **현재 폴더의 capacitor.config 를 본다.** 저장소 루트에서
 * 그냥 부르면 강사 앱 설정을 읽어 강사 앱의 `android/` 를 건드린다. 회원 앱을
 * 만들려다 강사 앱을 덮어쓰는 일이 한 번 일어나면 되돌릴 방법이 마땅치 않고,
 * 그 사실은 빌드가 끝난 뒤에야 드러난다.
 *
 * 그래서 이 스크립트는 **member-app/ 안에서만** cap 을 부른다. 루트의
 * android/ · ios/ 는 열지도 않는다.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const memberApp = path.join(root, "member-app");
const isWindows = process.platform === "win32";

/** 실패를 코드와 함께 말하고 멈춘다. 코드 없는 "실패했습니다" 를 남기지 않는다. */
function fail(code, ...lines) {
  console.error(`\n[${code}]`);
  for (const line of lines) console.error(line);
  process.exit(1);
}

const quote = (value) => (/[\s&|<>^"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value);

function run(command, args, options = {}) {
  const launcher = isWindows && (command === "npm" || command === "npx")
    ? `${command}.cmd`
    : command;
  const result = isWindows
    ? spawnSync([launcher, ...args].map(quote).join(" "), {
      cwd: options.cwd ?? root, stdio: "inherit", env: process.env, shell: true,
    })
    : spawnSync(launcher, args, { cwd: options.cwd ?? root, stdio: "inherit", env: process.env });
  if (result.error) fail("SPAWN_FAILED", `${command} 을 실행하지 못했습니다: ${result.error.message}`);
  if (result.status !== 0) fail("STEP_FAILED", `${command} ${args.join(" ")} 이 ${result.status} 로 끝났습니다.`);
}

/* 설정이 회원 앱의 것인지 먼저 본다. 여기서 강사 앱 번들이 나오면 그 다음
   단계가 전부 잘못된 자리로 간다. */
const configPath = path.join(memberApp, "capacitor.config.json");
if (!existsSync(configPath)) {
  fail("MEMBER_CONFIG_MISSING", `회원 앱 설정이 없습니다: ${configPath}`);
}
const config = JSON.parse(readFileSync(configPath, "utf8"));
if (config.appId !== "com.bonitapilates.member") {
  fail("WRONG_APP_ID", `회원 앱 설정의 appId 가 다릅니다: ${config.appId}`);
}

console.log("== 어디에 무엇을 넣는지 먼저 밝힌다 ==");
console.log(`  설정    : ${configPath}`);
console.log(`  번들 ID : ${config.appId}`);
console.log(`  앱 이름 : ${config.appName}`);
console.log(`  웹 출력 : ${path.resolve(memberApp, config.webDir)}`);
console.log();

console.log("== 1/2 회원 웹 빌드 ==");
run("npm", ["run", "build:member"]);

const hasNative = ["android", "ios"].some((name) => existsSync(path.join(memberApp, name)));
if (!hasNative) {
  console.log();
  console.log("네이티브 폴더가 아직 없습니다. 웹 빌드만 하고 끝냅니다.");
  console.log("만들려면 member-app 안에서:");
  console.log("  npx cap add android");
  console.log("  npx cap add ios");
  console.log("그 전에 Firebase 콘솔에서 앱 둘을 등록하고 설정 파일을 받아야 합니다");
  console.log("(member-app/README.md).");
  process.exit(0);
}

console.log();
console.log("== 2/2 회원 앱으로 복사 ==");
/* cwd 가 member-app 이다. 루트에서 부르면 강사 앱 설정을 읽는다. */
run("npx", ["cap", "sync"], { cwd: memberApp });

console.log();
console.log(`끝났습니다. 강사 앱의 android/ · ios/ 는 건드리지 않았습니다.`);
