/**
 * Firestore 규칙 테스트. 에뮬레이터가 Java 를 쓰는데 이 기기의 Java 는 PATH 에
 * 없고 Android Studio 안에 있다 -- 프로세스 한정으로 얹고 돌린다.
 *
 * npm run test:rules 가 이것을 부른다. 실제 에뮬레이터 명령은
 * test:rules:emulator 에 그대로 있다 -- Java 가 이미 PATH 에 있는 환경(CI 등)
 * 에서는 그쪽을 직접 불러도 된다.
 *
 * bash 가 아니라 Node 인 이유는 build-aab.mjs 와 같다: 이 기기의 사용자는
 * PowerShell 을 쓰고 거기에는 bash 가 없다.
 */

import { spawnSync } from "node:child_process";
import { useJava } from "./java-home.mjs";

let java;
try {
  java = useJava();
} catch (error) {
  // 코드 없는 "실패했습니다" 를 남기지 않는다 -- 어디를 봤는지 말한다.
  console.error(`\n[${error.code ?? "JAVA_HOME_NOT_FOUND"}]`);
  console.error(error.message);
  process.exit(1);
}

console.log(`Java: ${java.home} (${java.source})\n`);

/* 윈도우의 npm 은 npm.cmd 이고 Node 는 이것을 직접 spawn 하지 않는다 --
   CVE-2024-27980 이후로 EINVAL 로 거절한다. 그래서 cmd.exe 를 거친다. */
const isWindows = process.platform === "win32";
// 셸을 거칠 때는 한 줄로 합친다 -- Node 가 배열을 그냥 이어 붙이기만 한다(DEP0190).
const result = isWindows
  ? spawnSync("npm.cmd run test:rules:emulator", { stdio: "inherit", env: process.env, shell: true })
  : spawnSync("npm", ["run", "test:rules:emulator"], { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
