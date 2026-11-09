/**
 * 회원 앱 수업 알림 (2026-11-07, 지시서 2차 기본): 권한 흐름 · 토큰 등록 · 설정 두 개 ·
 * 웹은 "앱에서만" · 알림 누르면 홈 · 설정 카드 렌더.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

import {
  ANDROID_CHANNEL, DEFAULT_PREFS, PUSH_KIND, PUSH_PERMISSION, PUSH_ROWS, PUSH_SUPPORT,
  forgetPushDevice, normalizePrefs, permissionGuide, permissionOf, pushPlugin, pushSupport,
  registerDevice, tapTarget,
} from "../../member/src/push.js";

function fakePlugin({ permission = "granted", afterRequest = "granted", token = "tok-1", tokenError = null } = {}) {
  const calls = [];
  return {
    calls,
    checkPermissions: async () => { calls.push("check"); return { receive: permission }; },
    requestPermissions: async () => { calls.push("request"); return { receive: afterRequest }; },
    createChannel: async (channel) => { calls.push(`channel:${channel.id}`); },
    getToken: async () => { calls.push("token"); if (tokenError) throw tokenError; return { token }; },
    deleteToken: async () => { calls.push("deleteToken"); },
  };
}

test("웹에서는 플러그인이 없다 — '앱에서만' 으로 끝난다", () => {
  assert.equal(pushPlugin({}), null);
  assert.equal(pushSupport({ Capacitor: { isNativePlatform: () => false } }), PUSH_SUPPORT.WEB);
  const plugin = {};
  assert.equal(pushPlugin({ Capacitor: { isNativePlatform: () => true, Plugins: { FirebaseMessaging: plugin } } }), plugin);
});

test("권한 값을 셋으로", () => {
  assert.equal(permissionOf({ receive: "granted" }), PUSH_PERMISSION.GRANTED);
  assert.equal(permissionOf({ receive: "denied" }), PUSH_PERMISSION.DENIED);
  assert.equal(permissionOf({ receive: "prompt-with-rationale" }), PUSH_PERMISSION.PROMPT);
  assert.equal(permissionOf(null), PUSH_PERMISSION.UNKNOWN);
});

test("처음이면 묻고, 허용하면 토큰을 서버에 넘긴다 · 안드로이드는 채널을 만든다", async () => {
  const plugin = fakePlugin({ permission: "prompt" });
  const sent = [];
  const outcome = await registerDevice({ plugin, platform: "android", register: async (input) => { sent.push(input); } });
  assert.deepEqual(outcome, { permission: PUSH_PERMISSION.GRANTED, registered: true });
  assert.deepEqual(plugin.calls, ["check", "request", `channel:${ANDROID_CHANNEL.id}`, "token"]);
  assert.deepEqual(sent, [{ token: "tok-1", platform: "android" }]);
});

test("거절하면 토큰을 받지 않고 거절로 남는다 — 설정 화면이 켜는 길을 보여 준다", async () => {
  const plugin = fakePlugin({ permission: "prompt", afterRequest: "denied" });
  const records = [];
  const outcome = await registerDevice({ plugin, platform: "ios", register: async () => {}, record: (entry) => records.push(entry) });
  assert.equal(outcome.permission, PUSH_PERMISSION.DENIED);
  assert.equal(outcome.registered, false);
  assert.ok(!plugin.calls.includes("token"));
  assert.match(permissionGuide("ios"), /설정/);
  assert.match(permissionGuide("android"), /설정/);
});

test("토큰을 못 받거나 서버가 거절하면 원본 코드를 남긴다 — 토큰 값은 진단에 없다", async () => {
  const records = [];
  const failed = await registerDevice({
    plugin: fakePlugin({ tokenError: Object.assign(new Error("no apns"), { code: "UNAVAILABLE" }) }),
    platform: "ios", register: async () => {}, record: (entry) => records.push(entry),
  });
  assert.equal(failed.errorCode, "UNAVAILABLE");
  const serverRefused = await registerDevice({
    plugin: fakePlugin(), platform: "ios",
    register: async () => { throw Object.assign(new Error("x"), { details: { code: "member_link_missing" } }); },
    record: (entry) => records.push(entry),
  });
  assert.equal(serverRefused.errorCode, "member_link_missing");
  assert.equal(JSON.stringify(records).includes("tok-1"), false);
});

test("설정 두 개 — 모르는 값은 켜짐", () => {
  assert.deepEqual(normalizePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(normalizePrefs({ lessonRating: false }), { lessonRating: false, lesson30m: true });
  assert.deepEqual(PUSH_ROWS.map((row) => row.kind), [PUSH_KIND.LESSON_RATING, PUSH_KIND.LESSON_30M]);
});

test("알림을 누르면 홈(달력)으로", () => {
  assert.equal(tapTarget({ data: { lessonId: "L1" } }), "home");
});

test("로그아웃 전 토큰 떼기 — 실패해도 던지지 않는다", async () => {
  const plugin = fakePlugin();
  const removed = [];
  assert.equal(await forgetPushDevice({ plugin, unregister: async (input) => { removed.push(input); } }), true);
  assert.deepEqual(removed, [{ token: "tok-1" }]);
  assert.ok(plugin.calls.includes("deleteToken"));
  assert.equal(await forgetPushDevice({ plugin: fakePlugin(), unregister: async () => { throw new Error("offline"); } }), false);
  assert.equal(await forgetPushDevice({ plugin: null, unregister: async () => {} }), false);
});

/* ── 설정 카드 ────────────────────────────────────────────────────────── */

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
let vite = null;
const screens = async () => {
  vite ||= await createServer({
    root: projectRoot, configFile: false, plugins: [react()], appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, logLevel: "silent",
  });
  return vite.ssrLoadModule("/member/src/screens.jsx");
};
test.after(async () => { if (vite) await vite.close(); });

