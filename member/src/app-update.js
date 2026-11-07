/**
 * 보니따 VIP 앱 — 최신 버전 확인 · 강제 업데이트 (2026-11-07, 지시서 11번). **판정은 순수 함수.**
 *
 * ── 어디서 정하나 ──
 * Firebase Remote Config (콘솔에서 바꾸면 앱을 다시 내지 않고 적용된다). 키는
 * MEMBER_UPDATE_KEYS 다 -- 설명과 콘솔 순서는 member-app/README.md "업데이트 안내".
 * 비교는 **빌드 번호**로 한다: Android 는 versionCode, iOS 는 빌드 번호(CFBundleVersion).
 *
 * ── 판정 ──
 * 강사 앱과 같은 판정(src/features/app-update/update-gate.js 의 updatePrompt)에 세 가지를 얹는다:
 *   1. 강제 적용 스위치(force_update_enabled)가 꺼져 있으면 최소 버전 아래여도 "권유" 다
 *   2. **스토어에 아직 새 버전이 없으면 띄우지 않는다** -- 업데이트할 수 없는 회원을 막지 않게.
 *      Android 는 Play 가 말하는 versionCode 가 최소 버전에 못 미치면 막지 않고 권유만 한다
 *   3. 스토어를 확인하지 못하면(네트워크 · Play 서비스 없음) 필수를 권유로 낮춘다 -- 모르면 막지 않는다
 *
 * 설정 · 빌드 번호를 모르면 아무것도 띄우지 않는다 (update-gate.js 와 같은 원칙).
 * 웹(회원 웹)은 배포가 곧 최신이라 띄우지 않는다 -- 웹 캐시 갱신과 네이티브 업데이트는 따로다.
 */

import { UPDATE_PROMPT, buildNumberOf, updatePrompt } from "../../src/features/app-update/update-gate.js";

export { UPDATE_PROMPT };

const text = (value) => String(value ?? "").trim();

/** Remote Config 키. 콘솔에 이 이름 그대로 만든다. 값은 전부 문자열(Boolean 은 "true"/"false"). */
export const MEMBER_UPDATE_KEYS = Object.freeze({
  androidLatest: "member_android_latest_build",
  androidMinimum: "member_android_min_build",
  iosLatest: "member_ios_latest_build",
  iosMinimum: "member_ios_min_build",
  force: "member_force_update_enabled",
  title: "member_update_title",
  message: "member_update_message",
  androidStoreUrl: "member_android_store_url",
  iosStoreUrl: "member_ios_store_url",
});

/** 콘솔에 값이 없을 때의 기본 -- 전부 비어 있다 = 아무것도 띄우지 않는다. */
export const MEMBER_UPDATE_DEFAULTS = Object.freeze(Object.fromEntries(
  Object.values(MEMBER_UPDATE_KEYS).map((key) => [key, ""]),
));

export const MEMBER_UPDATE_COPY = Object.freeze({
  title: "새 버전이 나왔어요",
  optional: "업데이트하면 새 기능과 고친 점이 함께 적용돼요.",
  required: "이 버전은 더 이상 사용할 수 없어요. 업데이트한 뒤 이용해 주세요.",
  update: "지금 업데이트",
  later: "나중에",
  updating: "업데이트 여는 중…",
  failed: "업데이트를 시작하지 못했어요. 다시 시도해 주세요.",
});

const httpsUrl = (value) => (/^https:\/\/[^\s]+$/.test(text(value)) ? text(value) : "");

/** Remote Config 값 한 벌을 화면이 쓰는 모양으로. 오타 · 빈 값은 "정하지 않음" 이다. */
export function readMemberUpdateConfig(values) {
  const get = (key) => text(values?.[key]);
  return {
    android: { latestBuild: get(MEMBER_UPDATE_KEYS.androidLatest), minimumBuild: get(MEMBER_UPDATE_KEYS.androidMinimum) },
    ios: { latestBuild: get(MEMBER_UPDATE_KEYS.iosLatest), minimumBuild: get(MEMBER_UPDATE_KEYS.iosMinimum) },
    force: get(MEMBER_UPDATE_KEYS.force).toLowerCase() === "true",
    title: get(MEMBER_UPDATE_KEYS.title).slice(0, 60),
    message: get(MEMBER_UPDATE_KEYS.message).slice(0, 300),
    androidStoreUrl: httpsUrl(get(MEMBER_UPDATE_KEYS.androidStoreUrl)),
    iosStoreUrl: httpsUrl(get(MEMBER_UPDATE_KEYS.iosStoreUrl)),
  };
}

