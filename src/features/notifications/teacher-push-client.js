/**
 * 강사 폰 푸시 -- 기기 등록 (2026-11-28 대표: "강사한테 푸시 알림으로 오게끔").
 *
 * 폰 앱(네이티브)에서만. 센터 소속으로 앱이 열리면 한 번: 권한을 묻고(처음 한 번) 토큰을 서버
 * teacherPushSettings 에 넘긴다 (teacherPush/{uid}). 보내는 것은 서버다 (functions/src/teacher-push.js) --
 * 스위치(runtimeConfig/teacherPush)가 꺼져 있으면 토큰이 있어도 안 간다.
 *
 * 권한 묻기 · 토큰 받기는 보니따와 같은 코드(member/src/push.js registerDevice)를 쓴다. 채널만 다르다.
 * 실패해도 앱은 그대로 -- 알림함이 기록이고 푸시는 덤이다. 토큰 값은 진단에 남기지 않는다.
 */
import { platformOf, pushPlugin, registerDevice } from "../../../member/src/push.js";

export const TEACHER_PUSH_PLATFORMS = Object.freeze(["android"]);

/** 서버 teacher-push.js 의 ANDROID_CHANNEL 과 같은 id. */
export const TEACHER_PUSH_CHANNEL = Object.freeze({
  id: "teacher_alerts", name: "회원 알림", description: "회원 요청 · 수업 전 몸 상태 · 수업 취소", importance: 4,
});

/**
 * @param {{ organizationId: string, call: (payload: any) => Promise<any>, record?: (entry: any) => void, globals?: any }} input
 * @returns {Promise<{ permission: string, registered: boolean, errorCode?: string, skipped?: string }>}
 */
export async function registerTeacherDevice({ organizationId, call, record = () => {}, globals = globalThis }) {
  const plugin = pushPlugin(globals);
  if (!plugin) return { permission: "unknown", registered: false, skipped: "not_native" };
  /* 네이티브에 플러그인이 실리지 않은 빌드(1.1.63 iOS 처럼 -- 애플 푸시 설정 전)는 묻지도 않는다.
     registerPlugin 은 없는 플러그인에도 대리 객체를 주고, 부르면 "not implemented" 로 끝난다. */
  try {
    if (globals?.Capacitor?.isPluginAvailable?.("FirebaseMessaging") === false) {
      return { permission: "unknown", registered: false, skipped: "plugin_missing" };
    }
  } catch (_error) {
    return { permission: "unknown", registered: false, skipped: "plugin_missing" };
  }
  /* iOS 는 애플 App ID 의 Push 기능 · Firebase APNs 키가 준비된 빌드부터 (2026-11-28, 1.1.63 은 안드로이드만).
     그 전에 물으면 강사는 허용해도 아무것도 오지 않는다. 준비되면 여기에 "ios" 를 더한다. */
  if (!TEACHER_PUSH_PLATFORMS.includes(platformOf(globals))) return { permission: "unknown", registered: false, skipped: "platform_not_ready" };
  if (!String(organizationId || "").trim()) return { permission: "unknown", registered: false, skipped: "no_organization" };
  return registerDevice({
    plugin, platform: platformOf(globals), record, channel: TEACHER_PUSH_CHANNEL,
    register: ({ token, platform }) => call({ action: "register", organizationId, token, platform }),
  });
}
