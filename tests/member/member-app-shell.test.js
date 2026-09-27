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

/* ── 네이티브 폴더가 생긴 뒤에 지켜야 하는 것들 ──────────────────────── */

test("회원 앱의 Firebase 설정은 회원 앱 것이다", async () => {
  /* 이것이 실제로 틀릴 뻔했다. Firebase 콘솔에서 내려받으면 파일 이름이
     둘 다 `google-services.json` 이라, 다운로드 폴더에 강사 앱 것과 회원 앱
     것이 `google-services.json` 과 `google-services (4).json` 으로 섞여
     있었다. 이름만 보고 집으면 **회원 앱에 강사 앱 설정이 들어간다** --
     그러면 회원이 강사 앱의 Firebase 앱으로 로그인하고, 그 사실은 문자
     인증이 조용히 실패할 때까지 드러나지 않는다. */
  const services = await readJson("member-app/android/app/google-services.json");
  const packages = services.client.map((entry) => entry.client_info.android_client_info.package_name);
  assert.ok(packages.includes("com.bonitapilates.member"),
    `회원 앱 항목이 없습니다: ${packages.join(", ")}`);

  const plist = await read("member-app/ios/App/App/GoogleService-Info.plist");
  assert.match(plist, /<key>BUNDLE_ID<\/key>\s*<string>com\.bonitapilates\.member<\/string>/);

  /* 같은 프로젝트여야 한다. 회원 앱이 다른 프로젝트를 보면 센터 명부가 없다. */
  assert.equal(services.project_info.project_id, "pilateacher");
  assert.match(plist, /<key>PROJECT_ID<\/key>\s*<string>pilateacher<\/string>/);
});

test("강사 앱의 Firebase 설정은 그대로다", async () => {
  const services = await readJson("android/app/google-services.json");
  const packages = services.client.map((entry) => entry.client_info.android_client_info.package_name);
  assert.ok(packages.includes("com.pilateacher.app"));
});

test("네이티브가 선언한 번들 ID 가 설정과 같다", async () => {
  /* capacitor.config.json 을 고쳐도 이미 만들어진 네이티브 폴더는 안 따라
     간다. 둘이 갈라지면 빌드는 되고 스토어가 거절한다. */
  const member = await readJson("member-app/capacitor.config.json");
  const gradle = await read("member-app/android/app/build.gradle");
  assert.match(gradle, new RegExp(`applicationId "${member.appId.replaceAll(".", "\.")}"`));

  const pbxproj = await read("member-app/ios/App/App.xcodeproj/project.pbxproj");
  const bundles = pbxproj.match(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g) || [];
  assert.ok(bundles.length >= 2, "Debug 와 Release 둘이다");
  assert.equal(new Set(bundles).size, 1, `설정마다 번들이 다르다: ${bundles.join(" / ")}`);
  assert.match(bundles[0], /= com\.bonitapilates\.member;/);

  const strings = await read("member-app/android/app/src/main/res/values/strings.xml");
  assert.match(strings, new RegExp(`<string name="app_name">${member.appName}</string>`));
});

test("회원 앱에는 강사 앱 플러그인이 딸려 오지 않는다", async () => {
  /* Capacitor 는 **그 폴더의 package.json 의존성만** 읽어 네이티브에 넣는다
     (@capacitor/cli 의 plugin.js). 그래서 여기 적지 않은 것은 안 들어간다 --
     회원 앱이 카메라·마이크·음성인식 권한을 달라고 하면 스토어 심사에서
     "왜 필요하냐" 를 듣게 되고, 답할 말이 없다. */
  const member = await readJson("member-app/package.json");
  const declared = Object.keys({ ...member.dependencies, ...member.devDependencies });
  for (const unwanted of ["@capacitor/camera", "@capgo/capacitor-audio-recorder",
    "@capacitor-community/speech-recognition", "@capacitor/motion", "@capacitor/filesystem"]) {
    assert.ok(!declared.includes(unwanted), `회원 앱에 들어갈 것이 아닙니다: ${unwanted}`);
  }
  assert.ok(declared.includes("@capacitor-firebase/authentication"), "문자 인증은 있어야 한다");
});

