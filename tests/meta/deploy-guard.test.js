import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  DEPLOYABLE_BRANCHES, IGNORED_DIRTY_PATHS, deployBlockers, porcelainPath,
} from "../../tools/deploy-guard.mjs";

const codesOf = (blockers) => blockers.map((item) => item.code);
const clean = { branch: "main", status: "" };

/* ── 배포해도 되는 상태 ───────────────────────────────────────────────── */

test("a clean tree on a deployable branch passes", () => {
  assert.deepEqual(deployBlockers(clean), []);
  assert.deepEqual(deployBlockers({ branch: "docs/app-review-account", status: "" }), []);
});

test("package-lock alone does not stop a deploy", () => {
  /* npm 이 설치할 때마다 만지고 화면에 닿지 않는다. 이것으로 막으면 배포가 거의
     매번 막히고, 매번 막히는 장치는 곧 꺼진다. */
  assert.deepEqual(deployBlockers({ ...clean, status: " M package-lock.json" }), []);
  assert.deepEqual(IGNORED_DIRTY_PATHS, ["package-lock.json"]);
});

/* ── 브랜치 ───────────────────────────────────────────────────────────── */

test("an experimental branch is refused, and told which ones are allowed", () => {
  /* 웹은 스토어 심사 같은 관문이 없다. 누르는 즉시 전부에게 가고, 되돌리려면
     다시 배포하는 수밖에 없다. */
  const blockers = deployBlockers({ branch: "feature/try-something", status: "" });
  assert.deepEqual(codesOf(blockers), ["BRANCH_NOT_ALLOWED"]);
  assert.match(blockers[0].message, /feature\/try-something/);
  assert.match(blockers[0].message, /main/);
  assert.match(blockers[0].message, /docs\/app-review-account/);
});

test("a detached HEAD is its own reason, not 'wrong branch'", () => {
  /* 고칠 방법이 다르다 -- 브랜치를 바꾸는 것이 아니라 브랜치로 나오는 것이다.
     그리고 나간 코드를 가리킬 이름이 없다. */
  for (const branch of ["HEAD", "", "   "]) {
    assert.deepEqual(codesOf(deployBlockers({ branch, status: "" })), ["DETACHED_HEAD"]);
  }
});

test("the allowed list is one place, so widening it is one edit", () => {
  assert.deepEqual(DEPLOYABLE_BRANCHES, ["main", "docs/app-review-account"]);
});

/* ── 커밋되지 않은 변경 ───────────────────────────────────────────────── */

test("an uncommitted change stops the deploy and names the files", () => {
  /* 커밋되지 않은 채 나가면 그 화면은 저장소 어디에도 없는 상태가 된다.
     "이 버그가 언제 들어왔나" 에 짚을 커밋이 없고, 되돌릴 대상도 없다. */
  const blockers = deployBlockers({ ...clean, status: " M src/App.jsx\n M package-lock.json" });
  assert.deepEqual(codesOf(blockers), ["WORKING_TREE_DIRTY"]);
  assert.match(blockers[0].message, /1건/);
  assert.match(blockers[0].message, /src\/App\.jsx/);
  assert.doesNotMatch(blockers[0].message, /package-lock/);
});

test("an untracked file counts — it is the one that never reaches git", () => {
  /* 추적되지 않는 파일이 src/ 아래 있으면 번들에는 들어가고 저장소에는 없다.
     그 조합이 가장 나쁘다. */
  assert.deepEqual(codesOf(deployBlockers({ ...clean, status: "?? src/features/new-thing.js" })), ["WORKING_TREE_DIRTY"]);
});

test("staged but uncommitted is still uncommitted", () => {
  assert.deepEqual(codesOf(deployBlockers({ ...clean, status: "M  src/App.jsx" })), ["WORKING_TREE_DIRTY"]);
  assert.deepEqual(codesOf(deployBlockers({ ...clean, status: "A  src/new.js" })), ["WORKING_TREE_DIRTY"]);
  assert.deepEqual(codesOf(deployBlockers({ ...clean, status: "D  src/gone.js" })), ["WORKING_TREE_DIRTY"]);
});

test("a long list is trimmed rather than filling the terminal", () => {
  const status = Array.from({ length: 14 }, (_item, index) => ` M src/file-${index}.js`).join("\n");
  const [blocker] = deployBlockers({ ...clean, status });
  assert.match(blocker.message, /14건/);
  assert.match(blocker.message, /외 4건/);
});

/* ── porcelain 한 줄 읽기 ────────────────────────────────────────────── */

