import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 루트에서 도는 테스트가 **루트에 없는 패키지를 부르지 않는지** 검사한다.
 *
 * ── 왜 생겼는가 ──
 * 2026-10-03 Codemagic 이 "Build web" 에서 멈췄다. `tests/membership/pass-admin.test.js`
 * 가 `functions/src/pass-admin.js` 를 읽었고, 그 파일이 모듈 맨 위에서
 * `require("firebase-admin/firestore")` 를 했다.
 *
 * firebase-admin 은 `functions/node_modules` 에만 있다. CI 는 저장소 루트에서만
 * `npm install` 하므로 그 폴더가 **아예 없다**. 이 기기에서는 전부 통과했다 --
 * 여기에는 그 폴더가 있기 때문이다.
 *
 * 더 나쁜 것은 드러나는 방식이었다. 모듈을 **읽는 단계**에서 죽으면 TAP 줄을
 * 하나도 못 내고 끝난다. 로그에서 `not ok` 를 찾으면 0건이다 -- 실패했는데
 * 실패한 테스트가 없는 것처럼 보인다.
 *
 * ── 무엇을 막는가 ──
 * 루트 테스트가 닿는 `functions/src/*.js` 가 모듈 최상위에서 루트에 없는
 * 패키지를 부르면 여기서 실패한다. 늦게 부르는 것(`await import(...)` 이나
 * 함수 안의 `require`)은 통과한다 -- 그때는 클라우드에서만 실행되고, 테스트는
 * 자기 것을 넣어 그 길을 비켜 간다.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 루트 package.json 이 가진 것 + Node 내장. 나머지는 CI 에 없다. */
async function rootPackages() {
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  return new Set([
    ...Object.keys(manifest.dependencies || {}),
    ...Object.keys(manifest.devDependencies || {}),
  ]);
}

/** `tests/` 아래 모든 테스트 파일. */
async function testFiles(dir = path.join(root, "tests")) {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await testFiles(full));
    else if (entry.name.endsWith(".test.js")) found.push(full);
  }
  return found;
}

/**
 * 이 파일이 **로드하는** `functions/src/*.js` 들.
 *
 * `require(...)` · `from "..."` · `import(...)` 만 센다. `readFile(new URL(...))`
 * 로 소스를 글자로 읽기만 하는 것은 대상이 아니다 -- 모듈을 돌리지 않으므로
 * 그 파일의 require 가 실행될 일이 없다. tests/voice/stt-quality-gate.test.js
 * 가 그렇게 읽는다.
 */
const functionsModulesIn = (source) => [
  ...source.matchAll(
    /(?:\brequire\(\s*|\bimport\(\s*|\bfrom\s+)["'][^"']*functions\/src\/([a-z0-9-]+\.js)["']/g,
  ),
].map((match) => match[1]);

/**
 * 모듈 **최상위**의 `require("...")` 만 고른다.
 *
 * 들여쓰기가 없는 `const ... = require(...)` 가 최상위다. 함수 안의 require 는
 * 줄 앞에 공백이 있고, 그것은 부르는 순간에만 도므로 막을 이유가 없다.
 */
const topLevelRequires = (source) => [
  ...source.matchAll(/^(?:const|let|var)\s[^\n]*?\brequire\(\s*["']([^"']+)["']/gm),
].map((match) => match[1]);

/** `@scope/name/sub` → `@scope/name`, `name/sub` → `name`. 내장은 node: 로 걸린다. */
const packageOf = (request) => {
  if (request.startsWith(".") || request.startsWith("node:")) return null;
  const parts = request.split("/");
  return request.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
};

test("no root test loads a functions module that requires a non-root package up front", async () => {
  const allowed = await rootPackages();
  const files = await testFiles();
  const offences = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const moduleName of functionsModulesIn(source)) {
      const target = path.join(root, "functions", "src", moduleName);
      let functionsSource = "";
      try {
        functionsSource = await readFile(target, "utf8");
      } catch {
        continue; // 경로가 바뀌었으면 다른 테스트가 잡는다.
      }
      for (const request of topLevelRequires(functionsSource)) {
        const pkg = packageOf(request);
        if (pkg && !allowed.has(pkg)) {
          offences.push(
            `${path.relative(root, file)} → functions/src/${moduleName} 가 모듈 최상위에서 "${request}" 를 부른다`,
          );
        }
      }
    }
  }

  assert.deepEqual(offences, [], [
    "",
    "루트에 없는 패키지다. CI 는 저장소 루트에서만 npm install 하므로",
    "functions/node_modules 가 없고, 이 테스트 파일은 **로드 단계에서** 죽는다.",
    "TAP 줄을 하나도 못 내고 죽어서 로그의 `not ok` 로는 잡히지 않는다.",
    "",
    "고치는 법: 그 require 를 쓰는 순간으로 미루고(함수 안으로),",
    "테스트가 자기 것을 넣을 자리를 둔다 -- functions/src/pass-admin.js 의",
    "sentinels() 가 그 예다.",
    "",
    ...offences,
  ].join("\n"));
});

test("the guard actually catches a top-level require", () => {
  /* 검사기가 아무것도 못 잡는 채로 통과하면 없는 것과 같다. 집어내는지 본다. */
  const bad = 'const { FieldValue } = require("firebase-admin/firestore");\n';
  assert.deepEqual(topLevelRequires(bad), ["firebase-admin/firestore"]);
  assert.equal(packageOf("firebase-admin/firestore"), "firebase-admin");

  // 함수 안으로 미룬 것은 통과한다 -- 그때는 클라우드에서만 돈다.
  const good = 'function f() {\n  const { FieldValue } = require("firebase-admin/firestore");\n}\n';
  assert.deepEqual(topLevelRequires(good), []);

  // 상대 경로와 내장 모듈은 대상이 아니다.
  assert.equal(packageOf("./service-session-fix"), null);
  assert.equal(packageOf("node:path"), null);
  assert.equal(packageOf("@scope/pkg/deep"), "@scope/pkg");
});

test("reading a functions file as text is not loading it", () => {
  /* 소스를 글자로 읽어 문구를 검사하는 테스트가 있다 (stt-quality-gate).
     그것까지 막으면 이 가드는 매번 거짓으로 울리고, 매번 우는 장치는 곧 꺼진다. */
  const reads = 'const provider = await readFile(new URL("../../functions/src/openai-provider.js", import.meta.url), "utf8");';
  assert.deepEqual(functionsModulesIn(reads), []);

  const loads = 'const { runSessionUp } = require("../../functions/src/pass-admin.js");';
  assert.deepEqual(functionsModulesIn(loads), ["pass-admin.js"]);

  const imports = 'import { thing } from "../../functions/src/pass-admin.js";';
  assert.deepEqual(functionsModulesIn(imports), ["pass-admin.js"]);

  const dynamic = 'await import("../../functions/src/pass-admin.js");';
  assert.deepEqual(functionsModulesIn(dynamic), ["pass-admin.js"]);
});
