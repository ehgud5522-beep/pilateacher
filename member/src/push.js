/**
 * 수업 알림 (2026-11-07 대표, 지시서 2차 기본 기능). 회원 앱에서만 받는다.
 *
 * 두 가지를 따로 켜고 끈다: 수업 종료 10분 뒤(평가) · 수업 30분 전(수업 리마인드).
 * 보내는 것은 서버다 (functions/src/member-push.js). 이 파일은 기기 쪽 셋만 한다:
 *   1. 알림 권한을 묻고, 기기 토큰을 받아 서버 통로(memberPushSettings)로 넘긴다
 *   2. 알림 설정 두 개를 읽고 쓴다 (같은 통로)
 *   3. 알림을 누르면 앱의 어디를 열지 정한다
 *
 * ── 웹에서는 안 된다 ──
 * 플러그인이 네이티브에만 있다. 브라우저에서는 "앱에서만 받을 수 있어요" 로 끝낸다 --
 * 권한 거부처럼 보이게 두지 않는다 (CLAUDE.md "웹에서 안 되는 것").
 *
 * 플러그인은 npm 모듈을 가져오지 않고 Capacitor 전역에서 찾는다. 회원 앱 번들이
 * 다른 네이티브 플러그인과 같은 방식이다 (firebase.js 의 capacitor()).
 *
 * 토큰 값은 진단에 적지 않는다 -- 있었는지만 (§7).
 */

export const PUSH_KIND = Object.freeze({ LESSON_RATING: "lessonRating", LESSON_30M: "lesson30m" });

/** 설정 화면의 두 줄. 이름과 설명은 대표가 정한 알림 이름 그대로다. */
export const PUSH_ROWS = Object.freeze([
  Object.freeze({ kind: PUSH_KIND.LESSON_RATING, title: "수업 후 평가", label: "수업 종료 10분 뒤 · 한 번만" }),
  Object.freeze({ kind: PUSH_KIND.LESSON_30M, title: "수업 30분 전", label: "수업 리마인드" }),
]);

/** 안드로이드 알림 채널. 서버가 같은 id 로 보낸다 (member-push.js ANDROID_CHANNEL). */
export const ANDROID_CHANNEL = Object.freeze({
  id: "lesson_reminders", name: "수업 알림", description: "수업 전 안내 · 수업 후 평가", importance: 4,
});

export const PUSH_SUPPORT = Object.freeze({ NATIVE: "native", WEB: "web" });
export const PUSH_PERMISSION = Object.freeze({
  GRANTED: "granted", DENIED: "denied", PROMPT: "prompt", UNKNOWN: "unknown",
});

/** 설정이 없으면 둘 다 켜짐이다 (서버도 같은 기본값). */
export const DEFAULT_PREFS = Object.freeze({ [PUSH_KIND.LESSON_RATING]: true, [PUSH_KIND.LESSON_30M]: true });

const text = (value) => String(value ?? "").trim();

/** 플러그인. 네이티브가 아니거나 없으면 null. */
export function pushPlugin(globals = globalThis) {
  const capacitor = globals?.Capacitor;
  try {
    if (!capacitor?.isNativePlatform?.()) return null;
    return capacitor?.Plugins?.FirebaseMessaging
      || (typeof capacitor?.registerPlugin === "function" ? capacitor.registerPlugin("FirebaseMessaging") : null);
  } catch (_error) {
    return null;
  }
}

export function pushSupport(globals = globalThis) {
  return pushPlugin(globals) ? PUSH_SUPPORT.NATIVE : PUSH_SUPPORT.WEB;
}

export function platformOf(globals = globalThis) {
  try {
    const name = text(globals?.Capacitor?.getPlatform?.());
    return name === "ios" || name === "android" ? name : "";
  } catch (_error) {
    return "";
  }
}

/** 플러그인의 권한 값을 셋으로. */
export function permissionOf(result) {
  const value = text(result?.receive);
  if (value === "granted") return PUSH_PERMISSION.GRANTED;
  if (value === "denied") return PUSH_PERMISSION.DENIED;
  if (value === "prompt" || value === "prompt-with-rationale") return PUSH_PERMISSION.PROMPT;
  return PUSH_PERMISSION.UNKNOWN;
}

