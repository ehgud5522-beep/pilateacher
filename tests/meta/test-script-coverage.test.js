/**
 * 테스트가 실제로 도는지 검사한다.
 *
 * tests/ 아래에 디렉터리가 아홉 개 있었는데 어느 npm 스크립트에도 들어 있지
 * 않았다. 83개 파일이 쓰여 있고 아무도 돌리지 않았다 -- 그중 둘은 이미 깨져
 * 있었고, 깨진 줄 아무도 몰랐다.
 *
 * 파일 단위가 아니라 디렉터리 단위로, 그리고 glob 으로 덮였는지 본다. 파일
 * 이름을 하나씩 적어 둔 스크립트는 다음 파일이 추가될 때 다시 같은 구멍을
 * 만든다 -- 실제로 test:screen-smoke 와 test:android-release 가 그랬다.
 */

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
const scripts = packageJson.scripts || {};

/**
 * node 로 도는 묶음에서 빠지는 디렉터리와 그 이유.
 *
 * 둘 다 스크립트는 있고 prebuild 에만 들어가지 않는다. 웹 빌드가 만들지 않는
 * 것을 보거나, 빌드 기계에 없어도 되는 것을 요구하기 때문이다.
 */
const OUTSIDE_NODE_SUITE = {
  rules: "Firestore 에뮬레이터와 JDK 가 필요하다. 웹 빌드가 그것을 요구하면 안 된다.",
  android: "android/app/build.gradle 을 읽는다. 웹 빌드는 그 파일을 만들지 않는다.",
};

const testDirectories = async () => {
  const entries = await readdir(new URL("../", import.meta.url), { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const files = await readdir(new URL(`../${entry.name}/`, import.meta.url));
    if (files.some((file) => file.endsWith(".test.js"))) found.push(entry.name);
  }
  return found.sort();
};

const commandsOf = () => Object.values(scripts).join("\n");

test("every directory with tests is covered by an npm script", async () => {
  const directories = await testDirectories();
  assert.ok(directories.length > 10, `테스트 디렉터리를 찾지 못했다: ${directories.join(", ")}`);
  const commands = commandsOf();
  const missing = directories.filter((name) => !commands.includes(`tests/${name}/`));
  assert.deepEqual(missing, [], `어느 스크립트에도 들어 있지 않다: ${missing.join(", ")}`);
});

test("each directory is covered by a glob, not by a list of file names", async () => {
  /* 파일 이름을 적어 두면 다음 파일이 추가될 때 조용히 빠진다. tests/ui 는 그
     이유로 스무 개 중 한 개만 돌고 있었다. */
  const directories = await testDirectories();
  const commands = commandsOf();
  const notGlobbed = directories.filter((name) => !commands.includes(`tests/${name}/*.test.js`));
  assert.deepEqual(notGlobbed, [], `glob 으로 덮이지 않았다: ${notGlobbed.join(", ")}`);
});

test("the node suite runs every directory that does not need a device or an emulator", async () => {
  /* prebuild 가 이 묶음을 지나간다. 빠진 디렉터리는 빌드가 통과해도 깨져 있을
     수 있고, 그것이 이 파일이 생긴 이유다. */
  const directories = await testDirectories();
  const suite = scripts["test:node"] || "";
  assert.ok(suite.startsWith("node --test "), `test:node 가 한 번의 node --test 여야 한다: ${suite}`);
  /* && 로 잇지 않는다. 첫 실패에서 멈추면 그 뒤의 묶음이 돌지 않고, 무엇이
     깨졌는지 알고 싶어 만든 스크립트가 하나만 보여준다. */
  assert.ok(!suite.includes("&&"), "test:node 는 첫 실패에서 멈추면 안 된다");

  for (const name of directories) {
    const covered = suite.includes(`tests/${name}/*.test.js`);
    if (OUTSIDE_NODE_SUITE[name]) {
      assert.equal(covered, false, `${name} 은 빠져 있어야 한다 -- ${OUTSIDE_NODE_SUITE[name]}`);
      continue;
    }
    assert.ok(covered, `${name} 이 test:node 에 없다. 빌드가 통과해도 깨진 줄 모른다`);
  }
});

test("prebuild goes through the node suite", () => {
  /* 빌드 앞의 관문이다. 여기서 빠지면 "테스트가 있다"와 "테스트가 돈다"가
     갈라지고, 이 파일 전체가 무의미해진다. */
  assert.match(scripts.prebuild || "", /npm run test:node/);
  assert.match(scripts.prebuild || "", /npm run typecheck/);
  assert.match(scripts.prebuild || "", /npm run lint:runtime/);
});

test("what is left out of the node suite says why, right here", () => {
  // 빠진 이유가 코드 어딘가에만 있으면 다음 사람은 실수로 빠진 것으로 읽는다.
  for (const [name, reason] of Object.entries(OUTSIDE_NODE_SUITE)) {
    assert.ok(reason.length > 20, `${name} 의 이유가 너무 짧다`);
    assert.ok(scripts[`test:${name}`] || commandsOf().includes(`tests/${name}/`), `${name} 을 부르는 스크립트가 없다`);
  }
});
