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

test("서명 없이 release 가 나가지 않는다", async () => {
  /* 서명 안 된 번들은 Play 가 거절하는데, 그 사실은 업로드까지 가서야
     드러난다. 강사 앱과 같은 자리에서 멈춘다. */
  const gradle = await read("member-app/android/app/build.gradle");
  assert.match(gradle, /signingConfig signingConfigs\.release/);
  assert.match(gradle, /gradle\.taskGraph\.whenReady/);
  assert.match(gradle, /must contain all release signing values/);
});

test("서명 비밀번호는 저장소에 없다", async () => {
  /* 두 앱이 같은 업로드 키를 쓴다. 한쪽이 새면 둘 다 새는 것이다. */
  const ignore = await read(".gitignore");
  assert.match(ignore, /^android\/keystore\.properties$/m);
  assert.match(ignore, /^member-app\/android\/keystore\.properties$/m);
});

test("회원 앱은 자기 폴더의 키 설정을 읽는다", async () => {
  /* rootProject.file 이 member-app/android 를 가리킨다. 강사 앱 폴더를
     올려다보게 적으면 두 앱의 빌드가 한 파일에 묶인다. */
  const gradle = await read("member-app/android/app/build.gradle");
  assert.match(gradle, /rootProject\.file\('keystore\.properties'\)/);
  assert.doesNotMatch(gradle, /\.\.\/\.\.\/android/);
});

test("회원 앱 번들에 Firebase 설정이 실제로 들어간다", async () => {
  /* **디스크에 있는 것과 번들에 들어가는 것은 다르다.** cap add 로 만든
     프로젝트는 GoogleService-Info.plist 를 모른다 -- 파일을 폴더에 넣어 둬도
     Xcode 가 복사하지 않고, 앱은 Firebase 없이 뜬다. 그러면 문자 인증이
     "안 된다" 가 아니라 **아무 일도 안 일어난다**. */
  const pbxproj = await read("member-app/ios/App/App.xcodeproj/project.pbxproj");
  assert.match(pbxproj, /GoogleService-Info\.plist in Resources/);
  assert.match(pbxproj, /isa = PBXFileReference[^;]*;[^\n]*GoogleService-Info/);
});

test("푸시 권한이 있어야 iOS 전화 인증이 무음 푸시로 끝난다", async () => {
  /* 없으면 실패하지 않고 reCAPTCHA 로 되돌아간다 -- 고장이 아니라 문턱으로
     보여서, 빠진 줄 모른 채 쓰게 된다. */
  const entitlements = await read("member-app/ios/App/App/App.entitlements");
  assert.match(entitlements, /<key>aps-environment<\/key>/);

  const pbxproj = await read("member-app/ios/App/App.xcodeproj/project.pbxproj");
  const links = pbxproj.match(/CODE_SIGN_ENTITLEMENTS = ([^;]+);/g) || [];
  assert.equal(links.length, 2, "Debug 와 Release 둘 다 걸려야 한다");
  assert.equal(new Set(links).size, 1, `설정마다 다른 파일을 가리킨다: ${links.join(" / ")}`);
  assert.match(links[0], /App\/App\.entitlements/);
});

test("회원 앱은 애플 로그인을 켜지 않는다", async () => {
  /* 강사 앱 entitlements 를 베껴 오면 따라온다. 회원은 번호 하나로
     들어오고, 켜 두면 심사에서 "이 기능이 어디 있냐" 를 듣는다. */
  const entitlements = await read("member-app/ios/App/App/App.entitlements");
  assert.doesNotMatch(entitlements, /applesignin/);
});

/* ── Codemagic — 두 앱이 한 파일에서 갈라진다 ────────────────────────── */

const workflows = async () => {
  const { load } = await import("js-yaml");
  return load(await read("codemagic.yaml")).workflows;
};

test("워크플로 둘이 서로 다른 번들을 만든다", async () => {
  const all = await workflows();
  const instructor = all["ios-testflight"].environment.ios_signing.bundle_identifier;
  const member = all["member-ios-testflight"].environment.vars.BUNDLE_ID;
  assert.equal(instructor, "com.pilateacher.app");
  assert.equal(member, "com.bonitapilates.member");
  assert.notEqual(instructor, member);
});

