/**
 * 회원 앱 `google-services.json` 이 **회원 앱 것인지** 본다.
 *
 * ── 왜 레포 밖에 있는가 ──
 * 이 파일은 레포에 넣지 않는다. 로컬에서는 `member-app/android/app/` 에 손으로
 * 두고(.gitignore), Codemagic 에서는 환경변수 `MEMBER_GOOGLE_SERVICES_JSON`
 * (base64) 을 풀어 같은 자리에 쓴다. 그래서 "파일이 맞는가" 를 테스트가 볼 수
 * 없고 -- CI 에는 파일이 없다 -- **파일을 놓는 순간** 이것이 본다.
 *
 * ── 무엇이 틀릴 수 있나 ──
 * 콘솔에서 받으면 강사 앱 것과 회원 앱 것이 둘 다 `google-services.json` 이라
 * 다운로드 폴더에서 섞인다. 강사 앱 것을 넣으면 빌드는 되고, 문자 인증이
 * 조용히 실패할 때까지 아무도 모른다. 그리고 **Gradle 은 파일이 없으면
 * 경고만 남기고 Firebase 없이 빌드한다** (member-app/android/app/build.gradle)
 * -- 그 앱은 깔리고 열리고, 인증만 안 된다.
 *
 *   node tools/member/google-services.mjs [파일]   # 기본: member-app/android/app/google-services.json
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MEMBER_PACKAGE = "com.bonitapilates.member";
export const FIREBASE_PROJECT = "pilateacher";

/**
 * 문제 목록을 돌려준다. 비어 있으면 통과다. **순수 함수다.**
 *
 * 키 값은 어떤 문구에도 담지 않는다 -- 이 결과는 빌드 로그에 그대로 찍힌다.
 *
 * @param {unknown} json 파싱한 google-services.json
 * @returns {{ code: string, message: string }[]}
 */
export function googleServicesProblems(json) {
  const problems = [];
  const add = (code, message) => problems.push({ code, message });
  if (!json || typeof json !== "object") {
    add("NOT_JSON", "google-services.json 을 읽지 못했습니다.");
    return problems;
  }
  const projectId = String(json.project_info?.project_id ?? "");
  if (projectId !== FIREBASE_PROJECT) {
    add("WRONG_PROJECT", `project_id 가 "${projectId}" 입니다. "${FIREBASE_PROJECT}" 이어야 합니다.`);
  }
  const clients = Array.isArray(json.client) ? json.client : [];
  const packages = clients.map((entry) => String(entry?.client_info?.android_client_info?.package_name ?? ""));
  const member = clients[packages.indexOf(MEMBER_PACKAGE)];
  if (!member) {
    add("MEMBER_APP_MISSING",
      `${MEMBER_PACKAGE} 항목이 없습니다 (있는 것: ${packages.join(", ") || "없음"}). 강사 앱 파일을 받은 것일 수 있습니다.`);
    return problems;
  }
  if (!String(member.client_info?.mobilesdk_app_id ?? "").includes(":android:")) {
    add("APP_ID_MISSING", `${MEMBER_PACKAGE} 의 mobilesdk_app_id 가 비어 있습니다.`);
  }
  const keys = Array.isArray(member.api_key) ? member.api_key : [];
  if (!keys.some((key) => /^AIza[0-9A-Za-z_-]{20,}$/.test(String(key?.current_key ?? "")))) {
    add("API_KEY_MISSING", `${MEMBER_PACKAGE} 에 api_key 가 없습니다.`);
  }
  return problems;
}

/* ── 명령줄 ─────────────────────────────────────────────────────────── */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const file = path.resolve(process.argv[2] || path.join(root, "member-app/android/app/google-services.json"));
  let json = null;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`\n[GOOGLE_SERVICES_UNREADABLE] ${file}`);
    console.error(`  ${error.code || error.name}: 파일이 없거나 JSON 이 아닙니다.`);
    console.error("  로컬: Firebase 콘솔에서 com.bonitapilates.member 의 google-services.json 을 받아 그 자리에 둔다.");
    console.error("  Codemagic: 환경변수 MEMBER_GOOGLE_SERVICES_JSON (base64) 을 확인한다.");
    process.exit(1);
  }
  const problems = googleServicesProblems(json);
  if (problems.length) {
    console.error(`\n회원 앱 google-services.json 이 맞지 않습니다: ${file}\n`);
    for (const problem of problems) console.error(`  [${problem.code}] ${problem.message}`);
    process.exit(1);
  }
  console.log(`google-services.json 확인: ${MEMBER_PACKAGE} · ${FIREBASE_PROJECT}`);
}
