/**
 * npm 스크립트가 이 기기의 셸에서 실제로 도는지 검사한다.
 *
 * `npm run android:aab` 가 `bash tools/android/build-aab.sh` 였다. 사용자는
 * PowerShell 을 쓰고 거기에 bash 는 없다 -- 한 줄로 만들려고 둔 명령이
 * "'bash'은(는) 내부 또는 외부 명령이 아닙니다" 로 끝났다. Git Bash 에서만
 * 돌아가는 것을 아무도 몰랐던 이유는 만든 사람이 Git Bash 에서만 돌려 봤기
 * 때문이다.
 *
 * 그래서 여기서 두 가지를 못 박는다.
 *   1. 스크립트가 bash 를 부르지 않는다
 *   2. AAB 빌드가 하던 검사를 잃지 않는다 -- 그것이 그 스크립트의 존재 이유다
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative) => readFile(new URL(`../../${relative}`, import.meta.url), "utf8");
const packageJson = JSON.parse(await read("package.json"));
const scripts = packageJson.scripts || {};

test("no npm script needs a shell this machine does not have", () => {
  /* sh·bash 는 PowerShell 에 없고, PowerShell 은 맥·리눅스에 없다. 한 벌로
     어디서나 도는 것은 node 뿐이라 그쪽으로 옮겼다.

     android:release:build 만 .ps1 로 남는다 -- 그것은 원래 윈도우 릴리스
     기계에서만 도는 명령이고, 거기에는 서명 키와 Play 자격이 있다. */
  const windowsOnly = new Set(["android:release:build"]);
  for (const [name, command] of Object.entries(scripts)) {
    if (windowsOnly.has(name)) continue;
    assert.doesNotMatch(command, /(^|\s|&&\s*)(bash|sh)\s/, `${name} 이 bash 를 부른다: ${command}`);
    assert.doesNotMatch(command, /\.sh(\s|$)/, `${name} 이 .sh 를 부른다: ${command}`);
    assert.doesNotMatch(command, /\bpowershell\b/, `${name} 이 powershell 을 부른다: ${command}`);
  }
});

test("the one-line AAB build still makes every check it was built to make", async () => {
  /* 이 목록이 이 스크립트의 전부다. Node 로 옮기면서 하나라도 빠지면 다시
     "어느 창에서 빌드했는지 모르는" 자리로 돌아간다. */
  const source = await read("tools/android/build-aab.mjs");
  const required = [
    [/keystore.properties/, "서명 값이 없으면 시작하기 전에 말한다"],
    [/"--abbrev-ref"/, "어느 브랜치인지 밝힌다"],
    [/"--short"/, "어느 커밋인지 밝힌다"],
    [/versionCode/, "선언된 버전을 밝힌다"],
    [/["run", "build"]/, "타입 검사와 테스트를 먼저 돌린다"],
    [/"cap", "sync", "android"/, "dist 를 안드로이드 자산으로 복사한다"],
    [/"bundleRelease"/, "release 변형으로 번들을 만든다"],
    [/android:debuggable="true"/, "debug 번들이면 실패한다"],
    [/keytool/, "서명 지문을 찍는다"],
  ];
  for (const [pattern, why] of required) {
    assert.ok(pattern.test(source), `AAB 빌드가 이 검사를 잃었다: ${why} (${pattern})`);
  }
});

test("a debug bundle fails the build rather than printing a warning", async () => {
  /* 경고만 찍고 0 으로 끝나면 스크롤 위로 사라진다. 실제로 2026-09-19 에
     debug 번들을 release 로 착각해 내보냈다. */
  const source = await read("tools/android/build-aab.mjs");
  const at = source.indexOf('android:debuggable="true"');
  assert.ok(at > 0);
  assert.match(source.slice(at, at + 200), /fail\(\s*"DEBUGGABLE_BUNDLE"/, "debuggable 이면 코드와 함께 멈춰야 한다");
});

test("finding Java is written once, so the two commands cannot drift apart", async () => {
  /* 규칙 테스트와 AAB 빌드가 똑같이 Java 를 찾는다. 경로 목록을 두 곳에 적으면
     한쪽만 고쳐지는 날이 온다. */
  for (const file of ["tools/android/build-aab.mjs", "tools/test-rules.mjs"]) {
    const source = await read(file);
    assert.match(source, /java-home\.mjs/, `${file} 이 공용 탐색을 쓰지 않는다`);
    assert.doesNotMatch(source, /Android Studio[\/]+jbr/, `${file} 이 경로를 따로 적어 두었다`);
  }
});

test("a Java that cannot be found says where it looked, with a code", async () => {
  // 코드 없는 "실패했습니다" 를 남기지 않는다 (CLAUDE.md 4항).
  const source = await read("tools/java-home.mjs");
  assert.match(source, /JAVA_HOME_NOT_FOUND/);
  assert.match(source, /순서대로 봤습니다/);
});