test("회원 앱은 서명을 스스로 받아 온다", async () => {
  /* environment.ios_signing 은 Codemagic 이 스크립트보다 **먼저** 도는 자동
     서명을 켠다. 그런데 그것은 이미 있는 프로필을 가져올 뿐 만들지 않는다 --
     회원 앱은 프로필이 없어서 첫 빌드가 스크립트 시작 전에 죽었다:

       No matching profiles found for bundle identifier
       com.bonitapilates.member and distribution type app_store

     그래서 이 워크플로는 그 블록을 두지 않고 직접 받아 온다. 다시 넣으면
     같은 자리에서 또 죽는다. */
  const all = await workflows();
  assert.equal(all["member-ios-testflight"].environment.ios_signing, undefined,
    "회원 앱은 자동 서명을 쓰지 않는다");
  /* 강사 앱은 그대로 둔다. 그쪽은 프로필이 있어서 자동 서명으로 돌아간다. */
  assert.ok(all["ios-testflight"].environment.ios_signing);

  const body = all["member-ios-testflight"].scripts.map((s2) => String(s2.script)).join("\n");
  assert.match(body, /app-store-connect fetch-signing-files "\$BUNDLE_ID"/);
  assert.match(body, /--type IOS_APP_STORE/);
  assert.match(body, /--create/);
  assert.match(body, /keychain initialize/);
  assert.match(body, /keychain add-certificates/);
  assert.match(body, /xcode-project use-profiles/);
});

test("배포 인증서를 새로 만들지 않는다", async () => {
  /* 배포 인증서는 계정당 개수 제한이 있다. 한 칸을 태우면 되돌리려면 다른
     것을 폐기해야 하고, 그 다른 것으로 이미 나간 앱이 있을 수 있다. */
  const all = await workflows();
  const body = all["member-ios-testflight"].scripts.map((s2) => String(s2.script)).join("\n");
  /* 기존 인증서를 다시 쓰려면 그 개인키가 있어야 한다. 없으면 멈춘다 --
     조용히 새로 만드는 것보다 낫다. */
  assert.match(body, /--certificate-key @env:CERTIFICATE_PRIVATE_KEY/);
  assert.match(body, /if \[ -z "\$\{CERTIFICATE_PRIVATE_KEY:-\}" \]/);
  /* 그래도 늘었는지 세어 본다. */
  assert.match(body, /certificates list --type IOS_DISTRIBUTION/);
  assert.match(body, /\[ "\$AFTER" -gt "\$BEFORE" \]/);
});

