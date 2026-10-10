import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * 회원 앱 자동 배포(.github/workflows/deploy-member.yml)의 paths 가 실제
 * import 그래프를 덮는지 확인한다.
 *
 * 회원 앱은 member/ 밖의 공용 파일을 몇 개 가져온다. 그 파일이 바뀌면 번들도
 * 바뀌는데, paths 에 없으면 워크플로가 돌지 않고 라이브는 **조용히 옛 번들**에
 * 머문다. 회원 앱이 새 공용 파일을 import 하면서 paths 에 적는 것을 잊으면
 * 여기서 깨진다.
 */

const root = fileURLToPath(new URL("../../", import.meta.url));
const WORKFLOW = path.join(root, ".github/workflows/deploy-member.yml");
const relative = (file) => path.relative(root, file).split(path.sep).join("/");

/** member/src 에서 닿는 member/ 밖의 소스 파일 전부. */
function importsOutsideMember() {
  const seen = new Set();
  const outside = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const target = path.resolve(path.dirname(file), match[1]);
      if (!existsSync(target) || !/\.(js|jsx|css)$/.test(target)) continue;
      if (!relative(target).startsWith("member/")) outside.add(relative(target));
      if (/\.jsx?$/.test(target)) walk(target);
    }
  };
  const memberSrc = path.join(root, "member/src");
  for (const name of readdirSync(memberSrc)) walk(path.join(memberSrc, name));
  return [...outside].sort();
}

/** on.<event>.paths 목록. YAML 파서를 들이지 않으려고 이 파일의 모양만 읽는다. */
function pathsOf(event) {
  const lines = readFileSync(WORKFLOW, "utf8").split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${event}:`);
  assert.ok(start >= 0, `on.${event} 이 없습니다`);
  const found = [];
  let inPaths = false;
  for (const line of lines.slice(start + 1)) {
    if (/^ {2}\S/.test(line) || /^\S/.test(line)) break;
    if (line === "    paths:") { inPaths = true; continue; }
    if (inPaths) {
      const item = line.match(/^ {6}- "(.+)"$/);
      if (item) found.push(item[1]);
      else if (line.trim() && !line.trim().startsWith("#")) inPaths = false;
    }
  }
  return found;
}

const covers = (patterns, file) => patterns.some((pattern) => (
  pattern.endsWith("/**") ? file.startsWith(pattern.slice(0, -2)) : pattern === file
));

test("회원 앱이 가져오는 member/ 밖 파일이 전부 paths 에 있다", () => {
  const outside = importsOutsideMember();
  assert.ok(outside.length > 0, "공용 import 를 하나도 못 찾았다 -- 탐색이 고장 났다");
  for (const event of ["push", "pull_request"]) {
    const missing = outside.filter((file) => !covers(pathsOf(event), file));
    assert.deepEqual(missing, [], `on.${event}.paths 에 빠진 파일`);
  }
});

test("push 와 pull_request 의 paths 가 같다", () => {
  assert.deepEqual(pathsOf("pull_request"), pathsOf("push"));
});

test("paths 에 적힌 파일은 실제로 있다", () => {
  // 파일을 옮기고 목록을 안 고치면 그 줄은 아무것도 지키지 않는다.
  for (const pattern of pathsOf("push")) {
    const target = pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern;
    assert.ok(existsSync(path.join(root, target)), pattern);
  }
});

test("강사 앱 사이트를 지정하지 않는다", () => {
  const text = readFileSync(WORKFLOW, "utf8");
  assert.match(text, /target: pilateacher-member\r?\n/);
  assert.match(text, /entry\.site === "pilateacher-member"/);
  assert.doesNotMatch(text, /hosting:pilateacher\b(?!-member)/);
});