/** 권한이 꺼져 있을 때 켜는 길. 기기마다 메뉴가 다르다. */
export function permissionGuide(platform) {
  if (platform === "ios") return "아이폰 설정 → 앱 → 보니따필라테스 → 알림 → 알림 허용을 켜 주세요.";
  if (platform === "android") return "휴대폰 설정 → 애플리케이션 → 보니따필라테스 → 알림을 켜 주세요.";
  return "휴대폰 설정에서 이 앱의 알림을 켜 주세요.";
}

/** 받은 설정을 두 칸으로. 모르는 값은 켜짐. */
export function normalizePrefs(prefs) {
  const source = prefs && typeof prefs === "object" ? prefs : {};
  return {
    [PUSH_KIND.LESSON_RATING]: typeof source[PUSH_KIND.LESSON_RATING] === "boolean" ? source[PUSH_KIND.LESSON_RATING] : !(source.lesson30h === false && source.lesson30m === false),
    [PUSH_KIND.LESSON_30M]: source[PUSH_KIND.LESSON_30M] !== false,
  };
}

/** 알림을 눌렀을 때 열 탭. 수업 하나를 따로 여는 화면이 아직 없어 홈(달력)이다. */
export function tapTarget(_notification) {
  return "home";
}

/** 알림이 지정한 수업만 연다. 소속·회원 확인은 화면과 서버에서 다시 한다. */
export function ratingTarget(notification) {
  const data = notification?.data;
  if (data?.kind !== PUSH_KIND.LESSON_RATING || data?.open !== "rating") return null;
  const result = {};
  for (const key of ["organizationId", "clientId", "lessonId"]) {
    const value = String(data[key] || "").trim();
    if (!value || value.length > 200 || value.includes("/")) return null;
    result[key] = value;
  }
  return result;
}

/**
 * 권한을 확인하고(필요하면 묻고), 토큰을 받아 서버에 넘긴다.
 *
 * @param {{
 *   plugin: any, platform: string, register: (input: { token: string, platform: string }) => Promise<any>,
 *   ask?: boolean, record?: (entry: any) => void,
 * }} input
 * @returns {Promise<{ permission: string, registered: boolean, errorCode?: string }>}
 */
export async function registerDevice(input) {
  const { plugin, platform, register, ask = true, record = () => {} } = input;
  if (!plugin) return { permission: PUSH_PERMISSION.UNKNOWN, registered: false };
  let permission;
  try {
    permission = permissionOf(await plugin.checkPermissions());
    if (permission === PUSH_PERMISSION.PROMPT && ask) permission = permissionOf(await plugin.requestPermissions());
  } catch (error) {
    const errorCode = text(error?.code) || "unknown";
    record({ stage: "permission", errorDomain: "capacitor_plugin", errorCode, message: error?.message });
    return { permission: PUSH_PERMISSION.UNKNOWN, registered: false, errorCode };
  }
  if (permission !== PUSH_PERMISSION.GRANTED) {
    record({ stage: "permission", message: permission });
    return { permission, registered: false };
  }
  try {
    if (platform === "android") await plugin.createChannel?.(ANDROID_CHANNEL);
    const { token } = await plugin.getToken();
    if (!text(token)) {
      record({ stage: "token", errorDomain: "capacitor_plugin", errorCode: "token_empty" });
      return { permission, registered: false, errorCode: "token_empty" };
    }
    await register({ token: text(token), platform });
    record({ stage: "registered", message: "토큰 있음" });
    return { permission, registered: true };
  } catch (error) {
    const errorCode = text(error?.details?.code || error?.code) || "unknown";
    record({ stage: "register", errorDomain: error?.details ? "functions" : "capacitor_plugin", errorCode, message: error?.message });
    return { permission, registered: false, errorCode };
  }
}

/**
 * 로그아웃 전에 이 기기 토큰을 서버에서 지운다. 실패해도 로그아웃은 막지 않는다 --
 * 남은 토큰은 다음 발송 때 FCM 이 죽은 토큰으로 알려 서버가 지운다.
 */
export async function forgetPushDevice({ plugin, unregister, record = () => {} }) {
  if (!plugin) return false;
  try {
    const { token } = await plugin.getToken();
    if (text(token)) await unregister({ token: text(token) });
    await plugin.deleteToken?.();
    return true;
  } catch (error) {
    record({ stage: "unregister", errorDomain: "capacitor_plugin", errorCode: text(error?.code) || "unknown", message: error?.message });
    return false;
  }
}