test("회원 앱도 수출 규정을 미리 답해 둔다", async () => {
  /* 없으면 업로드마다 App Store Connect 가 묻고, 답하기 전에는 TestFlight
     테스터에게 가지 않는다 -- 빌드는 초록인데 아무도 못 받는다. */
  const plist = await read("member-app/ios/App/App/Info.plist");
  assert.match(plist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
});

test("한쪽 변경이 다른 쪽 빌드를 돌리지 않는다", async () => {
  /* 회원 앱 한 줄을 고쳤다고 강사 앱 iOS 빌드가 돌면, 버전이 안 올랐을 때
     Publishing 에서 90062 로 빨갛게 끝난다 -- 고친 것과 상관없는 실패다. */
  const all = await workflows();
  const instructor = all["ios-testflight"].when.changeset;
  assert.deepEqual(instructor.includes, ["."], "강사 앱은 기본이 '전부' 다");
  assert.ok(instructor.excludes.includes("member/"));
  assert.ok(instructor.excludes.includes("member-app/"));

  const member = all["member-ios-testflight"].when.changeset;
  assert.ok(!member.includes.includes("."), "회원 앱은 관계있는 것만 본다");
  for (const needed of ["member/", "member-app/", "codemagic.yaml"]) {
    assert.ok(member.includes.includes(needed), needed);
  }
  /* 회원 화면이 강사 앱 코드에서 읽는 것은 지금 이 하나뿐이다. 늘어나면
     여기도 늘려야 하고, 안 늘리면 회원 앱이 낡은 채로 나간다. */
  assert.ok(member.includes.includes("src/features/ui/"));
});

test("회원 앱 빌드가 강사 앱 폴더를 열지 않는다", async () => {
  const all = await workflows();
  const scripts = all["member-ios-testflight"].scripts.map((step) => String(step.script));
  const body = scripts.join("\n");
  /* 경로가 전부 member-app 밑이다. `ios/App/App.xcodeproj` 를 그냥 적으면
     강사 앱을 빌드하면서 회원 앱 번들 ID 로 서명하게 된다. */
  assert.match(body, /member-app\/ios\/App\/App\.xcodeproj/);
  assert.doesNotMatch(body, /(?<!member-app\/)ios\/App\/App\.xcodeproj/);
  /* cap 은 member:sync 로만 부른다 -- 루트에서 부르면 강사 앱을 덮어쓴다. */
  assert.match(body, /npm run member:sync/);
  assert.doesNotMatch(body, /npx cap sync ios/);
  /* 빌드가 끝나기 전에 강사 앱이 더럽혀졌는지 본다. */
  assert.match(body, /git status --porcelain ios\/ android\//);
});

test("두 워크플로 다 그룹 이름을 박지 않는다", async () => {
  /* 'Internal' 이 App Store Connect 에 없는 이름이었고, 매 빌드가 조용히
     실패했다. 실제 그룹 이름은 '테스트' 다 -- '내부' 는 화면의 섹션
     제목이지 그룹 이름이 아니다. 저쪽 이름을 여기 박으면 또 어긋난다. */
  const yamlText = await read("codemagic.yaml");
  assert.doesNotMatch(yamlText, /beta_groups:/);
  const all = await workflows();
  for (const [key, wf] of Object.entries(all)) {
    const publish = wf.publishing.app_store_connect;
    assert.equal(publish.submit_to_testflight, false, key);
    assert.equal(publish.submit_to_app_store, false, key);
  }
});

test("회원 앱 워크플로가 번들 안까지 확인한다", async () => {
  /* 빌드가 통과하고 업로드에서 거절당하면 그 문구는 왜 그런지 말해 주지
     않는다. 나가기 전에 IPA 를 열어 본다. */
  const all = await workflows();
  const body = all["member-ios-testflight"].scripts.map((s) => String(s.script)).join("\n");
  assert.match(body, /CFBundleIdentifier raw[\s\S]*com\.bonitapilates\.member/);
  assert.match(body, /test -f "\$APP\/GoogleService-Info\.plist"/);
  assert.match(body, /codesign -d --entitlements/);
  assert.match(body, /tools\/member\/validate_signing\.py/);
});

test("서명 검사는 강사 앱 프로필이 섞인 것을 잡는다", async () => {
  const script = await read("tools/member/validate_signing.py");
  assert.match(script, /EXPECTED_BUNDLE_ID = "com\.bonitapilates\.member"/);
  assert.match(script, /INSTRUCTOR_BUNDLE_ID = "com\.pilateacher\.app"/);
  assert.match(script, /leaked into this build/);
});

test("iOS 와 Android 가 같은 버전을 말한다", async () => {
  const pbxproj = await read("member-app/ios/App/App.xcodeproj/project.pbxproj");
  const versions = pbxproj.match(/MARKETING_VERSION = ([^;]+);/g) || [];
  assert.equal(versions.length, 2, "Debug 와 Release 둘이다");
  assert.equal(new Set(versions).size, 1, `설정마다 다르다: ${versions.join(" / ")}`);
  assert.match(versions[0], /MARKETING_VERSION = \d+\.\d+\.\d+;/);

  const gradle = await read("member-app/android/app/build.gradle");
  const android = gradle.match(/versionName "([^"]+)"/)[1];
  assert.equal(versions[0], `MARKETING_VERSION = ${android};`);
});

/* ── 아이폰에서 멈췄던 것 ────────────────────────────────────────────── */

test("앱에서는 getAuth 를 쓰지 않는다", async () => {
  /* **TestFlight 빌드가 여기서 멈췄다.** getAuth() 는
     browserPopupRedirectResolver 를 다는데, iOS 웹뷰에서 그 리졸버는 Auth
     초기화 약속 안에서 미리 켜지면서 교차 출처 iframe 을 30~60초
     시간제한으로 불러온다. 그동안 onAuthStateChanged 가 한 번도 불리지
     않고 화면은 "잠시만요…" 에 머문다.

     강사 앱이 같은 자리에서 같은 증상을 겪고 남긴 판단을 따른다
     (src/lib/firebase.js): 저장소는 측정된 것이 localStorage 였다. */
  const firebase = await read("member/src/firebase.js");
  assert.match(firebase, /initializeAuth\(app, \{ persistence: browserLocalPersistence \}\)/);
  /* 주석에서는 그 이름을 설명한다 -- 왜 피하는지가 이 결정의 전부다.
     그래서 주석을 걷어낸 **코드 줄만** 본다. */
  const code = firebase.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /browserPopupRedirectResolver/);
  /* 웹은 그대로 둔다. 브라우저에는 이 문제가 없고, 지금 도는 것을 확인 없이
     건드리지 않는다. */
  assert.match(firebase, /isNativeRuntime\(\)\s*\?\s*initializeAuth[\s\S]{0,120}:\s*getAuth\(app\)/);
});

