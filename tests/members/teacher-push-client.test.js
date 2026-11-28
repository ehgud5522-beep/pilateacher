import assert from "node:assert/strict";
import test from "node:test";
import { TEACHER_PUSH_CHANNEL, registerTeacherDevice } from "../../src/features/notifications/teacher-push-client.js";

/* 2026-11-28 대표: 강사에게 푸시. 강사 앱 기기 등록. */

const native = (platform, { available = true, permission = "granted", token = "tok-1" } = {}) => {
  const calls = { channel: null, asked: 0 };
  const plugin = {
    checkPermissions: async () => ({ receive: permission }),
    requestPermissions: async () => { calls.asked += 1; return { receive: "granted" }; },
    createChannel: async (channel) => { calls.channel = channel; },
    getToken: async () => ({ token }),
  };
  return {
    calls,
    globals: { Capacitor: { isNativePlatform: () => true, getPlatform: () => platform, isPluginAvailable: () => available, Plugins: { FirebaseMessaging: plugin } } },
  };
};

test("안드로이드: 강사 채널을 만들고 토큰을 센터와 함께 서버에 넘긴다", async () => {
  const { globals, calls } = native("android");
  const sent = [];
  const result = await registerTeacherDevice({ organizationId: "bonita", call: async (payload) => { sent.push(payload); }, globals });
  assert.equal(result.registered, true);
  assert.equal(calls.channel.id, TEACHER_PUSH_CHANNEL.id);
  assert.equal(TEACHER_PUSH_CHANNEL.id, "teacher_alerts", "서버 teacher-push.js 의 채널과 같다");
  assert.deepEqual(sent, [{ action: "register", organizationId: "bonita", token: "tok-1", platform: "android" }]);
});

test("플러그인이 실리지 않은 빌드 · 웹 · 소속 없음은 묻지도 않는다", async () => {
  const missing = native("ios", { available: false });
  const sent = [];
  assert.equal((await registerTeacherDevice({ organizationId: "bonita", call: async (p) => sent.push(p), globals: missing.globals })).skipped, "plugin_missing");
  assert.equal(missing.calls.asked, 0);
  assert.equal((await registerTeacherDevice({ organizationId: "bonita", call: async (p) => sent.push(p), globals: {} })).skipped, "not_native");
  assert.equal((await registerTeacherDevice({ organizationId: "", call: async (p) => sent.push(p), globals: native("android").globals })).skipped, "no_organization");
  assert.equal(sent.length, 0);
});

test("거절한 강사에게는 토큰을 보내지 않는다", async () => {
  const { globals } = native("android", { permission: "denied" });
  const sent = [];
  const result = await registerTeacherDevice({ organizationId: "bonita", call: async (p) => sent.push(p), globals });
  assert.equal(result.registered, false);
  assert.equal(result.permission, "denied");
  assert.equal(sent.length, 0);
});

test("iOS 는 아직 묻지 않는다 -- 애플 푸시 설정 전 (1.1.63)", async () => {
  const { globals, calls } = native("ios");
  const sent = [];
  const result = await registerTeacherDevice({ organizationId: "bonita", call: async (p) => sent.push(p), globals });
  assert.equal(result.skipped, "platform_not_ready");
  assert.equal(calls.asked, 0);
  assert.equal(sent.length, 0);
});
