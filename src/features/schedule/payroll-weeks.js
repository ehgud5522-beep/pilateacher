/**
 * 급여 상세의 차감 목록 — **주 단위로 묶고, 듀엣은 두 이름을 함께 적는다.**
 *
 * ── 왜 고쳤는가 ──
 * 목록이 `entries.slice(0, 20)` 이었다. 항목은 최신순이라 스물한 번째부터
 * 조용히 사라진다 -- 10월 16일에 10월 13일 이전이 안 보였다. 그 달의 급여를
 * 설명하는 화면에서 그 달의 절반이 없는 것이다.
 *
 * 제한을 없애고 **주 단위로 접는다.** 한 달 치 마흔 줄을 펼쳐 두면 스크롤이
 * 길어 결국 안 읽히고, 주별 소계가 있으면 "이번 주에 얼마" 가 바로 보인다.
 *
 * ── 듀엣 ──
 * 2:1 수업은 원장 항목이 **하나**다. 회원권 하나를 둘이 나눠 쓰므로 차감도
 * 하나이고, 그래서 급여가 두 번 세어지는 일은 애초에 없다. 문제는 그 항목이
 * 들고 있는 `clientId` 가 **대표 한 명뿐**이라 화면에 한 이름만 뜬 것이다.
 * 짝은 회원권의 `clientIds` 에 있다.
 */

import { passClientIds } from "../../data/schema/pass-clients.js";

const text = (value) => String(value ?? "").trim();

const toDate = (value) => {
  if (!value) return null;
  const at = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isFinite(at?.getTime?.()) ? at : null;
};

const dayOf = (at) => (at
  ? `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`
  : "");

/** 그 주의 월요일. 주의 시작을 월요일로 두는 것은 수업 주기와 맞기 때문이다. */
export function weekStartOf(at) {
  if (!at) return null;
  const start = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  /* getDay() 는 일요일이 0 이다. 그대로 빼면 일요일이 다음 주의 시작이 되고,
     일요일 수업이 혼자 한 주를 이룬다. */
  const weekday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - weekday);
  return start;
}

/** 한 항목이 급여에 더하는 금액. **급여 집계와 같은 식이다** (`-delta × 단가`). */
const amountOf = (entry) => -(Number(entry?.delta) || 0) * (Number(entry?.unitPrice) || 0);
const sessionsOf = (entry) => -(Number(entry?.delta) || 0);

/**
 * 항목 한 줄이 가리키는 회원 전부.
 *
 * 듀엣이면 둘이다. 원장 항목은 대표 한 명만 들고 있으므로 회원권에서 찾는다 --
 * 회원권을 못 읽으면 아는 한 명만 적는다. 짝을 지어내지 않는다.
 *
 * @param {any} entry @param {(passId: string) => any} passOf
 */
export function clientsOnEntry(entry, passOf) {
  const anchor = text(entry?.clientId);
  const pass = typeof passOf === "function" ? passOf(text(entry?.passId)) : null;
  const listed = pass ? passClientIds(pass).map(text).filter(Boolean) : [];
  if (!listed.length) return anchor ? [anchor] : [];
  /* 대표를 앞에 둔다. 화면이 "A · B" 로 적을 때 순서가 매번 달라지면 같은
     수업이 다른 줄처럼 보인다. */
  return anchor && listed.includes(anchor)
    ? [anchor, ...listed.filter((id) => id !== anchor)]
    : listed;
}

/**
 * 한 줄로 그릴 항목.
 *
 * @param {{
 *   entries?: Array<any>,
 *   passOf?: (passId: string) => any,
 *   clientNameOf?: (clientId: string) => string,
 *   passLabelOf?: (passId: string) => string,
 * }} input
 */
export function payrollRows({ entries, passOf, clientNameOf, passLabelOf } = {}) {
  const nameOf = typeof clientNameOf === "function" ? clientNameOf : () => "";
  const labelOf = typeof passLabelOf === "function" ? passLabelOf : () => "";
  return (Array.isArray(entries) ? entries : [])
    .filter(Boolean)
    .map((entry) => {
      const clientIds = clientsOnEntry(entry, passOf);
      const names = clientIds.map((id) => nameOf(id)).filter(Boolean);
      const at = toDate(entry.occurredAt);
      return {
        id: text(entry.id),
        passId: text(entry.passId),
        occurredAt: at,
        day: dayOf(at),
        category: text(entry.category),
        rule: text(entry.rule),
        clientIds,
        names,
        isDuet: clientIds.length > 1,
        /* 이름을 못 찾으면 지어내지 않는다. 빈칸이면 화면이 회원권으로 부르고,
           그것은 "아직 모른다" 와 같은 방향이다. */
        title: names.length ? names.join(" · ") : labelOf(text(entry.passId)),
        passLabel: labelOf(text(entry.passId)),
        amount: amountOf(entry),
        sessions: sessionsOf(entry),
      };
    })
    .sort((left, right) => (right.occurredAt?.getTime() ?? 0) - (left.occurredAt?.getTime() ?? 0)
      || left.id.localeCompare(right.id));
}

