import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* 웹 빌드 번호 (2026-10-31). 센터 PC 는 탭을 며칠씩 열어 둔다 -- 새 버전을 배포해도
   그 탭은 옛 코드로 돈다. 빌드마다 번호를 dist/version.json 에 남기고, 앱은 그
   번호가 자기 것과 다르면 "새 버전이 나왔어요 [새로고침]" 을 띄운다
   (src/features/ui/web-version.js). 개발 서버에는 번호가 없다 -- 확인하지 않는다. */
function webBuildId() {
  let commit = "";
  try { commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { commit = ""; }
  return `${Date.now().toString(36)}${commit ? `-${commit}` : ""}`;
}

export default defineConfig(({ command }) => {
  const buildId = command === "build" ? webBuildId() : "";
  return {
    plugins: [
      react(),
      {
        name: "pilateacher-web-version",
        apply: "build",
        generateBundle() {
          this.emitFile({ type: "asset", fileName: "version.json", source: `${JSON.stringify({ build: buildId })}\n` });
        },
      },
    ],
    define: {
      "import.meta.env.VITE_WEB_BUILD_ID": JSON.stringify(buildId),
    },
  };
});
