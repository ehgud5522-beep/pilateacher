/**
 * 비포애프터 공유 현황 (2026-11-21 대표: "비포애프터도 보내는지, 회원별로 잘 보내고 있는지").
 *
 * 서버(beforeAfterShareStats)가 카드마다 강사 · 회원 id · 상태 · 시각 · 회원이 열었는지만 준다.
 * 여기서 대표 명부(회원 · 회원권 · 강사)와 맞춰 강사별 · 회원별로 묶는다. 사진 · 코멘트는 오지 않는다.
 *
 * 누구를 "담당 회원" 으로 보나: 보관하지 않은 회원 중 담당 강사(instructorIds)에 그 강사가 있고,
 * **지금 쓸 수 있는 회원권**이 있는 회원 (isUsablePass). 끝난 회원까지 세면 "안 보냄" 이 부풀어 오른다.
 * 회원 앱에 연결되지 않은 회원(userId 없음)은 카드를 받을 수 없으므로 "안 보냄" 과 따로 센다.
 *
 * 순수 함수다. 문구 · 정렬은 여기서만 정한다.
 */

import { isUsablePass } from "../membership/pass-cards.js";

const text = (value) => String(value ?? "").trim();
const millis = (value) => {
  const at = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(at) ? at : 0;
};
const inMonth = (iso, month) => Boolean(iso) && monthKey(new Date(iso)) === month;
const monthKey = (at) => `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;

export const SHARE_STATUS = Object.freeze({ ACTIVE: "active", DRAFT: "draft", PREPARING: "preparing", REVOKED: "revoked" });

/** 회원에게 실제로 간 카드인가. 보낸 뒤 거둔 것(revoked + sharedAt)도 보낸 것이다. */
export const wasSent = (row) => Boolean(row?.sharedAt) && [SHARE_STATUS.ACTIVE, SHARE_STATUS.REVOKED].includes(text(row?.status));
/** 만들어 두고 보내지 않은 카드. */
export const isUnsent = (row) => [SHARE_STATUS.DRAFT, SHARE_STATUS.PREPARING].includes(text(row?.status));

/**
 * @param {{
 *   rows?: any[], clients?: any[], passes?: any[], instructors?: any[],
 *   canonicalInstructorId?: (id: unknown) => string, excludedClientIds?: Set<string> | null,
 *   month: string, now?: Date,
 * }} input
 */
export function beforeAfterBoard(input) {
  const now = input.now || new Date();
  const month = text(input.month);
  const canonical = typeof input.canonicalInstructorId === "function" ? input.canonicalInstructorId : (id) => text(id);
  const excluded = input.excludedClientIds instanceof Set ? input.excludedClientIds : new Set();

  const usable = new Set();
  for (const pass of input.passes || []) {
    if (!isUsablePass(pass, now)) continue;
    for (const id of [pass?.clientId, ...(Array.isArray(pass?.clientIds) ? pass.clientIds : [])]) if (text(id)) usable.add(text(id));
  }

  const instructors = new Map();
  const rowOf = (id) => {
    const key = canonical(id) || text(id);
    if (!instructors.has(key)) {
      instructors.set(key, { instructorId: key, sentThisMonth: 0, readThisMonth: 0, unsent: 0, members: new Map() });
    }
    return instructors.get(key);
  };
  const memberOf = (row, client) => {
    const id = text(client.id);
    if (!row.members.has(id)) {
      row.members.set(id, { clientId: id, name: text(client.name), linked: Boolean(text(client.userId)), sent: 0, read: 0, lastSentAt: null, unsent: 0 });
    }
    return row.members.get(id);
  };

  const clientById = new Map((input.clients || []).filter((client) => client && text(client.id)).map((client) => [text(client.id), client]));

  /* 담당 회원 먼저 -- 보낸 적이 없어도 줄이 서야 한다. */
  for (const client of clientById.values()) {
    if (client.archived === true || excluded.has(text(client.id)) || !usable.has(text(client.id))) continue;
    for (const instructorId of Array.isArray(client.instructorIds) ? client.instructorIds : []) {
      if (text(instructorId)) memberOf(rowOf(instructorId), client);
    }
  }

  for (const share of input.rows || []) {
    if (!share || excluded.has(text(share.clientId))) continue;
    const row = rowOf(share.teacherId);
    const client = clientById.get(text(share.clientId)) || { id: share.clientId, name: "", userId: "" };
    const member = memberOf(row, client);
    if (wasSent(share)) {
      member.sent += 1;
      if (share.read) member.read += 1;
      if (millis(share.sharedAt) > millis(member.lastSentAt)) member.lastSentAt = share.sharedAt;
      if (inMonth(share.sharedAt, month)) {
        row.sentThisMonth += 1;
        if (share.read) row.readThisMonth += 1;
      }
    } else if (isUnsent(share)) {
      member.unsent += 1;
      row.unsent += 1;
    }
  }

  const roster = new Map((input.instructors || []).map((member) => [canonical(member?.userId) || text(member?.userId), member]));
  return [...instructors.values()].map((row) => {
    const member = roster.get(row.instructorId) || null;
    const members = [...row.members.values()].sort(compareMembers);
    const assigned = members.filter((item) => usable.has(item.clientId) && clientById.get(item.clientId)?.archived !== true);
    const linked = assigned.filter((item) => item.linked);
    const everSent = linked.filter((item) => item.sent > 0).length;
    return {
      instructorId: row.instructorId,
      name: text(member?.displayName || member?.name),
      active: !member || text(member?.status || "active") === "active",
      sentThisMonth: row.sentThisMonth,
      readThisMonth: row.readThisMonth,
      unsent: row.unsent,
      assigned: assigned.length,
      linked: linked.length,
      notLinked: assigned.length - linked.length,
      everSent,
      neverSent: linked.length - everSent,
      members,
    };
  }).filter((row) => row.assigned > 0 || row.sentThisMonth > 0 || row.unsent > 0)
    .sort((left, right) => sentRate(left) - sentRate(right) || right.linked - left.linked || left.name.localeCompare(right.name, "ko"));
}

/** 앱 연결된 담당 회원 중 한 번이라도 카드를 받은 비율. 연결된 회원이 없으면 비교 대상이 아니라 맨 뒤. */
export const sentRate = (row) => (row.linked ? row.everSent / row.linked : 2);

/* 회원 줄: 앱 연결 · 보낸 적 없음이 위, 그다음 오래전에 보낸 순. */
function compareMembers(left, right) {
  const rank = (item) => (!item.linked ? 2 : item.sent ? 1 : 0);
  return rank(left) - rank(right) || millis(left.lastSentAt) - millis(right.lastSentAt) || left.name.localeCompare(right.name, "ko");
}

/** 회원 한 줄 문구. */
export function shareMemberLabel(member, now = new Date()) {
  if (!member.linked && !member.sent) return { tone: "muted", label: "회원 앱 미연결", code: "member_not_linked" };
  if (!member.sent) {
    return member.unsent
      ? { tone: "warn", label: `카드 만들고 안 보냄 ${member.unsent}장`, code: "card_not_sent" }
      : { tone: "bad", label: "보낸 적 없음", code: "never_sent" };
  }
  const days = Math.max(0, Math.floor((now.getTime() - millis(member.lastSentAt)) / 86400000));
  const at = new Date(member.lastSentAt);
  const read = member.read ? ` · 회원 열람 ${member.read}/${member.sent}` : " · 회원이 아직 안 열어봄";
  return {
    tone: days > 60 ? "warn" : "good",
    label: `${at.getMonth() + 1}/${at.getDate()} 보냄 (${days}일 전) · 총 ${member.sent}장${read}`,
    code: days > 60 ? "sent_long_ago" : "sent_recently",
  };
}

/** 강사 한 줄 판정. */
export function shareInstructorView(row) {
  if (!row.linked) return { tone: "muted", label: "앱 연결 회원 없음", code: "no_linked_members" };
  const percent = Math.round((row.everSent / row.linked) * 100);
  if (percent >= 70) return { tone: "good", label: `${percent}% 받음`, code: "share_good" };
  if (percent >= 30) return { tone: "warn", label: `${percent}% 받음`, code: "share_partial" };
  return { tone: "bad", label: `${percent}% 받음`, code: "share_low" };
}
