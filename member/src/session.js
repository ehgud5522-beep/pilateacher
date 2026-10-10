/**
 * 90일마다 번호를 다시 확인한다 (확정 5번).
 *
 * ── 이것은 보안 경계가 아니다 ──
 * 규칙은 90일을 모른다. 투영 문서를 지키는 것은 `memberViews.userId ==
 * request.auth.uid` 하나뿐이고, 그것은 Firebase Auth 세션이 살아 있는 한
 * 계속 참이다. 여기서 하는 일은 **폰을 잃어버렸거나 번호가 바뀐 사람이
 * 영원히 남의 잔여를 보고 있지 않게** 하는 것이다. 서버가 막아 주는 것이
 * 아니라 앱이 스스로 문을 닫는 것이고, 그 차이를 알고 써야 한다.
 *
 * ── 왜 서버 값이 아니라 기기에 두는가 ──
 * `memberLinks.linkedAt` 은 **처음 이은 시각**이지 마지막으로 번호를 확인한
 * 시각이 아니다. 그것으로 90일을 세면 재인증을 해도 값이 그대로라 계속
 * 쫓겨난다. 그래서 "마지막 확인"은 기기가 든다.
 *
 * 기기 저장은 지워질 수 있다. 지워지면 값이 없고, 값이 없으면 다시 인증한다 --
 * **틀리는 방향이 안전한 쪽**이다.
 */

/** 확정 5번. 하루는 86,400,000 밀리초. */
export const REVERIFY_AFTER_DAYS = 90;
const DAY_MS = 86400000;

/** 기기에 마지막 확인 시각을 적어 두는 칸. */
export const VERIFIED_AT_KEY = "pilateacher.member.verifiedAt";

/**
 * 지금 번호를 다시 확인해야 하는가. **순수 함수다.**
 *
 * @param {unknown} verifiedAt 마지막 확인 시각 (ISO 문자열 · 숫자 · Date · 없음)
 * @param {Date} now
 */
export function needsReverification(verifiedAt, now = new Date()) {
  const at = toDate(verifiedAt);
  // 기록이 없거나 읽을 수 없으면 다시 확인한다.
  if (!at) return true;
  /* 미래 시각은 시계가 틀렸거나 손댄 것이다. 통과시키면 그 기기는 영영 다시
     묻지 않는다. */
  if (at.getTime() > now.getTime()) return true;
  return now.getTime() - at.getTime() >= REVERIFY_AFTER_DAYS * DAY_MS;
}

function toDate(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === "number") return Number.isFinite(value) ? new Date(value) : null;
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/**
 * 기기에서 읽는다. 읽지 못하면 "없음"으로 본다 -- 시크릿 창과 저장 차단에서
 * 던지는 것이 정상이고, 그때 화면이 통째로 죽으면 안 된다.
 *
 * @param {{ getItem?: (key: string) => any }} [store]
 */
export function readVerifiedAt(store) {
  try {
    const box = store || (typeof localStorage === "undefined" ? null : localStorage);
    return box ? box.getItem(VERIFIED_AT_KEY) : null;
  } catch (_error) {
    return null;
  }
}

/** 기기에 적는다. 실패해도 조용히 넘어간다 -- 다음에 다시 물을 뿐이다. */
export function writeVerifiedAt(at, store) {
  try {
    const box = store || (typeof localStorage === "undefined" ? null : localStorage);
    if (box) box.setItem(VERIFIED_AT_KEY, (at instanceof Date ? at : new Date()).toISOString());
  } catch (_error) {
    /* 적지 못하면 다음에 다시 인증한다. 그것이 이 기능의 안전한 방향이다. */
  }
}

/** 이 앱이 기기에 적는 칸은 전부 이 이름으로 시작한다. */
const MEMBER_KEY_PREFIX = "pilateacher.member.";

/**
 * 로그아웃할 때 기기에 남긴 것을 걷는다. 다음에 이 폰을 쥔 사람이 앞사람의
 * 확인 시각을 물려받으면 90일 장치가 그 사람에게는 열린 채로 시작한다.
 *
 * 회원 연결(memberLinks)과 잔여(memberViews)는 기기에 캐시하지 않는다 --
 * 매번 서버에서 읽는다. 그래서 걷을 것은 이 이름의 칸들뿐이다.
 *
 * @param {Storage} [store]
 */
export function clearMemberStorage(store) {
  try {
    const box = store || (typeof localStorage === "undefined" ? null : localStorage);
    if (!box) return;
    const keys = [];
    for (let index = 0; index < box.length; index += 1) {
      const key = box.key(index);
      if (key && key.startsWith(MEMBER_KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) box.removeItem(key);
  } catch (_error) {
    /* 저장이 막힌 기기다. 거기엔 애초에 적힌 것도 없다. */
  }
}
