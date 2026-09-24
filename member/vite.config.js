import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* 회원 앱은 강사 앱과 다른 번들이다. 화면 넷이 문서 하나를 그리는 일이라,
   강사 앱의 2.1MB 를 회원에게 내려받게 할 이유가 없다.

   서비스 워커는 등록하지 않는다. 이 화면의 값어치 전부가 "지금 몇 회
   남았나" 인데, 캐시가 어제 숫자를 보여주면 그것은 틀린 답이다. */
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: { outDir: "../dist-member", emptyOutDir: true },
});