test("회원 앱 의존성은 루트와 같은 것을 가리킨다", async () => {
  /* member-app 에는 node_modules 를 두지 않는다. 두면 같은 플러그인이 두
     벌이 되고, 루트의 postinstall 패치가 한쪽에만 걸린다 -- 강사 앱에서
     고친 버그가 회원 앱에 살아 있게 된다.
     대신 Node 해석이 루트로 올라가게 두는데, 그러려면 **버전 범위가 같아야**
     한다. 다르면 루트에 있는 것이 조용히 쓰이면서 package.json 은 다른 말을
     한다. */
  const rootPkg = await readJson("package.json");
  const memberPkg = await readJson("member-app/package.json");
  const rootAll = { ...rootPkg.dependencies, ...rootPkg.devDependencies };
  for (const [name, range] of Object.entries({ ...memberPkg.dependencies, ...memberPkg.devDependencies })) {
    assert.ok(rootAll[name], `루트에 없는 의존성입니다 — 해석이 실패합니다: ${name}`);
    assert.equal(range, rootAll[name], `${name} 의 범위가 갈라졌습니다`);
  }
});

test("빌드 산출물은 커밋하지 않는다", async () => {
  /* 웹 자산이 저장소에 들어가면 네이티브 폴더가 오래된 화면을 들고 다니고,
     어느 쪽이 진짜인지 커밋 로그로는 알 수 없다. */
  const android = await read("member-app/android/.gitignore");
  assert.match(android, /app\/src\/main\/assets\/public/);
  const ios = await read("member-app/ios/.gitignore");
  assert.match(ios, /App\/App\/public/);
});

test("iOS 가 전화 인증을 앱으로 되돌려받을 길이 있다", async () => {
  /* APNs 로 조용히 확인하지 못하면 Firebase 는 reCAPTCHA 를 브라우저로 띄우고
     **인코딩된 앱 ID 의 URL 스킴**으로 앱에 돌아온다. 그 스킴이 없으면
     브라우저가 열린 채 끝나고, 회원에게는 아무 일도 안 일어난 것으로 보인다.
     구글 로그인의 REVERSED_CLIENT_ID 와 다른 값이다 -- 그것을 적어 두면
     돌아오지 못한다. */
  const plist = await read("member-app/ios/App/App/Info.plist");
  const services = await readJson("member-app/android/app/google-services.json");
  const iosApp = (await read("member-app/ios/App/App/GoogleService-Info.plist"))
    .match(/<key>GOOGLE_APP_ID<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
  assert.ok(iosApp, "GOOGLE_APP_ID 를 읽지 못했습니다");
  assert.match(plist, new RegExp(`<string>app-${iosApp.replaceAll(":", "-")}</string>`));
  assert.equal(services.project_info.project_id, "pilateacher");
});

test("회원 앱도 한국어 앱이라고 선언한다", async () => {
  /* 강사 앱에서 실제로 났던 일이다 -- 이 값이 en 이면 WKWebView 안의 날짜
     입력기가 폰 언어와 무관하게 영어로 뜬다. */
  const plist = await read("member-app/ios/App/App/Info.plist");
  assert.match(plist, /<key>CFBundleDevelopmentRegion<\/key>\s*<string>ko<\/string>/);
  assert.match(plist, /<key>CFBundleLocalizations<\/key>\s*<array>\s*<string>ko<\/string>/);
});

test("회원 앱은 웹에서도 돌아야 한다 — 플러그인을 늦게 부른다", async () => {
  /* 같은 코드가 PWA 로도 나간다. 플러그인을 맨 위에서 import 하면 웹 번들에
     네이티브 껍데기가 딸려 들어가고, 브라우저에서 터질 자리가 하나 는다. */
  const firebase = await read("member/src/firebase.js");
  assert.match(firebase, /await import\("@capacitor-firebase\/authentication"\)/);
  assert.doesNotMatch(firebase, /^import .*@capacitor/m);
});
