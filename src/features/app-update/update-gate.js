/**
 * 앱 업데이트 안내 — **언제 띄우고, 언제 막는가.**
 *
 * ── 왜 필요한가 ──
 * 차감 계산이 전부 기기에서 돈다. 업데이트하지 않은 폰은 옛 규칙으로 계산한
 * 차감을 원장에 계속 박고, 원장은 append-only 라 되돌리는 것은 대표뿐이다
 * (settlement-gate.js 머리말과 같은 이유다). 그런데 지금은 강사가 새 빌드가
 * 나온 사실 자체를 알 길이 없다 -- 스토어를 스스로 열어 보지 않는 한.
 *
 * ── 두 단계다 ──
 * 최신 빌드보다 낮으면 **권유**한다: [업데이트] [나중에]. 최소 빌드보다 낮으면
 * **필수**다: [나중에] 가 없다. 최소 빌드는 "이 빌드로는 더 이상 쓰면 안 된다"
 * 는 뜻이고, 그 선은 규칙이 함께 막아 줄 때에만 의미가 있다.
 *
 * ── 모르면 띄우지 않는다 ──
 * 설정을 못 읽거나 빌드 번호를 못 읽으면 아무것도 하지 않는다. 네트워크가
 * 흔들렸다고 앱이 팝업에 막히면, 그것은 업데이트를 돕는 것이 아니라 일을
 * 막는 것이다. 0 으로 바꾸지도 않는다 -- "읽지 못했다" 가 "아주 낮은 빌드" 가
 * 되면 번호를 못 읽는 기기가 전부 필수 팝업에 갇힌다.
 *
 * ── 웹에는 띄우지 않는다 ──
 * 웹은 배포한 순간이 최신이다. 새로고침이 곧 업데이트라 안내할 것이 없고,
 * 스토어로 보낼 수도 없다.
 *
 * ── 회원 앱도 쓴다 ──
 * 판정은 여기 하나다. 보니따(회원 앱)가 같은 모듈을 불러 쓰되, 이번에는 강사
 * 앱만 켠다 -- 플랫폼과 설정만 바꿔 넣으면 된다.
 */

/** 무엇을 띄울 것인가. */
export const UPDATE_PROMPT = Object.freeze({
  /** 띄우지 않는다. 최신이거나, 모르거나, 오늘 이미 "나중에" 를 눌렀다. */
  NONE: "none",
  /** 권유. [업데이트] [나중에] */
  OPTIONAL: "optional",
  /** 필수. [나중에] 가 없다. */
  REQUIRED: "required",
});

const text = (value) => String(value ?? "").trim();

/**
 * 빌드 번호를 숫자로. 못 읽으면 null 이다 -- 0 으로 바꾸지 않는다.
 *
 * settlement-gate.js 의 buildNumberOf 와 같은 규칙이고 같은 이유다. 거기와
 * 따로 두는 것은 저쪽이 "확정을 막는" 판정이고 이쪽은 "안내를 띄우는" 판정이라,
 * 한쪽을 고칠 때 다른 쪽이 조용히 따라 움직이면 안 되기 때문이다.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
export function buildNumberOf(value) {
  const raw = text(value);
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * 콘솔에서 손으로 적는 문서다. 읽는 쪽이 모양을 정한다 -- 오타가 화면까지
 * 가면 "왜 팝업이 뜨는지" 를 아무도 설명할 수 없다.
 *
 * 빈 값은 "정하지 않았다" 이고 그대로 둔다. 0 으로 채우면 아무도 안 걸리는
 * 것이 아니라, 최소 빌드 0 이 "모두 통과" 로 읽혀 나중에 값을 넣었을 때의
 * 동작과 달라진다.
 *
 * @param {any} document
 */
export function readAppUpdateConfig(document) {
  const source = document && typeof document === "object" ? document : {};
  const platform = (key) => {
    const row = source[key] && typeof source[key] === "object" ? source[key] : {};
    return {
      latestBuild: text(row.latestBuild),
      minimumBuild: text(row.minimumBuild),
      message: text(row.message).slice(0, 200),
    };
  };
  return { android: platform("android"), ios: platform("ios") };
}