/**
 * 한 줄을 눌렀을 때 — **회원별로 어느 회원권에서 몇 회 빠졌는가.**
 *
 * 그 달 전체에서 센다. 한 회원이 회원권을 여러 장 가지고 있으면 장마다 따로
 * 적는다 -- "3회 차감" 만으로는 어느 계약에서 빠졌는지 알 수 없고, 분쟁 때
 * 여는 화면이라 그 구분이 곧 근거가 된다.
 *
 * @param {{
 *   clientIds?: Array<string>, entries?: Array<any>, passOf?: (passId: string) => any,
 *   clientNameOf?: (clientId: string) => string, passLabelOf?: (passId: string) => string,
 * }} input
 */
export function clientBreakdown({ clientIds, entries, passOf, clientNameOf, passLabelOf } = {}) {
  const wanted = (Array.isArray(clientIds) ? clientIds : []).map(text).filter(Boolean);
  const nameOf = typeof clientNameOf === "function" ? clientNameOf : () => "";
  const labelOf = typeof passLabelOf === "function" ? passLabelOf : () => "";
  if (!wanted.length) return [];

  return wanted.map((clientId) => {
    const byPass = new Map();
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!clientsOnEntry(entry, passOf).includes(clientId)) continue;
      const passId = text(entry.passId);
      const found = byPass.get(passId) || { passId, label: labelOf(passId), sessions: 0, amount: 0 };
      found.sessions += sessionsOf(entry);
      found.amount += amountOf(entry);
      byPass.set(passId, found);
    }
    return {
      clientId,
      name: nameOf(clientId) || "",
      passes: [...byPass.values()].sort((left, right) => right.sessions - left.sessions),
    };
  });
}

/**
 * 주 단위로 묶는다. **그 달의 전부를 담는다** -- 잘라내지 않는다.
 *
 * 최신 주가 위다. 강사가 먼저 보고 싶은 것이 이번 주이고, 지난 주는 이미
 * 알고 있다.
 *
 * @param {{ rows?: Array<any>, now?: Date }} input
 */
export function payrollWeeks({ rows, now } = {}) {
  const at = now instanceof Date ? now : new Date();
  const thisWeek = weekStartOf(at);
  const buckets = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const start = weekStartOf(row.occurredAt);
    if (!start) continue;
    const key = dayOf(start);
    const found = buckets.get(key) || { key, start, rows: [], amount: 0, sessions: 0 };
    found.rows.push(row);
    found.amount += row.amount;
    found.sessions += row.sessions;
    buckets.set(key, found);
  }
  const ordered = [...buckets.values()].sort((left, right) => right.start.getTime() - left.start.getTime());
  const hasThisWeek = ordered.some(
    (week) => thisWeek !== null && week.start.getTime() === thisWeek.getTime(),
  );
  return ordered.map((week, index) => ({
    ...week,
    /* 이번 주를 펼친 채로 연다. 전부 펼치면 스크롤이 길어 결국 안 읽히고,
       전부 접으면 가장 자주 보는 줄을 한 번 더 눌러야 한다.

       **지난달을 볼 때는 그 달에 "이번 주" 가 없다.** 그때 전부 접히면 빈
       화면으로 보이고, 무엇을 눌러야 하는지도 알 수 없다 -- 그럴 때는 가장
       최근 주를 펼친다. */
    current: hasThisWeek
      ? thisWeek !== null && week.start.getTime() === thisWeek.getTime()
      : index === 0,
  }));
}

/**
 * 목록 합계. **상단의 확정 합계와 같아야 한다.**
 *
 * 다르면 둘 중 하나가 틀렸는데 화면만 보고는 어느 쪽인지 알 수 없다 -- 같은
 * 식(`-delta × 단가`)으로 세는 것이 그 보장이다.
 */
export const weeksTotal = (weeks) => (Array.isArray(weeks) ? weeks : [])
  .reduce((sum, week) => sum + week.amount, 0);

/** 고를 수 있는 달. 이번 달부터 거슬러 올라간다. */
export function monthChoices(now = new Date(), count = 6) {
  const at = now instanceof Date ? now : new Date();
  return Array.from({ length: Math.max(1, count) }, (_, index) => {
    const month = new Date(at.getFullYear(), at.getMonth() - index, 1);
    return `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  });
}
