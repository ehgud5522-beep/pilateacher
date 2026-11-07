/**
 * 회원이 회원 앱에서 취소한 수업을 일정에서 어떻게 보이는가 (2026-11-07 대표 결정).
 * **순수 함수만.**
 *
 * 지우지 않는다. 그 자리에 "회원 취소" 로 남긴다 -- 회원이 "저 취소했어요" 할 때의 근거,
 * 취소 횟수 기록과 일정이 맞는다는 근거다. 그리고:
 *
 * - 모양: 강사 취소(회색 점선)와 구별되는 "회원 취소" 표시
 * - 확인: 강사가 [확인] 을 누르면 첫 화면 "회원 취소 N건" 에서 빠진다. 일정에는 남는다.
 *   확인은 두 곳에 남는다 -- 이 기기(localStorage)와 알림함의 읽음(서버). 알림함 읽음은
 *   다른 기기에서도 보이므로 폰에서 확인하면 PC 띠에서도 빠진다
 * - 빈 시간: 출석이 전부 취소인 수업은 그 시간을 막지 않는다 -- 같은 시간에 다른 회원을
 *   넣을 때 "겹쳐서 등록됩니다" 경고를 띄우지 않는다
 * - 듀엣: 수업은 그대로 진행. 빠진 사람만 "회원 취소"
 * - 차감 · 급여 없음 (이전과 같다)
 */

const text = (value) => String(value ?? "").trim();

const attendeesOf = (entry) => (Array.isArray(entry?.attendees) ? entry.attendees.filter(Boolean) : []);

export const MEMBER_CANCEL_VIEW_COPY = Object.freeze({
  BADGE: "회원 취소",
  BANNER: "회원이 앱에서 직접 취소했어요",
  BANNER_DUET: "회원 1명이 앱에서 직접 취소했어요 · 수업은 남은 회원과 그대로 진행돼요",
  CONFIRM: "확인",
  CONFIRMED: "확인함",
  FREED: "이 시간은 비어 있어요. 다른 회원 수업을 넣을 수 있어요",
});

/** 이 출석이 회원 앱 취소인가. */
export const isMemberCancelledAttendee = (attendee) => Boolean(attendee?.memberCancelledAt) && text(attendee?.status) === "cancel";

/** 이 수업에 회원 앱 취소가 있는가. */
export const hasMemberCancel = (entry) => attendeesOf(entry).some(isMemberCancelledAttendee);

/** 출석이 전부 취소(회원이든 강사든)라 그 시간이 비었는가. 출석이 없는 일정(상담 등)은 아니다. */
export function freesSlot(entry) {
  if (entry?.groupCancelled) return true;
  const attendees = attendeesOf(entry);
  return attendees.length > 0 && attendees.every((attendee) => text(attendee?.status) === "cancel");
}

/** 수업 전체가 회원 취소로 비었는가 (개인 수업). 듀엣에서 한 사람만 빠진 것은 아니다. */
export const isWholeMemberCancel = (entry) => hasMemberCancel(entry) && freesSlot(entry);

/* ── 확인 ─────────────────────────────────────────────────────────────── */

export const MEMBER_CANCEL_ACK_KEY = "pilateacher.memberCancelAcks.v1";
const ACK_LIMIT = 300;

export const ackKey = (lessonId, memberId) => `${text(lessonId)}|${text(memberId)}`;

/** 이 기기에서 확인한 것. 못 읽으면 빈 목록 (확인을 못 한 것으로 본다 -- 띠가 남을 뿐이다). */
export function readMemberCancelAcks(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(MEMBER_CANCEL_ACK_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : []);
  } catch (_error) {
    return new Set();
  }
}

/** 확인 하나를 더한다. 오래된 것부터 버려 ACK_LIMIT 를 넘지 않는다. @returns {Set<string>} */
export function writeMemberCancelAck(storage, key) {
  const current = [...readMemberCancelAcks(storage)].filter((item) => item !== key);
  const next = [...current, text(key)].slice(-ACK_LIMIT);
  try { storage?.setItem?.(MEMBER_CANCEL_ACK_KEY, JSON.stringify(next)); } catch (_error) { /* 저장을 못 하면 이번 화면에서만 */ }
  return new Set(next);
}

/**
 * 알림함에서 읽은 것을 확인으로 본다. 알림 문서는 clientId 를 들고, 기기 출석은 memberId 를 든다 --
 * members 의 orgClientId(센터 회원 id)로 잇는다. @returns {Set<string>} ackKey 목록
 */
export function acksFromInbox(items, members = []) {
  const memberOf = new Map();
  for (const member of Array.isArray(members) ? members : []) {
    if (text(member?.orgClientId)) memberOf.set(text(member.orgClientId), text(member.id));
    if (text(member?.id) && !memberOf.has(text(member.id))) memberOf.set(text(member.id), text(member.id));
  }
  const keys = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.readAt) continue;
    const memberId = memberOf.get(text(item?.clientId));
    if (memberId) keys.add(ackKey(item.lessonId, memberId));
  }
  return keys;
}

const isoDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/**
 * 아직 확인하지 않은 회원 취소 (오늘부터 앞으로). 첫 화면 "회원 취소 N건" 이 센다.
 * @returns {Array<{ entry: any, memberId: string }>} 가까운 수업 먼저
 */
export function pendingMemberCancels(schedule, { acks = new Set(), now = new Date() } = {}) {
  const today = isoDay(now instanceof Date ? now : new Date());
  const rows = [];
  for (const entry of Array.isArray(schedule) ? schedule : []) {
    if (text(entry?.date) < today) continue;
    for (const attendee of attendeesOf(entry)) {
      if (!isMemberCancelledAttendee(attendee)) continue;
      if (acks.has(ackKey(entry.id, attendee.memberId))) continue;
      rows.push({ entry, memberId: text(attendee.memberId) });
    }
  }
  return rows.sort((left, right) => `${left.entry.date} ${left.entry.start}`.localeCompare(`${right.entry.date} ${right.entry.start}`));
}

/**
 * 강사가 회원 취소를 되돌렸는가 (2026-11-07). 저장 전에는 회원 앱 취소였던 출석이 저장 뒤
 * 취소가 아니다 -- 강사가 그 회원을 다시 넣은 것이다.
 *
 * 취소된 서버 문서는 아무 기기나 되살리지 못한다 (lesson-schedule-repository.js) -- 옛 탭이
 * 회원의 취소를 덮지 않게. 그러나 이것은 옛 탭이 아니다: memberCancelledAt 은 그 취소를
 * **받은** 기기에만 있다. 그 기기에서 강사가 직접 바꾼 것만 되살림으로 본다.
 */
export function revivesMemberCancel(before, after) {
  const was = new Set(attendeesOf(before).filter(isMemberCancelledAttendee).map((attendee) => text(attendee.memberId)));
  if (!was.size) return false;
  return attendeesOf(after).some((attendee) => was.has(text(attendee?.memberId)) && text(attendee?.status) !== "cancel");
}
