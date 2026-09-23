/**
 * 회원 투영 트리거 테스트. Firestore 에뮬레이터에서 진짜 읽기·쓰기를 돌린다.
 *
 * 규칙 테스트와 같은 이유로 Node 다 -- 이 기기의 사용자는 PowerShell 을 쓰고
 * 거기에 bash 가 없다. Java 찾기도 같은 모듈을 쓴다 (tools/java-home.mjs).
 */

import { spawnSync } from "node:child_process";
import { useJava } from "./java-home.mjs";

let java;
try {
  java = useJava();
} catch (error) {
  console.error(`\n[${error.code ?? "JAVA_HOME_NOT_FOUND"}]`);
  console.error(error.message);
  process.exit(1);
}
console.log(`Java: ${java.home} (${java.source})\n`);

const isWindows = process.platform === "win32";
const command = [
  "firebase", "emulators:exec",
  "--only", "firestore",
  "--project", "pilateacher-dev",
  "--config", "firebase.foundation.json",
  '"node --test functions/tests/emulator/*.test.js"',
].join(" ");

const result = isWindows
  ? spawnSync(`npx.cmd ${command}`, { stdio: "inherit", env: process.env, shell: true })
  : spawnSync("npx", command.split(" "), { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
