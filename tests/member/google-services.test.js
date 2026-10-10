import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  FIREBASE_PROJECT, MEMBER_PACKAGE, googleServicesProblems,
} from "../../tools/member/google-services.mjs";

/**
 * 회원 앱 google-services.json 검사. 파일은 레포에 없다 -- 로컬에 손으로 두고
 * Codemagic 이 환경변수에서 풀어 쓴다. 그래서 여기서는 **판정**을 고정하고,
 * 파일 자체는 놓는 순간 tools/member/google-services.mjs 가 본다.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const KEY = `AIza${"x".repeat(35)}`;

const client = (pkg, appSuffix = "1") => ({
  client_info: {
    mobilesdk_app_id: `1:452402660812:android:${appSuffix}`,
    android_client_info: { package_name: pkg },
  },
  api_key: [{ current_key: KEY }],
});

const services = (clients, projectId = FIREBASE_PROJECT) => ({
  project_info: { project_id: projectId }, client: clients,
});

test("회원 앱 항목이 있으면 통과한다 — 강사 앱 항목이 같이 있어도", () => {
  /* Firebase 는 프로젝트 단위로 내보내서 두 앱이 한 파일에 든다. 정상이다. */
  assert.deepEqual(googleServicesProblems(services([
    client("com.pilateacher.app", "a"), client(MEMBER_PACKAGE, "b"),
  ])), []);
});

test("강사 앱 파일을 받았으면 막는다", () => {
  const problems = googleServicesProblems(services([client("com.pilateacher.app")]));
  assert.deepEqual(problems.map((item) => item.code), ["MEMBER_APP_MISSING"]);
  assert.match(problems[0].message, /com\.pilateacher\.app/);
});

test("다른 프로젝트 파일이면 막는다", () => {
  const codes = googleServicesProblems(services([client(MEMBER_PACKAGE)], "other-project"))
    .map((item) => item.code);
  assert.ok(codes.includes("WRONG_PROJECT"));
});

test("키나 앱 id 가 빠졌으면 막는다", () => {
  const broken = client(MEMBER_PACKAGE);
  broken.api_key = [];
  broken.client_info.mobilesdk_app_id = "";
  const codes = googleServicesProblems(services([broken])).map((item) => item.code);
  assert.deepEqual(codes.sort(), ["API_KEY_MISSING", "APP_ID_MISSING"]);
});

test("JSON 이 아니면 막는다", () => {
  for (const value of [null, "text", 3]) {
    assert.deepEqual(googleServicesProblems(value).map((item) => item.code), ["NOT_JSON"], String(value));
  }
});

test("문제 문구에 키 값이 실리지 않는다 — 빌드 로그에 그대로 찍힌다", () => {
  const broken = client("com.pilateacher.app");
  const text = JSON.stringify(googleServicesProblems(services([broken], "x")));
  assert.ok(!text.includes(KEY));
});

test("google-services.json 은 레포에 없다", () => {
  /* 키를 레포에 두지 않는다. 로컬 파일은 .gitignore 가 막는다. */
  const tracked = execFileSync("git", ["ls-files", "member-app/android/app/google-services.json"],
    { cwd: root, encoding: "utf8" }).trim();
  assert.equal(tracked, "");
  const ignored = execFileSync("git", ["check-ignore", "member-app/android/app/google-services.json"],
    { cwd: root, encoding: "utf8" }).trim();
  assert.equal(ignored, "member-app/android/app/google-services.json");
});

test("로컬에 파일이 있으면 그것도 회원 앱 것이어야 한다", { skip: !existsSync(
  path.join(root, "member-app/android/app/google-services.json"),
) && "로컬 파일이 없다 (CI 에서는 정상 — Codemagic 이 주입한다)" }, () => {
  execFileSync(process.execPath, [path.join(root, "tools/member/google-services.mjs")], {
    cwd: root, encoding: "utf8", stdio: "pipe",
  });
});
