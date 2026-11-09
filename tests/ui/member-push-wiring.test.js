/**
 * 회원 수업 알림 (2026-11-07) 배선: 대표 스위치 카드 · 회원 앱 연결 · 서버 스위치 문서.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

test("대표 화면 — 앱 업데이트 안내에 '회원 수업 알림' 스위치 (끔 · 전체만)", async (t) => {
  const vite = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)), configFile: false, plugins: [react()], appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, ssr: { noExternal: ["@capgo/camera-preview"] }, logLevel: "silent",
  });
  t.after(() => vite.close());
  const { createAppScreenSmokeCases } = await vite.ssrLoadModule("/src/App.jsx");
  const screen = createAppScreenSmokeCases().find((item) => item.name === "더보기 탭 · 앱 업데이트 안내");
  const markup = renderToStaticMarkup(screen.element);
  const card = markup.slice(markup.indexOf('data-schedule-sync-admin="memberPush"'));
  assert.ok(card.length > 0 && markup.includes('data-schedule-sync-admin="memberPush"'));
  assert.match(card, /회원 수업 알림/);
  assert.match(card, /회원 이름은 알림에 들어가지 않습니다/);
  const cardOnly = card.slice(0, card.indexOf("</section>"));
  assert.doesNotMatch(cardOnly, /고른 계정만/, "회원 알림에는 강사 목록을 고르는 칸이 없다");
  assert.match(cardOnly, />끔</);
  assert.match(cardOnly, />전체</);
});

test("회원 앱 — 화면이 열리면 등록, 로그아웃 · 계정 삭제 전에 토큰 떼기, 마이페이지에 설정", async () => {
  const source = await readFile(new URL("../../member/src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /registerDevice\(\{[\s\S]*?memberPushSettings\(\{ action: "register", token, platform \}\)/);
  const signOut = source.slice(source.indexOf("const signOutNow"));
  assert.ok(signOut.indexOf("forgetPushDevice") > -1 && signOut.indexOf("forgetPushDevice") < signOut.indexOf("await signOutMember()"),
    "로그아웃보다 먼저 토큰을 뗀다");
  const remove = source.slice(source.indexOf("const removeAccount"));
  assert.ok(remove.indexOf("forgetPushDevice") < remove.indexOf("await deleteMemberAccount()"), "계정 삭제보다 먼저");
  assert.match(source, /<MyPage[\s\S]*?push=\{\{/);
  assert.match(source, /addListener\("notificationActionPerformed"/);
});

test("서버 — 스위치 문서는 runtimeConfig/memberPush, 대표 통로로 쓴다", async () => {
  const admin = await readFile(new URL("../../functions/src/runtime-config-admin.js", import.meta.url), "utf8");
  assert.match(admin, /memberPush: scheduleSyncPayload/);
  const index = await readFile(new URL("../../functions/src/index.js", import.meta.url), "utf8");
  assert.match(index, /exports\.sendMemberLessonReminders = onSchedule\(\{[\s\S]*?schedule: "every 1 minutes"/);
  assert.match(index, /exports\.memberPushSettings = onCall\(MEMBER_LINK_OPTIONS/);
});
