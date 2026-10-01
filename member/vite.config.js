import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* 번들에 커밋을 심는다.
 *
 * 폰에서 막혔을 때 가장 먼저 묻게 되는 것이 "그 폰에 든 것이 어느 코드냐"
 * 인데, 그것을 물을 방법이 없었다. 진단 화면이 이 값을 보여준다.
 * (강사 앱 Android 빌드도 같은 이유로 커밋을 심는다.) */
function buildStamp() {
  const pkg = JSON.parse(readFileSync(path.join(__dirname, "..", "member-app", "package.json"), "utf8"));
  let commit = "";
  try {
    commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch (_error) {
    /* 저장소 밖에서 빌드할 수도 있다. 없으면 없는 대로 둔다 -- 지어내면
       진단이 거짓말을 한다. */
  }
  return { version: String(pkg.version || ""), commit, builtAt: new Date().toISOString() };
}

/* 회원 앱은 강사 앱과 다른 번들이다. 화면 넷이 문서 하나를 그리는 일이라,
   강사 앱의 2.1MB 를 회원에게 내려받게 할 이유가 없다.

   서비스 워커는 등록하지 않는다. 이 화면의 값어치 전부가 "지금 몇 회
   남았나" 인데, 캐시가 어제 숫자를 보여주면 그것은 틀린 답이다. */
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: { outDir: "../dist-member", emptyOutDir: true },
  define: { __MEMBER_BUILD__: JSON.stringify(buildStamp()) },
});