test("the path is read out of every porcelain shape", () => {
  assert.equal(porcelainPath(" M src/App.jsx"), "src/App.jsx");
  assert.equal(porcelainPath("?? src/new.js"), "src/new.js");
  assert.equal(porcelainPath("MM src/App.jsx"), "src/App.jsx");
  // 이름이 바뀐 파일은 새 이름을 본다 -- 지금 거기 있는 것이 그것이다.
  assert.equal(porcelainPath("R  old.js -> new.js"), "new.js");
  // 공백이나 한글이 든 이름은 따옴표로 감싸여 온다.
  assert.equal(porcelainPath('?? "src/이름 있는 파일.js"'), "src/이름 있는 파일.js");
  assert.equal(porcelainPath(""), "");
  assert.equal(porcelainPath("??"), "");
});

test("package-lock is matched by path, not by the line it sits in", () => {
  // 앞의 두 글자는 상태에 따라 바뀐다. 문자열 포함으로 보면 다른 파일이 새어 나간다.
  assert.deepEqual(deployBlockers({ ...clean, status: "M  package-lock.json" }), []);
  assert.deepEqual(codesOf(deployBlockers({ ...clean, status: " M docs/package-lock.json" })), ["WORKING_TREE_DIRTY"]);
});

/* ── 둘 다 틀렸을 때 ─────────────────────────────────────────────────── */

test("both problems are reported at once", () => {
  /* 하나씩 알려 주면 브랜치를 옮긴 뒤에 또 막힌다. 고칠 것을 한 번에 본다. */
  const blockers = deployBlockers({ branch: "wip", status: " M src/App.jsx" });
  assert.deepEqual(codesOf(blockers), ["BRANCH_NOT_ALLOWED", "WORKING_TREE_DIRTY"]);
});

/* ── 배포 스크립트가 실제로 이 판정을 부르는가 ────────────────────────── */

test("the deploy script asks before it builds anything", async () => {
  /* 판정이 아무리 맞아도 불리지 않으면 아무것도 막지 못한다. 그리고 빌드보다
     먼저여야 한다 -- 몇 분 기다린 끝에 듣는 것과 시작하자마자 듣는 것은 다르다. */
  const source = await readFile(new URL("../../tools/deploy-web.mjs", import.meta.url), "utf8");
  const guard = source.indexOf("deployBlockers({ branch, status })");
  const build = source.indexOf('run("npm", ["run", "build"])');
  assert.ok(guard > 0, "배포 스크립트가 판정을 부르지 않는다");
  assert.ok(build > guard, "빌드가 판정보다 먼저 일어난다");
  assert.match(source, /process\.exit\(1\)/, "막아야 할 때 멈추지 않는다");
});

/* ── 입력이 한 칸 밀려 들어와도 ───────────────────────────────────────────

   ` M path` 의 첫 칸은 공백이다. 출력 전체에 trim 을 먹이면 첫 줄만 한 칸
   밀리고, 자리수로 자르던 파서는 경로 첫 글자를 먹는다. 그러면
   package-lock.json 이 `ackage-lock.json` 이 되어 제외 목록에 걸리지 않는다.

   실제로 그렇게 새어 나갔다 -- 배포 스크립트의 capture 가 stdout 을 trim 하고
   있었다. 부르는 쪽을 고쳤지만, 판정이 입력 모양 하나에 기대고 있으면 같은
   일이 다시 일어난다. */

test("a status line that lost its leading space is still read correctly", () => {
  assert.equal(porcelainPath("M package-lock.json"), "package-lock.json");
  assert.equal(porcelainPath("M src/App.jsx"), "src/App.jsx");
  // 그래서 trim 된 출력이 들어와도 package-lock 은 여전히 걸러진다.
  assert.deepEqual(deployBlockers({ ...clean, status: "M package-lock.json" }), []);
});

test("a path that merely starts with a status letter is not eaten", () => {
  // "M" 으로 시작하는 파일 이름이 있다. 상태 글자와 경로를 공백으로 가른다.
  assert.equal(porcelainPath(" M Makefile"), "Makefile");
  assert.equal(porcelainPath("?? MEMORY.md"), "MEMORY.md");
});

test("the deploy script does not trim the porcelain output", async () => {
  /* 원인 쪽을 고정한다. 여기에 trim 이 다시 들어오면 첫 줄이 또 밀린다. */
  const source = await readFile(new URL("../../tools/deploy-web.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /capture\("git", \["status", "--porcelain"\]\)/,
    "trim 하는 capture 로 porcelain 을 읽고 있다");
  assert.match(source, /\["status", "--porcelain"\][\s\S]{0,160}stdout/,
    "porcelain 을 stdout 그대로 읽지 않는다");
});