/**
 * 이 기기에 무엇을 띄울 것인가.
 *
 * @param {{
 *   config?: any, platform?: string, installedBuild?: unknown,
 *   snoozedAt?: unknown, now?: Date,
 * }} input
 *   platform       "android" | "ios" | 그 밖(웹 포함)
 *   installedBuild 지금 깔린 빌드 번호
 *   snoozedAt      마지막으로 [나중에] 를 누른 시각 (ISO 또는 ms)
 * @returns {{ prompt: string, latestBuild: number | null, message: string }}
 */
export function updatePrompt(input = {}) {
  const nothing = { prompt: UPDATE_PROMPT.NONE, latestBuild: null, message: "" };

  const platform = text(input.platform);
  // 웹은 배포한 순간이 최신이다. 보낼 스토어도 없다.
  if (platform !== "android" && platform !== "ios") return nothing;

  const config = readAppUpdateConfig(input.config)[platform];
  const installed = buildNumberOf(input.installedBuild);
  // 모르면 띄우지 않는다. 0 으로 바꾸면 못 읽는 기기가 전부 갇힌다.
  if (installed === null) return nothing;

  const latest = buildNumberOf(config.latestBuild);
  const minimum = buildNumberOf(config.minimumBuild);
  const message = config.message;

  /* 필수가 먼저다. 최소 빌드보다 낮으면 "나중에" 를 눌러 둔 기억이 있어도
     다시 묻는다 -- 그 선은 더 이상 쓰면 안 된다는 뜻이다. */
  if (minimum !== null && installed < minimum) {
    return { prompt: UPDATE_PROMPT.REQUIRED, latestBuild: latest ?? minimum, message };
  }

  if (latest === null || installed >= latest) return nothing;

  // 하루에 한 번만 묻는다. 열 때마다 뜨면 그 팝업은 곧 반사적으로 닫힌다.
  if (snoozedToday(input.snoozedAt, input.now)) return nothing;

  return { prompt: UPDATE_PROMPT.OPTIONAL, latestBuild: latest, message };
}

/**
 * 오늘 이미 "나중에" 를 눌렀는가. **날짜로 센다.**
 *
 * 24시간으로 세면 매일 조금씩 밀려서, 아침에 누른 사람이 다음 날 아침에는
 * 안 보고 저녁에 보게 된다. 날짜가 바뀌면 다시 묻는 쪽이 예측된다.
 */
export function snoozedToday(snoozedAt, now = new Date()) {
  const at = toDate(snoozedAt);
  if (!at) return false;
  const today = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
  return at.getFullYear() === today.getFullYear()
    && at.getMonth() === today.getMonth()
    && at.getDate() === today.getDate();
}

function toDate(value) {
  if (!value) return null;
  const at = value instanceof Date ? value : new Date(typeof value === "number" ? value : text(value));
  return Number.isFinite(at.getTime()) ? at : null;
}

/** 앱 스토어 주소. 번들 ID 로 조회해 확인한 값이다 (2026-10-05). */
export const APP_STORE_ID = "6795406545";
export const ANDROID_PACKAGE = "com.pilateacher.app";

/**
 * [업데이트] 가 여는 곳. **두 개를 돌려준다.**
 *
 * 앞엣것은 스토어 앱을 직접 여는 주소이고, 뒤엣것은 그것이 실패했을 때의
 * 웹 주소다. 스토어 앱이 없는 기기(에뮬레이터·일부 중국향 롬)에서 앞엣것만
 * 쓰면 버튼이 아무 일도 하지 않는다.
 *
 * @param {string} platform
 * @returns {{ app: string, web: string }}
 */
export function storeLinks(platform) {
  if (text(platform) === "ios") {
    return {
      app: `itms-apps://apps.apple.com/app/id${APP_STORE_ID}`,
      web: `https://apps.apple.com/kr/app/id${APP_STORE_ID}`,
    };
  }
  return {
    app: `market://details?id=${ANDROID_PACKAGE}`,
    web: `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`,
  };
}

/** 화면 문구. 센터가 따로 적지 않았으면 이것이다. */
export const UPDATE_COPY = Object.freeze({
  title: "새 버전이 나왔어요",
  optional: "업데이트하면 최근에 고친 것들이 함께 적용됩니다.",
  required: "이 버전으로는 수업 확정이 막힐 수 있어요. 업데이트해 주세요.",
  update: "업데이트",
  later: "나중에",
});
