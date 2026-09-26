/**
 * 회원 앱 껍데기 — **강사 앱과 섞이지 않는다.**
 *
 * 두 앱이 한 저장소에 있고 Capacitor 는 폴더마다 설정이 따로다. 명령이 섞이면
 * 회원 앱 빌드가 강사 앱의 android/ 를 덮어쓰는데, 그 사실은 빌드가 끝난
 * 뒤에야 드러나고 되돌릴 방법이 마땅치 않다.
 *
 * 여기서 고정하는 것은 기능이 아니라 **그 경계**다.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");
const readJson = async (relative) => JSON.parse(await read(relative));

test("두 앱의 번들 ID 가 다르다", async () => {
  const instructor = await readJson("capacitor.config.json");
  const member = await readJson("member-app/capacitor.config.json");
  assert.equal(instructor.appId, "com.pilateacher.app");
  assert.equal(member.appId, "com.bonitapilates.member");
  assert.notEqual(instructor.appId, member.appId);
});

test("회원 앱 이름은 보니따필라테스다", async () => {
  const member = await readJson("member-app/capacitor.config.json");
  assert.equal(member.appName, "보니따필라테스");
});

test("두 앱의 웹 출력 폴더가 다르다", async () => {
  /* 같으면 한쪽 빌드가 다른 쪽 번들을 덮어쓴다. 회원이 강사 앱 화면을
     받거나 그 반대가 된다 -- 둘 다 스토어에 올라간 뒤에야 드러난다. */
  const instructor = await readJson("capacitor.config.json");
  const member = await readJson("member-app/capacitor.config.json");
  assert.equal(instructor.webDir, "dist");
  assert.equal(member.webDir, "../dist-member");

  const viteConfig = await read("member/vite.config.js");
  assert.match(viteConfig, /outDir:\s*"\.\.\/dist-member"/);
});

test("회원 앱은 문자 인증만 켠다", async () => {
  /* 구글·애플 로그인은 강사 앱의 것이다. 회원은 전화번호 하나로 들어온다 --
     센터 명부가 번호로 사람을 찾기 때문이다. */
  const member = await readJson("member-app/capacitor.config.json");
  const auth = member.plugins?.FirebaseAuthentication;
  assert.deepEqual(auth.providers, ["phone"]);
  /* 네이티브가 직접 로그인하지 않는다. 자격만 받아 와 JS SDK 로 들어간다 --
     그래야 Firestore 규칙이 보는 토큰과 화면이 보는 사용자가 같아진다. */
  assert.equal(auth.skipNativeAuth, true);
});

test("네이티브 폴더 경로가 member-app 안이다", async () => {
  /* 기본값은 설정 파일 옆이지만, 적어 두지 않으면 다음 사람이 루트의
     android/ 를 쓰는 것으로 읽는다. */
  const member = await readJson("member-app/capacitor.config.json");
  assert.equal(member.android.path, "android");
  assert.equal(member.ios.path, "ios");
});

test("빌드 명령이 이름으로 갈린다", async () => {
  const pkg = await readJson("package.json");
  assert.equal(pkg.scripts["member:sync"], "node tools/member/sync.mjs");
  assert.equal(pkg.scripts["member:aab"], "node tools/member/build-aab.mjs");
  // 강사 앱 명령은 그대로다.
  assert.equal(pkg.scripts["android:aab"], "node tools/android/build-aab.mjs");
});

test("회원 앱 빌드는 강사 앱 폴더를 보지 않는다", async () => {
  /* cap sync 는 현재 폴더의 설정을 본다. 루트에서 부르면 강사 앱을 건드린다. */
  const sync = await read("tools/member/sync.mjs");
  assert.match(sync, /cwd: memberApp/);
  assert.doesNotMatch(sync, /"android"\s*\)\s*,\s*"app"/, "루트 android/ 를 열지 않는다");

  const build = await read("tools/member/build-aab.mjs");
  assert.match(build, /path\.join\(memberApp, "android"\)/);
});

test("회원 앱이 아니면 빌드를 멈춘다", async () => {
  /* 이름이 비슷한 두 명령이 있으면 언젠가 틀리게 부른다. 그때 나오는 것은
     잘못된 번들이 아니라 **맞는 것처럼 보이는** 번들이다. */
  const build = await read("tools/member/build-aab.mjs");
  assert.match(build, /WRONG_APPLICATION_ID/);
  assert.match(build, /applicationId !== "com\.bonitapilates\.member"/);

  const sync = await read("tools/member/sync.mjs");
  assert.match(sync, /WRONG_APP_ID/);
});

test("심사용 번호는 코드에 없다", async () => {
  /* 대표가 콘솔에서 등록한다. 여기 적으면 저장소를 읽는 누구나 그 번호로
     들어온다. */
  for (const file of ["member-app/capacitor.config.json", "member-app/README.md",
    "tools/member/sync.mjs", "tools/member/build-aab.mjs"]) {
    const body = await read(file);
    assert.doesNotMatch(body, /01\d[-\s]?\d{3,4}[-\s]?\d{4}/, file);
    assert.doesNotMatch(body, /\+82\s?1\d/, file);
  }
});