const basePush = { support: PUSH_SUPPORT.NATIVE, permission: PUSH_PERMISSION.GRANTED, prefs: DEFAULT_PREFS, saving: "", errorCode: "", guide: "휴대폰 설정에서 켜 주세요.", onToggle: () => {}, onEnable: () => {} };

test("설정 카드 — 두 알림이 따로 켜고 꺼진다", async () => {
  const { PushSettings } = await screens();
  const html = renderToStaticMarkup(createElement(PushSettings, { push: { ...basePush, prefs: { lessonRating: true, lesson30m: false } } }));
  assert.match(html, /수업 후 평가/);
  assert.match(html, /수업 종료 10분 뒤 · 한 번만/);
  assert.match(html, /수업 30분 전/);
  assert.match(html, /수업 리마인드/);
  assert.match(html, /data-push-row="lessonRating"[\s\S]*?aria-checked="true"/);
  assert.match(html, /data-push-row="lesson30m"[\s\S]*?aria-checked="false"/);
});

test("설정 카드 — 웹은 '앱에서만', 권한이 꺼졌으면 켜는 길, 저장 실패는 코드와 함께", async () => {
  const { PushSettings } = await screens();
  const web = renderToStaticMarkup(createElement(PushSettings, { push: { ...basePush, support: PUSH_SUPPORT.WEB } }));
  assert.match(web, /앱에서만 받을 수 있어요/);
  assert.doesNotMatch(web, /role="switch"/);
  const blocked = renderToStaticMarkup(createElement(PushSettings, { push: { ...basePush, permission: PUSH_PERMISSION.DENIED } }));
  assert.match(blocked, /data-push-blocked/);
  assert.match(blocked, /휴대폰 설정에서 켜 주세요/);
  const failed = renderToStaticMarkup(createElement(PushSettings, { push: { ...basePush, errorCode: "unavailable" } }));
  assert.match(failed, /\(코드 unavailable\)/);
});

test("평가 알림은 소속·회원·수업을 담아야 하며 기존 알림 전체 끔을 존중한다", async () => {
  const { ratingTarget } = await import("../../member/src/push.js");
  const data = { kind: "lessonRating", open: "rating", organizationId: "org", clientId: "c1", lessonId: "L1" };
  assert.deepEqual(ratingTarget({ data }), { organizationId: "org", clientId: "c1", lessonId: "L1" });
  assert.equal(ratingTarget({ data: { ...data, lessonId: "a/b" } }), null);
  assert.equal(ratingTarget({ data: { ...data, clientId: "" } }), null);
  assert.equal(ratingTarget({ data: { ...data, kind: "lesson30m" } }), null);
  assert.equal(normalizePrefs({ lesson30h: false, lesson30m: false }).lessonRating, false);
  assert.equal(normalizePrefs({ lesson30h: false, lesson30m: false, lessonRating: true }).lessonRating, true);
});
