/**
 * 회원 앱 진단. **대표가 Mac 없이 원인을 볼 수 있어야 한다.**
 *
 * ── 왜 필요한가 ──
 * TestFlight 로 받은 앱이 "잠시만요…" 에서 멈췄는데, 그것을 들여다볼 방법이
 * 없었다. Safari 웹 인스펙터는 Mac 이 있어야 하고, 화면에는 아무 코드도
 * 뜨지 않았다. 원인을 추측으로 좁히는 동안 대표는 아무것도 할 수 없었다.
 *
 * 그래서 기기가 스스로 적는다. 화면 맨 아래 버전 글자를 다섯 번 누르면
 * 보인다.
 *
 * ── 무엇을 적지 않는가 ──
 * **회원 이름 · 전화번호 · uid 는 어떤 모양으로도 적지 않는다.** 이 기록은
 * 대표에게 그대로 읽히고 캡처되어 돌아다닐 수 있다. Firebase 오류 문구에는
 * 번호가 섞여 오는 일이 있어서(`auth/invalid-phone-number` 계열) 문구도
 * 그냥 두지 않고 훑는다.
 *
 * 지우는 것은 값이고 사실이 아니다 -- "번호가 있었다" 는 남는다. 그래야
 * 왜 거절됐는지 읽을 수 있다.
 */

/** 기기에 두는 칸. 계정 삭제 때 이 이름으로 걷는다 (session.js). */
export const DIAGNOSTIC_KEY = "pilateacher.member.diagnostics";

/** 몇 건까지 들고 있나. 최근 것이 앞이다. */
export const DIAGNOSTIC_LIMIT = 30;

/** 어느 기능인가. 한 문구로 뭉개지 않기 위한 첫 칸이다. */
export const MEMBER_FEATURE = Object.freeze({
  AUTH_INIT: "auth_init",
  PHONE_SIGN_IN: "phone_sign_in",
  LINK: "member_link",
  READ_VIEW: "read_member_view",
  OFFLINE_CACHE: "offline_cache",
  DELETE_ACCOUNT: "delete_account",
  SIGN_OUT: "sign_out",
});

/** 그 기능의 어느 단계인가. */
export const MEMBER_STAGE = Object.freeze({
  STARTED: "started",
  AUTH_STATE_FIRST: "auth_state_first",
  AUTH_STATE_TIMEOUT: "auth_state_timeout",
  CODE_SENT: "code_sent",
  CONFIRMED: "confirmed",
  READ_LINK: "read_link",
  CALL_LINK: "call_link",
  READ_VIEWS: "read_views",
  CACHE_HIT: "cache_hit",
  DONE: "done",
  FAILED: "failed",
});

/**
 * 어떤 모양으로도 진단에 들어가면 안 되는 칸.
 *
 * 코드는 이 목록을 쓰지 않는다 -- 만드는 쪽이 허용 목록이라 이미 막혀 있다.
 * 테스트만 쓴다. 허용 목록에 실수로 한 줄이 늘었을 때 그것을 잡을 것이
 * 필요해서 두 겹으로 둔다.
 */
export const FORBIDDEN_DIAGNOSTIC_FIELDS = Object.freeze([
  "phone", "phoneNumber", "name", "userId", "uid", "clientId", "token",
  "idToken", "verificationId", "verificationCode", "credential",
]);

const text = (value) => String(value ?? "").trim();

/**
 * 문구에서 값만 지운다. **사실은 남긴다** -- "번호가 있었다" 를 지우면 왜
 * 거절됐는지 읽을 수 없다.
 */
export function scrubMessage(value) {
  return text(value)
    // +8210... 같은 국제 표기
    .replace(/\+\d[\d\-\s]{6,}\d/g, "[번호]")
    // 010-0000-0000 · 01000000000
    .replace(/\b0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}\b/g, "[번호]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[메일]")
    .slice(0, 300);
}

/** 기기가 무엇인지. 사람을 가리키는 값은 없다. */
export function runtimeInfo(globals = globalThis) {
  const capacitor = globals?.Capacitor || null;
  let platform = "web";
  try {
    if (capacitor?.getPlatform) platform = text(capacitor.getPlatform()) || "web";
  } catch (_error) { /* 못 물으면 웹으로 본다 */ }
  const build = globals?.__MEMBER_BUILD__ || {};
  return {
    platform,
    appVersion: text(build.version),
    appCommit: text(build.commit),
    builtAt: text(build.builtAt),
    // 기종·OS 는 여기서만 온다 (플러그인을 더 들이지 않는다). 사람이 아니라
    // 기기를 가리키는 값이다.
    device: text(globals?.navigator?.userAgent).slice(0, 160),
  };
}

/**
 * 한 줄을 만든다. **허용 목록이다** -- 여기 없는 칸은 들어오지 않는다.
 */
export function diagnosticEntry(input, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const runtime = options.runtime || runtimeInfo(options.globals);
  return {
    at: now.toISOString(),
    feature: text(input?.feature) || "unknown",
    stage: text(input?.stage) || "unknown",
    /* 오류를 만든 계층. 정규화한 코드로 원본을 덮지 않는다. */
    errorDomain: text(input?.errorDomain),
    errorCode: text(input?.errorCode),
    message: scrubMessage(input?.message),
    correlationId: text(input?.correlationId),
    ...runtime,
  };
}

function box(store) {
  if (store) return store;
  return typeof localStorage === "undefined" ? null : localStorage;
}

/** 읽는다. 못 읽으면 빈 목록 -- 진단 때문에 화면이 죽으면 안 된다. */
export function readDiagnostics(store) {
  try {
    const raw = box(store)?.getItem(DIAGNOSTIC_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

/**
 * 한 줄을 적는다. 최근 것이 앞이고 `DIAGNOSTIC_LIMIT` 을 넘으면 오래된
 * 것부터 버린다.
 *
 * 실패해도 던지지 않는다. 진단을 못 남기는 것은 그 자체로 화면이 죽을 일이
 * 아니다.
 */
export function recordDiagnostic(input, options = {}) {
  const entry = diagnosticEntry(input, options);
  try {
    const store = box(options.store);
    if (!store) return entry;
    const next = [entry, ...readDiagnostics(store)].slice(0, DIAGNOSTIC_LIMIT);
    store.setItem(DIAGNOSTIC_KEY, JSON.stringify(next));
  } catch (_error) {
    /* 저장이 막힌 기기가 있다. 그래도 이번 줄은 돌려준다. */
  }
  return entry;
}

export function clearDiagnostics(store) {
  try { box(store)?.removeItem(DIAGNOSTIC_KEY); } catch (_error) { /* 지울 것이 없다 */ }
}

/**
 * 대표가 읽고 그대로 보낼 수 있는 한 덩어리.
 *
 * 화면에서 길게 눌러 복사하는 것이 유일한 내보내기 수단이다 -- 공유 시트를
 * 붙이면 플러그인이 하나 늘고, 그것은 이 화면이 존재하는 이유(막혔을 때
 * 보는 것)와 상관없는 위험이다.
 */
export function diagnosticsText(entries) {
  const rows = Array.isArray(entries) ? entries : [];
  if (!rows.length) return "기록이 없습니다.";
  return rows.map((row) => [
    row.at,
    `${row.feature} / ${row.stage}`,
    row.errorCode ? `${row.errorDomain || "?"}:${row.errorCode}` : "",
    row.message || "",
    `${row.platform} ${row.appVersion}${row.appCommit ? ` (${row.appCommit})` : ""}`,
  ].filter(Boolean).join(" · ")).join("\n");
}
