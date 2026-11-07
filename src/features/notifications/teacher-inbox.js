/**
 * 강사 알림함 — 화면 판정과 문구 (2026-11-07). **순수 함수만.**
 *
 * 알림은 서버가 users/{uid}/inbox 에 만든다 (functions/src/teacher-cancel-push.js).
 * 지금 종류는 하나: 회원이 회원 앱에서 수업을 취소함 (member_cancel).
 *
 * 회원 이름은 알림 문서에 없다 -- 강사 앱이 clientId 로 자기 명단에서 찾는다.
 * 명단에 없으면(담당이 바뀜 · 아직 못 받음) 이름 없이 보인다.
 */

const text = (value) => String(value ?? "").trim();

export const INBOX_KIND = Object.freeze({ MEMBER_CANCEL: "member_cancel" });

export const INBOX_COPY = Object.freeze({
  TITLE: "알림",
  EMPTY: "새 알림이 없어요",
  OPEN: "일정 보기",
  NOT_SYNCED: "이 수업이 아직 일정에 없어요. 일정을 새로 받은 뒤 다시 눌러 주세요",
});

const toMillis = (value) => {
  if (!value) return NaN;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return new Date(value).getTime();
};

/** 읽지 않은 건수. */
export function unreadCount(items) {
  return (Array.isArray(items) ? items : []).filter((item) => !item?.readAt).length;
}

/** 띠에 쓸 말. 읽지 않은 것이 없으면 빈 문자열 (띠를 그리지 않는다). */
export function inboxStripLabel(items) {
  const count = unreadCount(items);
  return count > 0 ? `새 알림 ${count}건` : "";
}

/** "방금" · "12분 전" · "3시간 전" · "11/6". */
export function receivedLabel(value, now = Date.now()) {
  const at = toMillis(value);
  if (!Number.isFinite(at)) return "";
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}시간 전`;
  const date = new Date(at);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * 한 줄. members 는 강사 앱 명단 ({ id, orgClientId, name }) -- 알림의 clientId 는 orgClientId 와 맞춘다.
 * @returns {{ id: string, title: string, body: string, who: string, unread: boolean, lessonId: string, received: string }}
 */
export function inboxRow(item, members = [], now = Date.now()) {
  const clientId = text(item?.clientId);
  /* 센터 회원 id 는 orgClientId 다 -- 옛 기기 회원과 이어진 사람은 id 가 다르다. 둘 다 본다. */
  const member = clientId ? (Array.isArray(members) ? members : [])
    .find((entry) => text(entry?.orgClientId) === clientId || text(entry?.id) === clientId) : null;
  return {
    id: text(item?.id),
    title: text(item?.title) || "[회원 수업 취소]",
    body: text(item?.body),
    who: text(member?.name) ? `${text(member.name)} 회원` : "",
    unread: !item?.readAt,
    lessonId: text(item?.lessonId),
    received: receivedLabel(item?.createdAt, now),
  };
}

/** 눌렀을 때 열 수업. 기기 일정에 없으면 null -- 화면이 NOT_SYNCED 를 말한다. */
export function lessonForInboxItem(item, schedule = []) {
  const lessonId = text(item?.lessonId);
  if (!lessonId) return null;
  return (Array.isArray(schedule) ? schedule : []).find((entry) => text(entry?.id) === lessonId) || null;
}

/**
 * 알림함을 열지 못했을 때. 규칙이 아직 나가지 않았으면 permission-denied 다 --
 * 권한 문제처럼 말하지 않고 "아직 열 수 없어요" + 코드 (CLAUDE.md §4).
 * @returns {{ kind: string, code: string, message: string }}
 */
export function inboxFailure(error) {
  const code = text(error?.code).replace(/^firestore\//, "") || "unknown";
  if (code === "unavailable" || code === "deadline-exceeded") {
    return { kind: "network", code, message: `연결이 불안정해 알림을 받지 못했어요 (코드 ${code})` };
  }
  if (code === "permission-denied") {
    return { kind: "permission", code, message: `알림함을 아직 열 수 없어요 (코드 ${code})` };
  }
  return { kind: "unknown", code, message: `알림을 불러오지 못했어요 (코드 ${code})` };
}