/** "1.2.10" 과 "1.2.9" 를 숫자 칸마다 견준다. 못 읽으면 null. */
export function compareVersionNames(left, right) {
  const parse = (value) => (/^\d+(\.\d+)*$/.test(text(value)) ? text(value).split(".").map(Number) : null);
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return null;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

/** Play In-App Updates 의 updateAvailability (UpdateAvailability). */
const ANDROID_UPDATE_AVAILABLE = new Set([2, 3]);

/**
 * 스토어가 말하는 것. 플러그인 getAppUpdateInfo 의 답에서.
 * @returns {{ installedBuild: number | null, available: boolean | null, availableBuild: number | null, immediateAllowed: boolean }}
 *   available  true = 스토어에 지금보다 새 버전이 있다, false = 없다, null = 모른다
 */
export function storeStateFrom(platform, info) {
  if (!info || typeof info !== "object") return { installedBuild: null, available: null, availableBuild: null, immediateAllowed: false };
  const installedBuild = buildNumberOf(info.currentVersionCode);
  if (platform === "android") {
    const availability = Number(info.updateAvailability);
    const availableBuild = buildNumberOf(info.availableVersionCode);
    const available = Number.isFinite(availability) && availability > 0
      ? ANDROID_UPDATE_AVAILABLE.has(availability) || (availableBuild !== null && installedBuild !== null && availableBuild > installedBuild)
      : null;
    return { installedBuild, available, availableBuild, immediateAllowed: info.immediateUpdateAllowed === true };
  }
  const compared = compareVersionNames(info.availableVersionName, info.currentVersionName);
  return { installedBuild, available: compared === null ? null : compared > 0, availableBuild: null, immediateAllowed: false };
}

/**
 * 무엇을 띄울 것인가.
 *
 * @param {{
 *   config: ReturnType<typeof readMemberUpdateConfig>, platform: string, installedBuild: unknown,
 *   store?: { available: boolean | null, availableBuild?: number | null },
 *   snoozedAt?: unknown, dismissedBuild?: unknown, now?: Date,
 * }} input
 * @returns {{ prompt: string, reason: string, latestBuild: number | null }}
 */
export function decideMemberUpdate(input) {
  const platform = text(input?.platform);
  const config = input?.config || readMemberUpdateConfig({});
  const store = input?.store || { available: null, availableBuild: null };
  /* 최소를 뺄 때(권유로 낮출 때)는 최소를 최신 자리에 둔다 -- 최신이 비어 있어도 권유가 서게. */
  const row = (key, withMinimum) => (withMinimum ? config[key]
    : { latestBuild: config[key].latestBuild || config[key].minimumBuild, minimumBuild: "" });
  const gateConfig = (withMinimum) => ({ android: row("android", withMinimum), ios: row("ios", withMinimum) });
  const base = (withMinimum) => updatePrompt({
    config: gateConfig(withMinimum), platform, installedBuild: input?.installedBuild,
    snoozedAt: input?.snoozedAt, dismissedBuild: input?.dismissedBuild, now: input?.now,
  });

  const decided = base(true);
  let reason = decided.prompt === UPDATE_PROMPT.REQUIRED ? "below_minimum" : decided.prompt === UPDATE_PROMPT.OPTIONAL ? "below_latest" : "up_to_date";
  if (decided.prompt === UPDATE_PROMPT.NONE) return { prompt: UPDATE_PROMPT.NONE, reason, latestBuild: null };

  /* 스토어에 새 버전이 없으면 보낼 곳이 없다 -- 막지도 권하지도 않는다. */
  if (store.available === false) return { prompt: UPDATE_PROMPT.NONE, reason: "store_has_no_update", latestBuild: null };

  if (decided.prompt === UPDATE_PROMPT.REQUIRED) {
    const minimum = buildNumberOf(config[platform]?.minimumBuild);
    const storeBehind = platform === "android" && store.availableBuild !== null && store.availableBuild !== undefined
      && minimum !== null && store.availableBuild < minimum;
    const downgrade = !config.force ? "force_off"
      : store.available === null ? "store_unknown"
        : storeBehind ? "store_behind_minimum" : "";
    if (downgrade) {
      /* 권유로 낮춘다. 권유는 "나중에" · "오늘 그만" 규칙을 따른다. */
      const optional = base(false);
      return { prompt: optional.prompt, reason: optional.prompt === UPDATE_PROMPT.NONE ? "snoozed" : downgrade, latestBuild: optional.latestBuild };
    }
    reason = "below_minimum";
  }
  return { prompt: decided.prompt, reason, latestBuild: decided.latestBuild };
}

/** 플러그인 (@capawesome/capacitor-app-update). 네이티브가 아니거나 없으면 null. */
export function appUpdatePlugin(globals = globalThis) {
  const capacitor = globals?.Capacitor;
  try {
    if (!capacitor?.isNativePlatform?.()) return null;
    return capacitor?.Plugins?.AppUpdate
      || (typeof capacitor?.registerPlugin === "function" ? capacitor.registerPlugin("AppUpdate") : null);
  } catch (_error) {
    return null;
  }
}

/** "android" | "ios" | "web". */
export function nativePlatform(globals = globalThis) {
  try {
    const platform = text(globals?.Capacitor?.getPlatform?.());
    return platform === "android" || platform === "ios" ? platform : "web";
  } catch (_error) {
    return "web";
  }
}

export const UPDATE_START = Object.freeze({ IMMEDIATE: "immediate", STORE: "store", URL: "url" });

/**
 * [지금 업데이트] 가 무엇을 할 것인가.
 * Android: Play 의 즉시 업데이트가 되면 그것, 아니면 스토어 페이지.
 * iOS: 앱스토어 페이지 (콘솔에 주소가 있으면 그 주소).
 */
export function updateStartPlan(platform, store, config) {
  if (platform === "android") {
    if (store?.available && store?.immediateAllowed) return { kind: UPDATE_START.IMMEDIATE };
    return config?.androidStoreUrl ? { kind: UPDATE_START.URL, url: config.androidStoreUrl } : { kind: UPDATE_START.STORE };
  }
  return config?.iosStoreUrl ? { kind: UPDATE_START.URL, url: config.iosStoreUrl } : { kind: UPDATE_START.STORE };
}

/** 기기에 적는 "나중에" (오늘만) · 진단에 남길 것. 이름 · 번호 없음. */
export const UPDATE_SNOOZE_KEY = "pilateacher.member.update.snoozedAt";