test("기다리는 화면이 영영 기다리지 않는다", async () => {
  /* 무한 스피너는 "곧 된다" 고 말한다. 영영 안 될 수도 있다는 것을 아무도
     말해 주지 않으면 회원은 앱이 고장 난 줄도 모른 채 들고 있는다. */
  const app = await read("member/src/App.jsx");
  assert.match(app, /const SLOW_AFTER_MS = 10000;/);
  /* 로그인 상태를 기다리는 쪽과 문서를 읽는 쪽, 둘 다 걸어야 한다. */
  assert.match(app, /setAuthSlow\(true\)/);
  assert.match(app, /if \(state\.stage !== "loading"\) return undefined;/);
  assert.match(app, /<SlowConnection/);
});

test("진단은 멈춰 있을 때도 열린다", async () => {
  /* Shell 에 있어야 한다. 안쪽 화면에 두면 멈춘 동안에는 그리지 않는데,
     바로 그때가 필요한 순간이다. */
  const app = await read("member/src/App.jsx");
  const shell = app.slice(app.indexOf("function Shell("), app.indexOf("/* ── 번호 인증"));
  assert.match(shell, /readDiagnostics\(\)/);
  assert.match(shell, /<Diagnostics/);
  assert.match(shell, /DIAGNOSTIC_TAPS/);
  assert.match(app, /const DIAGNOSTIC_TAPS = 5;/);
});

test("번들이 자기 커밋을 들고 다닌다", async () => {
  /* 폰에서 막혔을 때 가장 먼저 묻게 되는 것이 "그 폰에 든 것이 어느
     코드냐" 인데, 그것을 물을 방법이 없었다. */
  const config = await read("member/vite.config.js");
  assert.match(config, /__MEMBER_BUILD__/);
  assert.match(config, /rev-parse", "--short", "HEAD"/);
  /* 못 읽으면 빈 값이다. 지어내면 진단이 거짓말을 한다. */
  assert.match(config, /catch \(_error\)/);
});

test("상태 표시줄과 겹치지 않는다", async () => {
  /* viewport-fit=cover 라 웹뷰가 화면 끝까지 차지한다. 위쪽 여백이 없으면
     제목이 시계와 겹친다 -- 아이폰에서 실제로 그랬다. */
  const html = await read("member/index.html");
  assert.match(html, /viewport-fit=cover/);
  const css = await read("member/src/styles.css");
  assert.match(css, /\.head \{[\s\S]*?env\(safe-area-inset-top, 0px\)/);
  /* 아래도 본다. 탭이 안전 영역 위로 떠 있어서 본문도 그만큼 비워야
     마지막 카드가 안 가린다. */
  assert.match(css, /\.main \{[^}]*env\(safe-area-inset-bottom, 0px\)/);
  assert.match(css, /\.tabs \{[\s\S]*?env\(safe-area-inset-bottom, 0px\)/);
});
